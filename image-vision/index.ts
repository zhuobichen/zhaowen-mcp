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
import { describeImage, editImage, generateImage, getVisionConfig } from "./vision.js";

/**
 * **识图默认关，生图不受影响。**
 *
 * `describe_image` 是给"后端看不见图"的时代准备的（DeepSeek 之类的纯文本模型）。
 * 现在主模型自己就能读图（Read 工具直接把图片当输入），这个工具就重复了：多一次
 * 出境、多一份钱、还多一个可能读错的中转描述。
 *
 * 但它**不是没用了**——换个纯文本后端时它仍然是对的答案。所以这里是"默认不注册、
 * 要就显式打开"，而不是删掉：设 `VISION_DESCRIBE_ENABLED=true` 即可。
 *
 * 与生图**没有任何关系**：两者共用一份端点配置，但一个读一个写，生命周期不该绑在
 * 一起——所以这个开关只管识图那一个工具。
 */
const DESCRIBE_ENABLED =
  String(process.env.VISION_DESCRIBE_ENABLED || "").trim().toLowerCase() === "true";

async function main() {
  const server = new Server(
    { name: "image-vision", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...(DESCRIBE_ENABLED ? [{
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
      }] : []),
      {
        name: "check_vision_status",
        description: "检查视觉 API 配置状态",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "generate_image",
        // 模型名**读运行时配置**，不再写死：这里原来硬编码 "gpt-image-2-ca"，
        // 而实际跑的是 IMAGE_MODEL 指的那个（当时是 gpt-image-2.5）——工具说明与实际
        // 不符，看说明的人会以为是另一个模型。
        description:
          `生成图片并保存到本地文件，返回文件路径。基于 ${process.env.IMAGE_MODEL || "gpt-image-2-ca"} 模型。`,
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
      {
        name: "edit_image",
        // 与 generate_image 的区别必须写清楚：前者是"从零画一张"，后者是"改已有的图"。
        // 早先没有这个工具时，`generate_image` 被当成能改图用过——它做不到，
        // 它的 body 里根本没有图片入参。
        description:
          `在**已有图片**上做编辑（图生图）：传入 1~4 张本地图片 + 编辑指令，返回编辑后的文件路径。` +
          `适用「把这行字改掉」「换个背景」「基于这两张图合成」这类需求。` +
          `只给文字从零画图请用 generate_image。基于 ${process.env.IMAGE_MODEL || "gpt-image-2-ca"} 模型。`,
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "编辑指令（必填）。写清「改什么、其余保持不变」最稳",
            },
            images: {
              type: "array",
              items: { type: "string" },
              description: "输入图片的绝对路径，1~4 张",
            },
            size: {
              type: "string",
              description: "输出尺寸，如 1024x1024（默认）",
            },
            output_path: {
              type: "string",
              description: "可选：保存到本地的完整文件路径（默认当前目录/generated_images/）",
            },
          },
          required: ["prompt", "images"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "describe_image": {
          // 关着的时候也要答得像话：客户端可能还留着旧的工具清单（注册发生在连接时），
          // 这时一句"未知工具"会让人以为坏了，而不是"这个开关关着"。
          if (!DESCRIBE_ENABLED) {
            return {
              content: [
                {
                  type: "text",
                  text: "识图已关闭（默认如此）：主模型自己就能读图，直接让它看图片即可。"
                    + "若确实需要走视觉模型，设 VISION_DESCRIBE_ENABLED=true 后重连本服务。",
                },
              ],
            };
          }
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
                  `- 读图模型: ${config.model}`,
                  `- 读图工具: ${DESCRIBE_ENABLED ? "已启用" : "默认关闭（主模型自带识图）"}`,
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

        case "edit_image": {
          const prompt = String(args.prompt || "").trim();
          if (!prompt) {
            return {
              content: [{ type: "text", text: "错误: 请提供编辑指令 prompt" }],
            };
          }
          const imgs = Array.isArray(args.images)
            ? args.images.map((x: any) => String(x))
            : (args.images ? [String(args.images)] : []);
          if (!imgs.length) {
            return {
              content: [{ type: "text", text: "错误: 请提供至少一张输入图片（images，绝对路径数组）" }],
            };
          }
          const missing = imgs.filter((p: string) => !existsSync(p));
          if (missing.length) {
            return {
              content: [{ type: "text", text: `错误: 这些输入图片不存在:\n  ${missing.join("\n  ")}` }],
            };
          }
          const outPath = await editImage(prompt, {
            images: imgs,
            size: args.size ? String(args.size) : undefined,
            outputPath: args.output_path ? String(args.output_path) : undefined,
          });
          return {
            content: [{ type: "text", text: `已编辑并保存: ${outPath}` }],
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
