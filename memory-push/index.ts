#!/usr/bin/env npx tsx
/**
 * Memory Push MCP Server
 *
 * 把本地零散文档资料推送到 MEMORY 知识库仓库（Obsidian Vault）。
 * - list_docs: 列出 MEMORY 仓库顶层结构（帮助选择目标子目录）
 * - publish_doc: 显式调用时把本地文件/目录推送到 MEMORY 指定子目录（唯一 push 入口）
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
import * as path from "path";
import { loadConfig } from "./lib/config.js";
import { publishDoc } from "./lib/publish.js";

async function main() {
  const server = new Server(
    { name: "memory-push", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_docs",
        description:
          "列出 MEMORY 知识库仓库的顶层目录结构（用于选择 publish_doc 的目标子目录）。MEMORY 是 Obsidian 知识库：原始沉淀目录（如 AI参考资料/、Agent工作流/）+ OUTPUT/ 精炼知识库。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "publish_doc",
        description:
          "把本地零散文档资料（单个文件或整个目录）推送到 MEMORY 知识库仓库。流程：校验源 → 复制到 <仓库>/<subdir>/（合并语义，同名覆盖，不删旧文件）→ 敏感检查（默认命中即中止）→ git add/commit/push。只有显式调用才会 push；dry_run=true 可只预览。注：MEMORY 用 Git LFS 管 *.rsm/*.csv，推送这类大文件需本地已装 git-lfs。",
        inputSchema: {
          type: "object",
          properties: {
            src: { type: "string", description: "本地文件或目录的绝对路径" },
            subdir: {
              type: "string",
              description:
                "MEMORY 仓库内的目标子目录（如 \"AI参考资料\"、\"Agent工作流\"、\"AI项目生成文档_AI对话沉淀\"）；缺省为仓库根目录",
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
            const entries = await fs.readdir(config.repoDir, { withFileTypes: true });
            const dirs: string[] = [];
            const files: string[] = [];
            for (const e of entries) {
              if (e.name.startsWith(".")) continue;
              if (e.isDirectory()) dirs.push(e.name);
              else files.push(e.name);
            }
            const lines = [
              `MEMORY 仓库工作副本：${config.repoDir}`,
              "",
              `目录（${dirs.length}）：`,
              ...dirs.map((d) => `  - ${d}`),
              "",
              `根文件（${files.length}）：`,
              ...files.map((f) => `  - ${f}`),
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
          } catch (e: any) {
            return {
              content: [
                {
                  type: "text",
                  text: `仓库不可读（${config.repoDir}）：${e.message}\n可直接用 publish_doc 推送，会自动 clone。`,
                },
              ],
            };
          }
        }

        case "publish_doc": {
          if (!args.src) {
            return { content: [{ type: "text", text: "错误: 请提供 src（本地文件或目录的绝对路径）" }] };
          }
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
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      return { content: [{ type: "text", text: `错误: ${e.message}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
