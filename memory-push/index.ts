#!/usr/bin/env npx tsx
/**
 * Memory KB MCP Server
 *
 * 面向 ZhaoWen_KnowledgeBase 知识库仓库（Obsidian Vault）的读写入口。
 *
 * 读 / 检索：
 *   - list_docs:   列出仓库顶层结构（帮助选目标子目录）
 *   - search_docs: 搜索 note，为写入前判重提供依据
 *   - read_doc:    读指定笔记全文（合并更新前必须先读）
 * 写：
 *   - write_docs:  批量原子写入 + 单次 commit + push（概念卡片沉淀的主入口）
 *   - publish_doc: 把本地零散文档/目录推送到仓库（原有能力，合并语义复制）
 *
 * 启动: npx tsx E:/CodeProject/mcp-server/memory-push/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "fs";
import { loadConfig } from "./lib/config.js";
import { publishDoc } from "./lib/publish.js";
import { readDoc, searchDocs } from "./lib/search.js";
import { writeDocs } from "./lib/write.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

async function main() {
  const server = new Server(
    { name: "memory-kb", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_docs",
        description:
          "列出知识库仓库的顶层目录结构（用于选择目标子目录）。知识库是 Obsidian Vault：原始沉淀目录（如 AI参考资料/、Agent工作流/）+ OUTPUT/ 精炼 wiki（Sources/ → Evergreen/ → Categories/）。",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "可选：仓库内相对目录，缺省只列仓库根；如 \"OUTPUT/Evergreen\" 可看常青笔记分类",
            },
          },
        },
      },
      {
        name: "search_docs",
        description:
          "在知识库 wiki 层搜索现有笔记，用于**写入前判重**。返回 hits（关键词命中位置）与 candidates（可能是同一概念的既有卡片，按 文件名/topics/正文重合度 打分）。candidates 非空时必须先用 read_doc 读全文，再决定是「合并既有卡」还是「新建」。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "查询词；空格分隔多词表示 AND" },
            path: { type: "string", description: "仓库内相对目录，缺省 OUTPUT" },
            mode: { type: "string", description: "name | content | both（默认 both）" },
            limit: { type: "number", description: "最多返回命中数，默认 20" },
            context_lines: { type: "number", description: "命中行的上下文行数，默认 0" },
          },
          required: ["query"],
        },
      },
      {
        name: "read_doc",
        description:
          "读取知识库中指定笔记的完整内容，含解析后的 frontmatter 与 Evergreen 卡片规范校验结果。**合并更新既有卡片前必须先调用它读全文**，否则不要覆盖。",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "仓库内相对路径，如 OUTPUT/Evergreen/概念卡片/Morlet小波.md",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_docs",
        description:
          "把一批文件内容直接写入知识库并**一次性** commit + push（LLM 写入知识库的主入口）。特点：全部校验（路径越界、撞库、敏感信息、卡片规范）在落盘前完成，保证要么全成要么全不成；只暂存本批文件，绝不 git add -A，不会卷进仓库里无关的未提交改动；提交前 pull --rebase 避免 push 被拒。一次对话产生的 N 张卡片 + index.md + Categories + log.md 应在**同一次调用**里提交，保证原子性与单条提交记录。内容里的 {{SESSION_ID}}、{{TODAY}} 占位符会被自动展开。",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              description: "要写入的文件列表",
              items: {
                type: "object",
                properties: {
                  path: { type: "string", description: "仓库内相对路径" },
                  content: { type: "string", description: "文件的完整内容" },
                  mode: {
                    type: "string",
                    description: "create（默认，目标已存在则整批失败）/ overwrite（覆盖）/ append（追加）",
                  },
                },
                required: ["path", "content"],
              },
            },
            message: { type: "string", description: "提交说明（缺省自动生成）" },
            sensitive_action: { type: "string", description: "abort（默认，命中即整批中止）/ mask（替换为占位符后写入）" },
            sensitive_ignore: {
              type: "array",
              items: { type: "string" },
              description: "要豁免的敏感规则 id 前缀，如 [\"ip-2\"]（内网 IP 误报时用）",
            },
            strict_evergreen: {
              type: "boolean",
              description: "默认 true：OUTPUT/Evergreen/ 下的文件强制 Evergreen 卡片规范校验",
            },
            pull_rebase: { type: "boolean", description: "默认 true：提交前 pull --rebase" },
            dry_run: { type: "boolean", description: "true 时只预览将写入哪些文件，不落盘不提交" },
          },
          required: ["files"],
        },
      },
      {
        name: "publish_doc",
        description:
          "把本地零散文档资料（单个文件或整个目录）推送到知识库仓库。流程：校验源 → 复制到 <仓库>/<subdir>/（合并语义，同名覆盖，不删旧文件）→ 敏感检查（默认命中即中止）→ git add/commit/push。只有显式调用才会 push；dry_run=true 可只预览。注：仓库用 Git LFS 管 *.rsm/*.csv，推送这类大文件需本地已装 git-lfs。",
        inputSchema: {
          type: "object",
          properties: {
            src: { type: "string", description: "本地文件或目录的绝对路径" },
            subdir: {
              type: "string",
              description:
                "仓库内的目标子目录（如 \"AI参考资料\"、\"Agent工作流\"、\"AI项目生成文档_AI对话沉淀\"）；缺省为仓库根目录",
            },
            message: { type: "string", description: "可选：提交说明（缺省自动生成）" },
            sensitive_action: { type: "string", description: "可选：abort（默认）/ mask（仅提示）" },
            dry_run: { type: "boolean", description: "可选：true 时只复制并显示变更，不 commit/push" },
          },
          required: ["src"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const config = loadConfig();

    try {
      switch (name) {
        case "list_docs": {
          try {
            const rel = args.path ? String(args.path).replace(/^[/\\]+|[/\\]+$/g, "") : "";
            const base = rel ? `${config.repoDir}\\${rel.replace(/\//g, "\\")}` : config.repoDir;
            const entries = await fs.readdir(base, { withFileTypes: true });
            const dirs: string[] = [];
            const files: string[] = [];
            for (const e of entries) {
              if (e.name.startsWith(".")) continue;
              if (e.isDirectory()) dirs.push(e.name);
              else files.push(e.name);
            }
            const lines = [
              `知识库工作副本：${config.repoDir}`,
              rel ? `查看目录：${rel}` : "查看目录：（仓库根）",
              "",
              `子目录（${dirs.length}）：`,
              ...dirs.map((d) => `  - ${d}`),
              "",
              `文件（${files.length}）：`,
              ...files.map((f) => `  - ${f}`),
            ];
            return text(lines.join("\n"));
          } catch (e: any) {
            return text(
              `目录不可读（${config.repoDir}）：${e.message}\n可直接用 write_docs / publish_doc 写入。`
            );
          }
        }

        case "search_docs": {
          if (!args.query) return text("错误: 请提供 query");
          const r = await searchDocs(config, {
            query: String(args.query),
            scope: args.path ? String(args.path) : undefined,
            mode: args.mode === "name" || args.mode === "content" ? args.mode : "both",
            limit: typeof args.limit === "number" ? args.limit : undefined,
            contextLines: typeof args.context_lines === "number" ? args.context_lines : undefined,
          });
          const lines: string[] = [
            `范围: ${r.scope}  关键词: ${r.query}  已扫描 ${r.filesScanned} 个文件`,
          ];
          if (r.candidates.length) {
            lines.push("", "⚠️ 可能同一概念的既有卡片（判重依据，须 read_doc 读全文后再合并）：");
            for (const c of r.candidates) {
              const tp = c.topics.length ? `；topics: ${c.topics.join(" / ")}` : "";
              lines.push(`  - [${c.score}] ${c.path}  「${c.title}」  ${c.reason}${tp}`);
            }
          } else {
            lines.push("", "✓ 未发现同一概念的既有卡片 → 可新建。");
          }
          if (r.hits.length) {
            lines.push("", `关键词命中 ${r.hits.length} 处${r.truncated ? "（已截断）" : ""}：`);
            for (const h of r.hits) lines.push(`  - ${h.path}:${h.line} [${h.kind}] ${h.snippet}`);
          }
          return text(lines.join("\n"));
        }

        case "read_doc": {
          if (!args.path) return text("错误: 请提供 path");
          const r = await readDoc(config, String(args.path));
          if (!r.ok || r.content === undefined) return text(`错误: ${r.message}`);
          const lines = [r.message];
          if (r.frontmatter) {
            lines.push("", "frontmatter:", JSON.stringify(r.frontmatter, null, 2));
          }
          if (r.validation) {
            if (r.validation.errors.length) lines.push("", `❌ 规范问题：${r.validation.errors.join("；")}`);
            if (r.validation.warnings.length) lines.push(`⚠️ 提示：${r.validation.warnings.join("；")}`);
          }
          lines.push("", "---- 全文 ----", r.content);
          return text(lines.join("\n"));
        }

        case "write_docs": {
          const filesRaw = Array.isArray(args.files) ? args.files : [];
          if (!filesRaw.length) return text("错误: files 不能为空");
          const specs = filesRaw.map((f: any) => ({
            path: String(f?.path ?? ""),
            content: String(f?.content ?? ""),
            mode: (f?.mode === "overwrite" || f?.mode === "append" ? f.mode : "create") as
              | "create"
              | "overwrite"
              | "append",
          }));
          const result = await writeDocs(config, {
            files: specs,
            message: args.message ? String(args.message) : undefined,
            sensitiveAction: args.sensitive_action === "mask" ? "mask" : "abort",
            sensitiveIgnore: Array.isArray(args.sensitive_ignore)
              ? args.sensitive_ignore.map(String)
              : undefined,
            strictEvergreen: args.strict_evergreen !== false,
            pullRebase: args.pull_rebase !== false,
            dryRun: args.dry_run === true || args.dry_run === "true",
          });
          const lines = [result.message];
          if (result.commitHash) lines.push(`commit: ${result.commitHash.slice(0, 7)}`);
          if (result.branch) lines.push(`分支: ${result.branch}${result.pulled ? "（已 pull --rebase）" : ""}`);
          if (result.warnings.length) lines.push(`⚠️ 警告:\n${result.warnings.join("\n")}`);
          lines.push("---JSON---", JSON.stringify(result));
          return text(lines.join("\n"));
        }

        case "publish_doc": {
          if (!args.src) return text("错误: 请提供 src（本地文件或目录的绝对路径）");
          const result = await publishDoc(config, {
            src: String(args.src),
            subdir: args.subdir ? String(args.subdir) : undefined,
            message: args.message ? String(args.message) : undefined,
            sensitiveAction: args.sensitive_action === "mask" ? "mask" : "abort",
            dryRun: args.dry_run === true || args.dry_run === "true",
          });
          const lines = [result.message];
          if (result.targetPath) lines.push(`目标: ${result.targetPath}`);
          if (typeof result.copiedFiles === "number") lines.push(`文件数: ${result.copiedFiles}`);
          if (result.commitHash) lines.push(`commit: ${result.commitHash.slice(0, 7)}`);
          if (result.warnings?.length) lines.push(`⚠️ 警告:\n${result.warnings.join("\n")}`);
          return text(lines.join("\n"));
        }

        default:
          return text(`未知工具: ${name}`);
      }
    } catch (e: any) {
      return text(`错误: ${e.message}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
