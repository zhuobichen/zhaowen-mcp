#!/usr/bin/env npx tsx
/**
 * Other Projects MCP Server
 *
 * 把「帮别人做的任务」目录发布到 GitHub Other_Projects 仓库（同级子目录）。
 * - list_projects: 列出仓库现有项目目录
 * - publish_project: 显式调用时把本地任务目录推送到仓库（唯一 push 入口）
 *
 * 启动: npx tsx E:/CodeProject/mcp-server/other-projects/index.ts
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
import { publishProject } from "./lib/publish.js";

async function main() {
  const server = new Server(
    { name: "other-projects", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_projects",
        description:
          "列出 Other_Projects 仓库中现有的项目子目录（帮别人做的任务集合）。可先看有哪些，再决定发布目标名是否重名。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "publish_project",
        description:
          "把本地「帮别人做的任务」目录发布到 Other_Projects 仓库的同名子目录并 push。流程：校验源 → 复制到仓库 <name>/（排除 node_modules/__pycache__/.git 等）→ 敏感检查（默认命中即中止，可 mask 仅提示）→ git add/commit/push。只有显式调用本工具才会 push；dry_run=true 可只预览。",
        inputSchema: {
          type: "object",
          properties: {
            src_dir: { type: "string", description: "本地任务目录绝对路径（如 E:/CodeProject/其余工程/APR-D-26-00796_审稿）" },
            name: { type: "string", description: "可选：仓库内子目录名（缺省用源目录名，支持中文）" },
            message: { type: "string", description: "可选：提交说明（缺省自动生成）" },
            sensitive_action: { type: "string", description: "可选：abort（默认，命中敏感项即中止）/ mask（仅提示继续）" },
            dry_run: { type: "boolean", description: "可选：true 时只复制并显示变更，不 commit/push" },
          },
          required: ["src_dir"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const config = loadConfig();

    try {
      switch (name) {
        case "list_projects": {
          const dirs: string[] = [];
          try {
            const entries = await fs.readdir(config.repoDir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isDirectory() && e.name !== ".git" && !e.name.startsWith(".")) dirs.push(e.name);
            }
          } catch (e: any) {
            return {
              content: [
                {
                  type: "text",
                  text: `仓库工作副本不可读（${config.repoDir}）：${e.message}\n可先用 publish_project 发布一个项目以自动 clone。`,
                },
              ],
            };
          }
          const lines = dirs.length
            ? [`Other_Projects 现有项目子目录（${dirs.length} 个）:`, ...dirs.map((d) => `  - ${d}`)]
            : ["仓库根目录下暂无子目录（现有文件为仓库原有内容，非子目录项目）"];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "publish_project": {
          if (!args.src_dir) {
            return { content: [{ type: "text", text: "错误: 请提供 src_dir（本地任务目录绝对路径）" }] };
          }
          const result = await publishProject(config, {
            srcDir: String(args.src_dir),
            name: args.name ? String(args.name) : undefined,
            message: args.message ? String(args.message) : undefined,
            sensitiveAction: args.sensitive_action === "mask" ? "mask" : "abort",
            dryRun: args.dry_run === true || args.dry_run === "true",
          });
          const lines = [result.message];
          if (result.targetDir) lines.push(`目标目录: ${result.targetDir}`);
          if (typeof result.copiedFiles === "number") lines.push(`复制文件: ${result.copiedFiles}`);
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
