#!/usr/bin/env npx tsx
/**
 * Image Vision MCP Server
 *
 * 提供 describe_image 工具，调用视觉模型 API 识别图片内容。
 * 解决 DeepSeek 等纯文本后端无法处理图片的问题。
 *
 * 启动: npx tsx mcp-server/image-vision/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "fs";
import { describeImage, generateImage, getVisionConfig } from "./vision.js";

async function main() {
  const server = new Server(
    { name: "image-vision", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "describe_image",
        description:
          "识别并描述图片内容。传入图片文件路径，返回图片的中文文字描述。支持 PNG/JPEG/GIF/WebP/BMP/TIFF 格式。",
        inputSchema: {
          type: "object",
          properties: {
            image_path: {
              type: "string",
              description: "图片文件的绝对路径",
            },
            prompt: {
              type: "string",
              description: "可选的自定义提示词，用于指定识别重点（如'只识别文字'）",
            },
          },
          required: ["image_path"],
        },
      },
      {
        name: "check_vision_status",
        description: "检查视觉 API 配置状态",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "generate_image",
        description:
          "生成图片并保存到本地文件，返回文件路径。基于 gpt-image-2-ca 模型。",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "图片生成提示词（必填）",
            },
            size: {
              type: "string",
              description: "图片尺寸，如 1024x1024（默认）",
            },
            output_path: {
              type: "string",
              description: "可选：保存到本地的完整文件路径（默认当前目录/generated_images/）",
            },
          },
          required: ["prompt"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "describe_image": {
          const imagePath = String(args.image_path);
          if (!existsSync(imagePath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `错误: 图片文件不存在: ${imagePath}`,
                },
              ],
            };
          }

          const description = await describeImage(
            imagePath,
            args.prompt ? String(args.prompt) : undefined
          );

          return {
            content: [
              {
                type: "text",
                text: `[图片描述] ${imagePath}:\n\n${description}`,
              },
            ],
          };
        }

        case "check_vision_status": {
          const config = getVisionConfig();
          const hasKey = !!config.apiKey;
          return {
            content: [
              {
                type: "text",
                text: [
                  `视觉 API 配置状态:`,
                  `- API Key: ${hasKey ? "已配置 ✓" : "未配置 ✗"}`,
                  `- API URL: ${config.apiUrl}`,
                  `- 模型: ${config.model}`,
                  `- 生图模型: ${process.env.IMAGE_MODEL || "gpt-image-2-ca"}`,
                  hasKey ? "" : "\n请设置环境变量 VISION_API_KEY 来启用识图功能。",
                ].join("\n"),
              },
            ],
          };
        }

        case "generate_image": {
          const prompt = String(args.prompt || "").trim();
          if (!prompt) {
            return {
              content: [{ type: "text", text: "错误: 请提供图片生成提示词 prompt" }],
            };
          }
          const outputPath = await generateImage(prompt, {
            size: args.size ? String(args.size) : undefined,
            outputPath: args.output_path ? String(args.output_path) : undefined,
          });
          return {
            content: [{ type: "text", text: `已生成图片: ${outputPath}` }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `未知工具: ${name}` }],
          };
      }
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `错误: ${e.message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
