/**
 * PreToolUse Hook — 拦截 Read 工具对图片文件的调用，自动识图。
 *
 * 被 Claude Code settings.json 中的 hooks.PreToolUse 调用。
 * 使用方式: settings.json 中配置:
 *   "command": "node /path/to/image-vision/hook.mjs"
 *
 * 逻辑:
 *   1. 检测 Read 的文件是否为图片（按扩展名 + magic bytes）
 *   2. 如果是图片 → 调用视觉 API 获取描述 → 重定向 Read 到临时文本文件
 *   3. 如果不是图片 → 透传（不干预）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";

// ---------- 图片检测 ----------

const IMG_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg", ".ico",
]);

const MIME_MAP = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  tiff: "image/tiff", svg: "image/svg+xml",
};

function isImageFile(filePath) {
  const ext = basename(filePath).toLowerCase();
  for (const ie of IMG_EXTENSIONS) {
    if (ext.endsWith(ie)) return true;
  }
  // magic bytes fallback
  try {
    const buf = readFileSync(filePath);
    if (buf.length < 4) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
    if (buf[0] === 0x89 && buf[1] === 0x50) return true; // PNG
    if (buf[0] === 0x47 && buf[1] === 0x49) return true; // GIF
    if (buf[0] === 0x52 && buf[1] === 0x49) return true; // WebP
    if (buf[0] === 0x42 && buf[1] === 0x4d) return true; // BMP
  } catch { /* permission error */ }
  return false;
}

function detectMimeType(filePath) {
  const ext = basename(filePath).split(".").pop()?.toLowerCase() || "";
  if (MIME_MAP[ext]) return MIME_MAP[ext];
  return "image/png";
}

// ---------- 视觉 API 调用 ----------

function getVisionConfig() {
  const apiKey = process.env.VISION_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const apiUrl = process.env.VISION_API_URL || "https://api.anthropic.com/v1/messages";
  const model = process.env.VISION_MODEL || "claude-haiku-4-5-20251001";
  return { apiKey, apiUrl, model };
}

async function callVisionAPI(imagePath) {
  const config = getVisionConfig();
  if (!config.apiKey) {
    console.error("[image-vision hook] 未配置 VISION_API_KEY，跳过识图");
    return null;
  }

  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");
  const mediaType = detectMimeType(imagePath);
  const isAnthropic = config.apiUrl.includes("anthropic.com");

  const userPrompt =
    "请用中文详细描述这张图片的内容，包括文字、人物、场景、物体等所有可见元素。";

  let body, headers, reqUrl;

  if (isAnthropic) {
    reqUrl = config.apiUrl;
    body = JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: userPrompt },
        ],
      }],
    });
    headers = {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    };
  } else {
    reqUrl = config.apiUrl.endsWith("/chat/completions")
      ? config.apiUrl
      : config.apiUrl.replace(/\/$/, "") + "/chat/completions";
    body = JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
          { type: "text", text: userPrompt },
        ],
      }],
    });
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    };
  }

  const resp = await fetch(reqUrl, { method: "POST", headers, body });
  if (!resp.ok) {
    console.error(`[image-vision hook] API 错误 ${resp.status}`);
    return null;
  }

  const data = await resp.json();
  if (isAnthropic) {
    return data?.content?.[0]?.text || null;
  } else {
    return data?.choices?.[0]?.message?.content || null;
  }
}

// ---------- 主流程 ----------

async function main() {
  // 读取 stdin
  let inputJson = "";
  for await (const chunk of process.stdin) {
    inputJson += chunk;
  }

  let input;
  try {
    input = JSON.parse(inputJson);
  } catch {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  const { tool_name, tool_input } = input;
  const filePath = tool_input?.file_path;

  // 不是 Read 工具或没有 file_path → 透传
  if (tool_name !== "Read" || !filePath) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  // 不是图片 → 透传
  if (!isImageFile(filePath)) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  // 是图片 → 调用视觉 API
  const description = await callVisionAPI(filePath);

  if (!description) {
    // API 失败，透传（让 Read 正常执行，可能模型能处理或用户能看到错误）
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  // 写入临时文本文件
  const tempDir = join(tmpdir(), "image-vision-hook");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
  const tempFile = join(tempDir, `desc_${Date.now()}.txt`);
  const fileName = basename(filePath);
  writeFileSync(
    tempFile,
    `[图片文件: ${fileName}]\n\n以下是视觉模型对这张图片的识别描述:\n\n${description}`,
    "utf-8"
  );

  // 返回 hook 响应：允许 Read 但重定向到文本描述文件
  const response = {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        file_path: tempFile,
      },
    },
    systemMessage: `[图片识别] 检测到图片 "${fileName}"，已自动调用视觉模型识别内容。\n\n图片描述:\n${description}`,
  };

  console.log(JSON.stringify(response));
}

main().catch((e) => {
  console.error(`[image-vision hook] 错误:`, e.message);
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
