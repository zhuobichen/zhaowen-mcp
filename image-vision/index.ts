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
import {
  describeImage,
  editImage,
  generateImage,
  getVisionConfig,
  type ImageGenResult,
} from "./vision.js";

/**
 * 生图/改图的统一回执。
 *
 * **只报请求参数是不够的**：中转可以悄悄换模型，而生成物本身不带模型元数据，
 * 事后从图片上反查不出来。所以这里把「服务端回报的模型」和「请求的模型」分开写，
 * 没回报就明说没回报 —— 别拿请求值冒充。
 */
function imageReceipt(lead: string, r: ImageGenResult): string {
  const lines = [`${lead}: ${r.path}`];
  lines.push(
    r.model
      ? `服务端回报模型: ${r.model}（请求的: ${r.requestedModel}）`
      : `⚠️ 服务端没有回报模型名（请求的是 ${r.requestedModel}）—— 实际用了哪个，这份回执里查不到`
  );
  if (r.usage) lines.push(`用量: ${JSON.stringify(r.usage)}`);
  lines.push(`元数据: ${r.metaPath}`);
  return lines.join("\n");
}

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
            provider: {
              type: "string",
              description:
                "可选：指定后端。doubao=本地豆包桌面版（约 15 秒/张、2048×2048，产物带可见水印「豆包 AI 生成」）；" +
                "http=one-hub（默认，IMAGE_MODEL 指的那个）。不传则按环境变量 IMAGE_PROVIDER。",
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
          `只给文字从零画图请用 generate_image。` +
          `后端随 IMAGE_PROVIDER：默认走 one-hub 的 ${process.env.IMAGE_MODEL || "gpt-image-2-ca"}；` +
          `provider="doubao" 则走本地豆包桌面版（把底图当参考图送进对话，版式/文字保留得好，产物带可见水印）。`,
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
              description: "输出尺寸，如 1024x1024（默认）。**豆包后端忽略它**（客户端里选不了尺寸）",
            },
            output_path: {
              type: "string",
              description: "可选：保存到本地的完整文件路径（默认当前目录/generated_images/）",
            },
            provider: {
              type: "string",
              description:
                "可选：指定后端。doubao=本地豆包桌面版（把底图当参考图送进它的对话界面，约 30~60 秒/张，" +
                "产物带可见水印「豆包 AI 生成」）；不传=看环境变量 IMAGE_PROVIDER，默认 http（one-hub）。",
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
          const provider = (process.env.IMAGE_PROVIDER || "http").trim().toLowerCase();
          const lines = [
            `视觉 API 配置状态:`,
            `- API Key: ${hasKey ? "已配置 ✓" : "未配置 ✗"}`,
            `- API URL: ${config.apiUrl}`,
            `- 读图模型: ${config.model}`,
            `- 读图工具: ${DESCRIBE_ENABLED ? "已启用" : "默认关闭（主模型自带识图）"}`,
            `- 生图后端: ${provider === "doubao" ? "doubao（本地豆包桌面版，CDP）" : "http（one-hub）"}`,
            provider === "doubao"
              ? `   端点: ${process.env.DOUBAO_CDP_URL || "http://127.0.0.1:9333"}`
              : `   模型: ${process.env.IMAGE_MODEL || "gpt-image-2-ca"}`,
          ];
          if (provider === "doubao") {
            const { doubaoStatus } = await import("./doubao.js");
            const st = await doubaoStatus();
            lines.push(
              `   豆包实例: ${st.reachable ? "调试端口通 ✓" : "连不上 ✗ " + (st.error || "")}`,
              `   聊天页: ${st.chatTargetUrl || "未找到"}`,
              `   输入框: ${st.composerVisible ? "可见 ✓" : "不可见 ✗（界面没起来或没登录）"}`
            );
          }
          if (!hasKey && provider !== "doubao") lines.push(`\n请设置环境变量 VISION_API_KEY 来启用识图功能。`);
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "generate_image": {
          const prompt = String(args.prompt || "").trim();
          if (!prompt) {
            return {
              content: [{ type: "text", text: "错误: 请提供图片生成提示词 prompt" }],
            };
          }
          const out = await generateImage(prompt, {
            size: args.size ? String(args.size) : undefined,
            outputPath: args.output_path ? String(args.output_path) : undefined,
            provider: args.provider ? String(args.provider) : undefined,
          });
          return {
            content: [{ type: "text", text: imageReceipt("已生成图片", out) }],
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
          const out = await editImage(prompt, {
            images: imgs,
            size: args.size ? String(args.size) : undefined,
            outputPath: args.output_path ? String(args.output_path) : undefined,
            provider: args.provider ? String(args.provider) : undefined,
          });
          return {
            content: [{ type: "text", text: imageReceipt("已编辑并保存", out) }],
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
