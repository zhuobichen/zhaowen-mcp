/**
 * 视觉 API 调用模块 — 将图片编码为 base64 发送给视觉模型获取文字描述。
 *
 * 支持通过环境变量配置：
 *   VISION_API_KEY  - API Key（必填）
 *   VISION_API_URL  - API 端点，默认 Anthropic
 *   VISION_MODEL    - 模型名，默认 claude-haiku-4-5-20251001
 */
import { readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};

function detectMimeType(filePath: string): string {
  const ext = basename(filePath).split(".").pop()?.toLowerCase() || "";
  // Fallback: read magic bytes for common types
  if (MIME_MAP[ext]) return MIME_MAP[ext];
  const buf = readFileSync(filePath);
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/png"; // fallback
}

export interface VisionConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

export function getVisionConfig(): VisionConfig {
  const apiKey = process.env.VISION_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const apiUrl = process.env.VISION_API_URL || process.env.VISION_BASE_URL || "https://api.anthropic.com/v1/messages";
  const model = process.env.VISION_MODEL || "claude-haiku-4-5-20251001";
  return { apiKey, apiUrl, model };
}

export async function describeImage(
  imagePath: string,
  prompt?: string
): Promise<string> {
  const config = getVisionConfig();
  if (!config.apiKey) {
    throw new Error(
      "未配置视觉 API Key。请设置环境变量 VISION_API_KEY 或 ANTHROPIC_AUTH_TOKEN"
    );
  }

  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");
  const mediaType = detectMimeType(imagePath);

  const userPrompt = prompt || "请用中文详细描述这张图片的内容，包括文字、人物、场景、物体等所有可见元素。";

  const isAnthropic = config.apiUrl.includes("anthropic.com");

  if (isAnthropic) {
    // Anthropic Messages API
    const body = JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });

    const resp = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`视觉 API 错误 ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await resp.json()) as any;
    return data?.content?.[0]?.text || "(API 返回空内容)";
  } else {
    // OpenAI-compatible API (通义千问/DeepSeek 视觉模型等)
    // 自动补全 /chat/completions 路径
    const endpoint = config.apiUrl.endsWith("/chat/completions")
      ? config.apiUrl
      : config.apiUrl.replace(/\/$/, "") + "/chat/completions";
    const body = JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mediaType};base64,${base64}`,
              },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`视觉 API 错误 ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await resp.json()) as any;
    return data?.choices?.[0]?.message?.content || "(API 返回空内容)";
  }
}

// ==================== 图片生成 ====================

export interface ImageGenOptions {
  size?: string;       // 图片尺寸,默认 "1024x1024"
  outputPath?: string; // 保存路径,默认 process.cwd()/generated_images/gen_<ts>.png
}

/**
 * 生成图片并保存到本地,返回绝对文件路径。
 *
 * 配置环境变量:
 *   IMAGE_API_KEY  - API Key(必填,fallback VISION_API_KEY / ANTHROPIC_AUTH_TOKEN)
 *   IMAGE_BASE_URL - 端点(必填,fallback VISION_API_URL)
 *   IMAGE_MODEL    - 模型名,默认 gpt-image-2-ca
 */
export async function generateImage(
  prompt: string,
  opts: ImageGenOptions = {}
): Promise<string> {
  const apiKey =
    process.env.IMAGE_API_KEY || process.env.VISION_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const baseUrl = (
    process.env.IMAGE_BASE_URL || process.env.VISION_API_URL || ""
  ).replace(/\/$/, "");
  const model = process.env.IMAGE_MODEL || "gpt-image-2-ca";

  if (!apiKey) {
    throw new Error(
      "未配置图片生成 API Key。请设置环境变量 IMAGE_API_KEY 或 VISION_API_KEY"
    );
  }
  if (!baseUrl) {
    throw new Error(
      "未配置图片生成 API 端点。请设置环境变量 IMAGE_BASE_URL 或 VISION_API_URL"
    );
  }
  if (!prompt || !prompt.trim()) {
    throw new Error("图片生成提示词不能为空");
  }

  const size = opts.size || "1024x1024";
  const endpoint = baseUrl + "/images/generations";
  const body = JSON.stringify({
    model,
    prompt,
    size,
    n: 1,
    response_format: "b64_json",
  });

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`图片生成 API 错误 ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as any;
  const item = data?.data?.[0];
  if (!item) {
    throw new Error("图片生成 API 返回空数据");
  }

  let imgBuffer: Buffer;
  if (item.b64_json) {
    imgBuffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const imgResp = await fetch(item.url);
    if (!imgResp.ok) {
      throw new Error(`下载生成图片失败: ${imgResp.status}`);
    }
    imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  } else {
    throw new Error("图片生成 API 返回格式未知(无 b64_json/url)");
  }

  const ts = Date.now();
  const outputPath =
    opts.outputPath || join(process.cwd(), "generated_images", `gen_${ts}.png`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, imgBuffer);

  return outputPath;
}
