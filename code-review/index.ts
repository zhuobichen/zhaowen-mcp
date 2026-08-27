#!/usr/bin/env npx tsx
/**
 * Code Review MCP Server
 *
 * 提供 review_file / review_diff 工具，调用 one-hub (OpenAI 兼容) 的 glm-5.2 审阅代码。
 * 解决文本模型审阅代码需要手动复制粘贴的问题。
 *
 * 启动: npx tsx mcp-server/code-review/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "fs";
import { reviewCode, getReviewConfig } from "./review.js";

const MAX_FILE_SIZE = 200 * 1024; // 200KB 上限

function truncateCode(code: string, maxLen: number = 30000): string {
  if (code.length <= maxLen) return code;
  return code.slice(0, maxLen) + `\n\n... [已截断，原内容共 ${code.length} 字符]`;
}

async function main() {
  const server = new Server(
    { name: "code-review", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "review_file",
        description:
          "审阅指定代码文件，返回按严重程度分级的代码问题与改进建议。传入文件绝对路径。",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "要审阅的代码文件绝对路径",
            },
            focus: {
              type: "string",
              description: "可选：审阅重点（如 安全性 / 性能 / 并发 / 特定函数名）",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "review_diff",
        description:
          "审阅一段代码片段或 git diff 文本，返回按严重程度分级的代码问题与改进建议。",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "代码片段或 diff 文本",
            },
            focus: {
              type: "string",
              description: "可选：审阅重点（如 安全性 / 性能 / 并发 / 特定函数名）",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "check_review_status",
        description: "检查代码审阅 API 配置状态",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "review_file": {
          const filePath = String(args.file_path);
          if (!existsSync(filePath)) {
            return {
              content: [{ type: "text", text: `错误: 文件不存在: ${filePath}` }],
            };
          }

          const raw = readFileSync(filePath, "utf-8");
          if (raw.length > MAX_FILE_SIZE) {
            return {
              content: [
                {
                  type: "text",
                  text: `错误: 文件过大 (${raw.length} 字符 > ${MAX_FILE_SIZE} 上限)，请用 review_diff 分段审阅`,
                },
              ],
            };
          }

          const result = await reviewCode(truncateCode(raw), {
            focus: args.focus ? String(args.focus) : undefined,
            context: { file: filePath },
          });

          return {
            content: [{ type: "text", text: `[代码审阅] ${filePath}:\n\n${result}` }],
          };
        }

        case "review_diff": {
          const code = String(args.code || "").trim();
          if (!code) {
            return { content: [{ type: "text", text: "错误: 请提供 code 参数" }] };
          }

          const result = await reviewCode(truncateCode(code), {
            focus: args.focus ? String(args.focus) : undefined,
          });

          return { content: [{ type: "text", text: `[代码审阅结果]:\n\n${result}` }] };
        }

        case "check_review_status": {
          const config = getReviewConfig();
          return {
            content: [
              {
                type: "text",
                text: [
                  "代码审阅 API 配置状态:",
                  `- API Key: ${config.apiKey ? "已配置 ✓" : "未配置 ✗"}`,
                  `- API URL: ${config.apiUrl}`,
                  `- 模型: ${config.model}`,
                  config.apiKey ? "" : "\n请设置环境变量 REVIEW_API_KEY 来启用审阅功能。",
                ].join("\n"),
              },
            ],
          };
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

main().catch(console.error);
