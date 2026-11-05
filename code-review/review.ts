/**
 * 代码审阅 API 调用模块 — 调用 OpenAI 兼容 chat/completions (one-hub) 审阅代码。
 *
 * 支持通过环境变量配置：
 *   REVIEW_API_KEY  - API Key（必填，fallback VISION_API_KEY）
 *   REVIEW_API_URL  - API 端点，默认 https://one-hub.hycx-gd.cn/v1（fallback VISION_API_URL）
 *   REVIEW_MODEL    - 模型名，默认 claude-sonnet-5
 *
 * 2026-10-18：默认值从 `glm-5.2` 改成 `claude-sonnet-5` —— one-hub 上已经没有 glm-5.x 了，
 * 旧默认会让每次审阅都 404 `model_not_found`（`check_review_status` 不报错，因为它只打印配置，
 * 不真的调一次）。选 sonnet-5 是"够强且比 opus 便宜"；要更深就 REVIEW_MODEL=claude-opus-5。
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
  const model = process.env.REVIEW_MODEL || "claude-sonnet-5";
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

const TIMEOUT_MS = Number(process.env.REVIEW_TIMEOUT_MS || 120_000);
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 带超时与有限重试的 POST。
 * 审计项：原来 fetch() 没有超时，上游不响应时 MCP 调用会无限挂起。
 * 只有 429/5xx 才重试；4xx 属于请求问题，重试也没用。
 */
async function postReview(endpoint: string, body: string, apiKey: string): Promise<Response> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e: any) {
      const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      lastErr = new Error(
        isTimeout
          ? `审阅 API 超时（${TIMEOUT_MS} ms，第 ${attempt} 次）`
          : `审阅 API 请求失败（第 ${attempt} 次）: ${e?.message || e}`
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
      throw lastErr;
    }

    if (resp.ok) return resp;

    const errText = await resp.text();
    lastErr = new Error(`审阅 API 错误 ${resp.status}: ${errText.slice(0, 300)}`);
    const retryable = resp.status === 429 || resp.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw lastErr;
    await sleep(1000 * attempt);
  }
  throw lastErr ?? new Error("审阅 API 调用失败");
}

export async function reviewCode(
  code: string,
  opts: ReviewOptions = {}
): Promise<string> {  const config = getReviewConfig();
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

  const resp = await postReview(endpoint, body, config.apiKey);

  let data: any;
  try {
    data = await resp.json();
  } catch {
    throw new Error("审阅 API 返回不是合法 JSON");
  }

  const msg = data?.choices?.[0]?.message;
  if (!msg || typeof msg !== "object") {
    throw new Error("审阅 API 返回结构异常：缺少 choices[0].message");
  }

  const content = typeof msg.content === "string" ? msg.content.trim() : "";
  if (content) return content;

  // 审计项：reasoning_content 是模型的思考草稿，不能当审阅结论回传。
  // 仅在显式打开 REVIEW_INCLUDE_REASONING=1 时单独返回，并标明它不是结论。
  if (process.env.REVIEW_INCLUDE_REASONING === "1") {
    const reasoning = typeof msg.reasoning_content === "string" ? msg.reasoning_content.trim() : "";
    if (reasoning) {
      return `[模型推理过程（REVIEW_INCLUDE_REASONING=1，非正式审阅结论）]\n${reasoning}`;
    }
  }

  return "(模型未返回内容，请检查 REVIEW_MODEL 是否可用)";
}
