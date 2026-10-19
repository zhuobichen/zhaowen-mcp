#!/usr/bin/env npx tsx
/**
 * DeepSeek Search MCP Server
 *
 * 把 DeepSeek 的「网页搜索与抓取」两个接口包成 MCP 工具：
 * - deepseek_search: POST /v1/tools/search  按 query 搜索，返回结构化结果
 * - deepseek_fetch : POST /v1/tools/fetch   抓单个网页，返回 Markdown 正文
 * - check_status   : 只读检查配置（不发请求，因此不产生费用）
 *
 * 鉴权与 DeepSeek API 同一套 Bearer；Base URL 可配。
 * 官方文档: https://api-docs.deepseek.com/zh-cn/guides/search/
 *
 * 计费与限制（官方）：
 * - 5 元 / 1000 次**成功**请求（Search、Fetch 各算）
 * - 只有 HTTP 200 且产生结果才计费；无结果/失败/超时不计费
 * - count 只控制返回条数，不影响单次价格（10 条与 50 条同价）
 * - QPS 各 5，且是**账号级**（与用哪个 key 无关）；Fetch 还对目标域名单独限速
 *
 * 启动: npx tsx E:/CodeProject/mcp-server/deepseek-search/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const VERSION = "1.0.0";
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

/** 取 API Key。DEEPSEEK_API_KEY 优先；直连 DeepSeek 的 Claude Code 会话里
 *  只有 ANTHROPIC_AUTH_TOKEN，那本来就是同一个 DeepSeek key，兜底用它。 */
function resolveKey(): { key: string | null; source: string } {
  if (process.env.DEEPSEEK_API_KEY) {
    return { key: process.env.DEEPSEEK_API_KEY, source: "DEEPSEEK_API_KEY" };
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      key: process.env.ANTHROPIC_AUTH_TOKEN,
      source: "ANTHROPIC_AUTH_TOKEN（兜底：Claude Code 直连 api.deepseek.com 时用的就是这个）",
    };
  }
  return { key: null, source: "未设置" };
}

/** 官方给的状态码含义，直接照抄，错误信息里带上，省得再去翻文档。 */
const HTTP_HINT: Record<number, string> = {
  400: "请求头或请求体不合法（JSON 格式错 / 字段值无效）",
  401: "API Key 缺失或无效",
  402: "账号余额不足，需充值",
  403: "Fetch 请求被安全策略拒绝",
  404: "Fetch 未能获取可用的网页内容（URL 不可用 / 被站点策略拦截 / 目标站返回错误 / 内容类型不支持 / 无可提取正文）",
  408: "读取请求体超时",
  413: "请求体超过大小限制",
  429: "超过 Search 或 Fetch 的 QPS 限制（账号级各 5 QPS）",
  500: "DeepSeek 服务端内部错误",
  504: "下游请求超时",
};

async function callApi(
  path: "/v1/tools/search" | "/v1/tools/fetch",
  body: unknown
): Promise<{ ok: true; data: any } | { ok: false; text: string }> {
  const { key, source } = resolveKey();
  if (!key) {
    return {
      ok: false,
      text:
        "未配置 API Key。请设置环境变量 DEEPSEEK_API_KEY（或 ANTHROPIC_AUTH_TOKEN）。\n" +
        `当前 key 来源：${source}`,
    };
  }

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, text: `网络请求失败：${e?.message ?? String(e)}` };
  }

  const raw = await resp.text();
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* 非 JSON，下面按状态码处理 */
  }

  if (!resp.ok) {
    const hint = HTTP_HINT[resp.status] ?? "未知错误";
    const detail = data?.error
      ? `${data.error.message}（type=${data.error.type ?? "?"}, code=${data.error.code ?? "?"}）`
      : raw.slice(0, 400);
    const retry =
      resp.status === 402
        ? "→ 充值后重试。"
        : resp.status === 408 || resp.status === 429 || resp.status >= 500
        ? "→ 等待后重试（可退避）。"
        : "→ 不修改请求的话重试无用。";
    return {
      ok: false,
      text: `HTTP ${resp.status}：${hint}\n${detail}\n${retry}\n（此请求未计费）`,
    };
  }

  return { ok: true, data };
}

function fmtScore(v: unknown): string {
  if (typeof v !== "number") return "?";
  return v >= 1.5 ? `${v.toFixed(2)}（优质）` : `${v.toFixed(2)}`;
}

function fmtAuthority(v: unknown): string {
  if (typeof v !== "number" || v < 0) return "未知";
  return v >= 3 ? `${v}（极权威）` : String(v);
}

async function main() {
  const server = new Server(
    { name: "deepseek-search", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "deepseek_search",
        description:
          "用 DeepSeek 自研搜索引擎检索网页，返回结构化结果（含 rerank_score 相关性、authority 权威性、date 时间、snippet 短摘要、summary 长摘要、可选正文）。" +
          "支持搜索语法：site: / -site: / -关键词 / -\"短语\" / \"精确短语\" / lang:zh,en / after:2025 / before:2026-06-01。",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "搜索词，1–128 个 Unicode 字符，不能全为空白。可组合操作符，如：DeepSeek 模型 site:github.com lang:zh after:2025",
            },
            count: {
              type: "number",
              description: "返回条数，1–50，默认 10。⚠️ 不影响计费（10 条与 50 条同价），能多拿就多拿。",
              minimum: 1,
              maximum: 50,
            },
            need_content: {
              type: "boolean",
              description: "是否在结果里返回网页正文（content 字段），默认 false。开启后返回体积会大很多。",
            },
            ori_question: {
              type: "string",
              description: "触发搜索的原始用户问题（1–128 字符），有助于理解搜索意图，可选。",
            },
            localization: {
              type: "string",
              description: "用于优先返回本地化结果的 IP 地址，可选，一般不用填。",
            },
            raw: {
              type: "boolean",
              description: "为 true 时返回原始 JSON，而不是格式化文本。默认 false。",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "deepseek_fetch",
        description:
          "抓取单个网页并返回 Markdown 正文。受目标站点可用性与访问策略影响（403/404 会失败）。",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "要抓取的网页地址，HTTP/HTTPS，必须含 host，不能带用户名密码，≤8192 字符。",
            },
            raw: {
              type: "boolean",
              description: "为 true 时返回原始 JSON。默认 false。",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "check_status",
        description:
          "只读检查配置：Base URL、API Key 来源、以及计费/限速要点。不发任何网络请求，因此不产生费用。",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const a = args as Record<string, unknown>;

    try {
      switch (name) {
        case "deepseek_search": {
          const query = String(a.query ?? "").trim();
          if (!query) {
            return { content: [{ type: "text", text: "query 不能为空" }], isError: true };
          }
          if ([...query].length > 128) {
            return {
              content: [{ type: "text", text: `query 超长：${[...query].length} 字符（上限 128）` }],
              isError: true,
            };
          }

          const count = Math.min(50, Math.max(1, Number(a.count ?? 10) || 10));
          const payload: Record<string, unknown> = {
            query,
            count,
            need_content: Boolean(a.need_content ?? false),
          };
          if (a.ori_question) payload.ori_question = String(a.ori_question);
          if (a.localization) payload.localization = String(a.localization);

          const r = await callApi("/v1/tools/search", payload);
          if (!r.ok) {
            return { content: [{ type: "text", text: r.text }], isError: true };
          }

          const results: any[] = r.data?.results ?? [];
          if (a.raw) {
            return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
          }
          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `无搜索结果（空数组）。\nquery: ${query}\n（⚠️ 空结果不计费）`,
                },
              ],
            };
          }

          const out: string[] = [
            `共 ${results.length} 条。rerank_score ≥1.5 为优质，authority ≥3 为极权威。`,
            "",
          ];
          results.forEach((it, i) => {
            out.push(`[${i + 1}] ${it.title ?? "(无标题)"}`);
            out.push(`    URL: ${it.url ?? ""}`);
            out.push(
              `    分数 ${fmtScore(it.rerank_score)} · 权威 ${fmtAuthority(it.authority)} · ${
                it.date ?? "日期未知"
              }${it.site_name ? ` · ${it.site_name}` : ""}`
            );
            const summary = it.summary || it.snippet;
            if (summary) out.push(`    摘要：${summary}`);
            if (it.content) {
              const body = String(it.content);
              out.push(
                `    正文（${body.length} 字符，截断显示）：${body.slice(0, 300)}${
                  body.length > 300 ? "…" : ""
                }`
              );
            }
            out.push("");
          });
          return { content: [{ type: "text", text: out.join("\n") }] };
        }

        case "deepseek_fetch": {
          const url = String(a.url ?? "").trim();
          if (!url) {
            return { content: [{ type: "text", text: "url 不能为空" }], isError: true };
          }
          const r = await callApi("/v1/tools/fetch", { url });
          if (!r.ok) {
            return { content: [{ type: "text", text: r.text }], isError: true };
          }
          if (a.raw) {
            return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
          }
          const title = r.data?.title || "(无标题)";
          const content = r.data?.content || "";
          return {
            content: [
              {
                type: "text",
                text: `# ${title}\n\nURL: ${url}\n正文 ${content.length} 字符\n\n${content}`,
              },
            ],
          };
        }

        case "check_status": {
          const { key, source } = resolveKey();
          const text = [
            "DeepSeek Search/Fetch 配置",
            `  Base URL : ${BASE_URL}`,
            `  API Key  : ${key ? `已设置（${key.length} 字符，来源 ${source}）` : "未设置"}`,
            "",
            "计费（官方）",
            "  Search / Fetch 各 5 元 / 1000 次**成功**请求",
            "  只有 HTTP 200 且产生结果才计费；无结果、失败、超时不计费",
            "  count 只控制条数，不影响单次价格（10 条与 50 条同价）",
            "",
            "限速（官方）",
            "  QPS 各 5，且是**账号级**（与用哪个 key 无关）",
            "  Fetch 还对目标域名单独限速",
            "",
            "本工具不发网络请求，所以这次检查不产生费用。",
          ].join("\n");
          return { content: [{ type: "text", text }] };
        }

        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }], isError: true };
      }
    } catch (e: any) {
      return { content: [{ type: "text", text: `错误: ${e?.message ?? String(e)}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
