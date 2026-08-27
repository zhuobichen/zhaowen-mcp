/**
 * 代码审阅 API 调用模块 — 调用 OpenAI 兼容 chat/completions (one-hub) 审阅代码。
 *
 * 支持通过环境变量配置：
 *   REVIEW_API_KEY  - API Key（必填，fallback VISION_API_KEY）
 *   REVIEW_API_URL  - API 端点，默认 https://one-hub.hycx-gd.cn/v1（fallback VISION_API_URL）
 *   REVIEW_MODEL    - 模型名，默认 glm-5.2
 */
export interface ReviewConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

export function getReviewConfig(): ReviewConfig {
  const apiKey = process.env.REVIEW_API_KEY || process.env.VISION_API_KEY || "";
  const apiUrl = (
    process.env.REVIEW_API_URL ||
    process.env.VISION_API_URL ||
    "https://one-hub.hycx-gd.cn/v1"
  ).replace(/\/$/, "");
  const model = process.env.REVIEW_MODEL || "glm-5.2";
  return { apiKey, apiUrl, model };
}

export interface ReviewOptions {
  focus?: string;
  context?: { file?: string; language?: string };
}

const SYSTEM_PROMPT = `你是资深代码审阅专家，精通多种编程语言与工程实践。
请审阅用户提供的代码，按严重程度分类输出：
【严重问题】会导致崩溃、数据丢失、安全漏洞或明显逻辑错误的问题
【潜在风险】边界情况、并发、性能、兼容性方面的隐患
【改进建议】可读性、代码规范、架构层面的优化建议
每一类按序号列出，标注大致行号/代码片段，说明原因并给出修复建议。
最后给出总体评价（1-5 星）与建议的优先修复顺序。
使用简体中文回复。若代码无明显问题，请如实说明并给出可优化方向。`;

export async function reviewCode(
  code: string,
  opts: ReviewOptions = {}
): Promise<string> {
  const config = getReviewConfig();
  if (!config.apiKey) {
    throw new Error("未配置审阅 API Key。请设置环境变量 REVIEW_API_KEY 或 VISION_API_KEY");
  }
  if (!code.trim()) {
    throw new Error("审阅内容不能为空");
  }

  const fileLine = opts.context?.file ? `文件：${opts.context.file}\n` : "";
  const focusLine = opts.focus ? `本次审阅重点：${opts.focus}\n` : "";
  const userPrompt = `${fileLine}${focusLine}以下是待审阅的代码：\n\`\`\`\n${code}\n\`\`\``;

  const endpoint = config.apiUrl + "/chat/completions";
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
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
    throw new Error(`审阅 API 错误 ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as any;
  const msg = data?.choices?.[0]?.message;
  const content = (msg?.content || "").trim();
  const reasoning = (msg?.reasoning_content || "").trim();

  if (!content && !reasoning) {
    return "(模型未返回内容，请检查 REVIEW_MODEL 是否可用)";
  }
  if (content && reasoning) {
    return `[模型推理过程（仅供参考）]\n${reasoning}\n\n---\n\n${content}`;
  }
  return content || reasoning;
}
