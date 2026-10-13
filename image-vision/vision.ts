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

export interface ImageGenResult {
  path: string;
  /** 服务端在响应里**回报**的模型名。没给就是 null —— 不要拿请求值冒充。 */
  model: string | null;
  /** 我们请求时指定的模型（IMAGE_MODEL 或参数）。 */
  requestedModel: string;
  /** 服务端回报的用量（有就存，没有就 null）。 */
  usage: unknown;
  /** 元数据 sidecar 的落盘路径。 */
  metaPath: string;
}

/**
 * 把「请求了什么 / 服务端回报了什么」存一份 sidecar（`<图>.meta.json`）。
 *
 * 为什么非要当场记：**光看请求参数证明不了出图用的是哪个模型** —— 中转可以替换。
 * 而生成物本身通常不带模型元数据（实测这些 PNG 里只有一个 dpi 标签），
 * 所以事后从产物上是反查不出来的，证据只能在这个时刻攥住。
 */
async function writeMeta(
  outPath: string,
  meta: Record<string, unknown>
): Promise<string> {
  const metaPath = outPath + ".meta.json";
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  return metaPath;
}

/**
 * 生成图片并保存到本地,返回绝对文件路径。
 *
 * 配置环境变量:
 *   IMAGE_API_KEY  - API Key(必填,fallback VISION_API_KEY / ANTHROPIC_AUTH_TOKEN)
 *   IMAGE_BASE_URL - 端点,默认 https://one-hub.hycx-gd.cn/v1(fallback VISION_API_URL)
 *   IMAGE_MODEL    - 模型名,默认 gpt-image-2-ca
 */
export async function generateImage(
  prompt: string,
  opts: ImageGenOptions = {}
): Promise<ImageGenResult> {
  const apiKey =
    process.env.IMAGE_API_KEY || process.env.VISION_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const baseUrl = (
    process.env.IMAGE_BASE_URL || process.env.VISION_API_URL || "https://one-hub.hycx-gd.cn/v1"
  ).replace(/\/$/, "");
  const model = process.env.IMAGE_MODEL || "gpt-image-2-ca";

  if (!apiKey) {
    throw new Error(
      "未配置图片生成 API Key。请设置环境变量 IMAGE_API_KEY 或 VISION_API_KEY"
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

  const reportedModel = typeof data.model === "string" ? data.model : null;
  const usage = data.usage ?? null;
  const metaPath = await writeMeta(outputPath, {
    at: new Date().toISOString(),
    kind: "generate",
    endpoint,
    requestedModel: model,
    reportedModel,
    usage,
    prompt,
    size,
    outputPath,
  });

  return { path: outputPath, model: reportedModel, requestedModel: model, usage, metaPath };
}

// ==================== 图片编辑（图生图） ====================

export interface ImageEditOptions {
  images: string[];    // 输入图片的绝对路径（1~4 张）
  size?: string;       // 输出尺寸,默认 "1024x1024"
  outputPath?: string; // 保存路径,默认 process.cwd()/generated_images/edit_<ts>.png
}

/**
 * 在已有图片上做编辑,返回编辑后的绝对文件路径。
 *
 * 为什么必须单独一条:**`generateImage` 做不了这件事**。它打的是
 * `/images/generations`,body 里只有 model/prompt/size/n,**没有任何图片入参** ——
 * 说它"能改图"是把模型的编辑能力当成了这套代码的能力。图生图走的是
 * `/images/edits`,multipart 上传。
 *
 * 两个实测坑:
 * 1. 多图的字段名各家不一致(本机这份中转要 `image[]`,有的实现只认 `image`),
 *    所以第一次失败会自动换写法重试一次,而不是直接把错误抛给用户;
 * 2. 中转会**按 User-Agent 拦**——不带 UA 的脚本请求会拿到 403,那不是权限问题,
 *    所以这里显式带一个 UA。
 *
 * 环境变量与 `generateImage` 完全共用(IMAGE_API_KEY / IMAGE_BASE_URL / IMAGE_MODEL)。
 */
export async function editImage(
  prompt: string,
  opts: ImageEditOptions
): Promise<ImageGenResult> {
  const apiKey =
    process.env.IMAGE_API_KEY || process.env.VISION_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const baseUrl = (
    process.env.IMAGE_BASE_URL || process.env.VISION_API_URL || "https://one-hub.hycx-gd.cn/v1"
  ).replace(/\/$/, "");
  const model = process.env.IMAGE_MODEL || "gpt-image-2-ca";

  if (!apiKey) {
    throw new Error(
      "未配置图片生成 API Key。请设置环境变量 IMAGE_API_KEY 或 VISION_API_KEY"
    );
  }
  if (!prompt || !prompt.trim()) {
    throw new Error("图片编辑提示词不能为空");
  }
  const images = (opts.images || []).filter(Boolean);
  if (!images.length) {
    throw new Error("图生图至少要传一张输入图片(images)");
  }
  if (images.length > 4) {
    throw new Error(`图生图一次最多 4 张输入图片,收到 ${images.length} 张`);
  }

  const size = opts.size || "1024x1024";

  const buildForm = (field: string): FormData => {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("prompt", prompt);
    fd.append("size", size);
    fd.append("n", "1");
    for (const p of images) {
      const buf = readFileSync(p);
      fd.append(field, new Blob([buf], { type: detectMimeType(p) }), basename(p));
    }
    return fd;
  };

  const post = (field: string) =>
    fetch(baseUrl + "/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "OpenAI/Python 1.0",
      },
      body: buildForm(field) as any,
    });

  let usedField = "image[]";
  let resp = await post("image[]");
  if (!resp.ok) {
    const status = resp.status;
    const firstMsg = (await resp.text()).slice(0, 300);
    const alt = await post("image");
    if (!alt.ok) {
      const altMsg = (await alt.text()).slice(0, 300);
      throw new Error(
        `图片编辑 API 错误 ${status}: ${firstMsg}` +
          `（改用 image 字段重试仍失败 ${alt.status}: ${altMsg}）`
      );
    }
    resp = alt;
    usedField = "image";
  }

  const data = (await resp.json()) as any;
  const item = data?.data?.[0];
  if (!item) {
    throw new Error("图片编辑 API 返回空数据");
  }

  let imgBuffer: Buffer;
  if (item.b64_json) {
    imgBuffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const imgResp = await fetch(item.url);
    if (!imgResp.ok) {
      throw new Error(`下载编辑后图片失败: ${imgResp.status}`);
    }
    imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  } else {
    throw new Error("图片编辑 API 返回格式未知(无 b64_json/url)");
  }

  const outputPath =
    opts.outputPath || join(process.cwd(), "generated_images", `edit_${Date.now()}.png`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, imgBuffer);

  const reportedModel = typeof data.model === "string" ? data.model : null;
  const usage = data.usage ?? null;
  const metaPath = await writeMeta(outputPath, {
    at: new Date().toISOString(),
    kind: "edit",
    endpoint: baseUrl + "/images/edits",
    requestedModel: model,
    reportedModel,
    usage,
    field: usedField,
    inputs: images,
    prompt,
    size,
    outputPath,
  });

  return { path: outputPath, model: reportedModel, requestedModel: model, usage, metaPath };
}
