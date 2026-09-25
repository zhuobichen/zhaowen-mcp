/**
 * 与小红书引擎通信的适配层 + 参数加工。
 *
 * ## 为什么不自己实现发布
 *
 * 小红书的登录与发布靠浏览器自动化，前端选择器是易碎品。上游项目
 * （xpzouying / vmxmy 的 `xiaohongshu-mcp`）已经把这部分做成了**本身就是 MCP 服务**，
 * 工具名两家一致（`publish_content` / `search_feeds` / `get_feed_detail` …）。
 * 所以本服务**代理上游的 MCP 工具**，而不是绑某一家的 REST 路径：
 * 换引擎只要工具名不变就照常工作。
 *
 * ## 这一层加的是什么
 *
 * 上游的 `publish_content` 是"照单全收"的：标题多长、正文里混没混 `#标签`、
 * 图片路径在不在，它都不管，失败了才由平台回错。本层在**发出去之前**把这些挡住：
 *
 * - 标题超 20 字 → 直接报错（并给出截断后的样子），不浪费一次发布；
 * - 正文里的 `#话题` → **自动移到 `tags` 参数**（上游明确要求正文不要带标签，
 *   但人和模型都极容易写进去）；
 * - 本地图片路径 → 逐个校验存在性与扩展名；
 * - 引擎没启动 → 给人话（含启动命令），而不是 ECONNREFUSED 堆栈。
 *
 * ## stdio 的铁律
 *
 * stdout 归 MCP 协议，**任何日志都必须走 stderr**。这里只提供 `log()`，
 * 并且全文件不出现 `console.log`。
 */
import { existsSync } from "node:fs";
import { extname } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const DEFAULT_ENGINE_URL = "http://localhost:18060/mcp";
export const ENGINE_URL =
  (process.env.XHS_ENGINE_URL ?? "").trim() || DEFAULT_ENGINE_URL;
export const CALL_TIMEOUT_MS = Number(process.env.XHS_TIMEOUT_MS ?? 180_000);

/** stdio 安全日志：一律 stderr。 */
export function log(...args: unknown[]): void {
  console.error("[xiaohongshu]", ...args);
}

// ══════════════════════════════════════════════════════════
// 与引擎的连接
// ══════════════════════════════════════════════════════════

let client: Client | null = null;
let connecting: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const c = new Client({ name: "xiaohongshu-mcp", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENGINE_URL));
  await c.connect(transport);
  log("已连接引擎", ENGINE_URL);
  return c;
}

/** 复用一个连接；失败时清掉以便下次重连。 */
export async function getClient(): Promise<Client> {
  if (client) return client;
  if (!connecting) {
    connecting = connect()
      .then((c) => {
        client = c;
        connecting = null;
        return c;
      })
      .catch((e) => {
        connecting = null;
        throw e;
      });
  }
  return connecting;
}

export async function closeEngine(): Promise<void> {
  const c = client;
  client = null;
  toolCache = null;          // 重连后可能换了引擎，工具集要重新问
  if (c) {
    try {
      await c.close();
    } catch {
      /* 关闭失败不重要 */
    }
  }
}

/** 把连接层异常翻译成人能看懂的话。 */
export function describeConnectionError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|socket hang up|ECONNRESET/i.test(msg)) {
    return [
      `连不上小红书引擎（${ENGINE_URL}）。`,
      "",
      "引擎不是本服务的一部分，需要你自己起一个（两个都行，工具名一致）：",
      "  · Docker： docker compose up -d      # 来自 xpzouying/xiaohongshu-mcp 或 vmxmy/xiaohongshu-mcp",
      "  · 二进制： ./xiaohongshu-mcp          # 默认监听 18060",
      "",
      "起来之后先跑一次登录（用 xhs_login_qrcode 拿二维码，手机小红书 App 扫码）。",
      `原始错误：${msg}`,
    ].join("\n");
  }
  return msg;
}

export interface EngineResult {
  /** 文本形式的结果（各段文本拼接）。 */
  text: string;
  /** 原始返回，供调用方按需取结构。 */
  raw: unknown;
  isError: boolean;
}

function textOf(raw: unknown): string {
  const content = (raw as { content?: unknown })?.content;
  if (!Array.isArray(content)) return JSON.stringify(raw, null, 2);
  const parts: string[] = [];
  for (const c of content) {
    const item = c as { type?: string; text?: string; data?: string; mimeType?: string };
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    else if (item.type === "image") parts.push(`（引擎返回了一张图片，${item.mimeType ?? "未知类型"}）`);
    else parts.push(JSON.stringify(item));
  }
  return parts.join("\n\n");
}

/**
 * 调用引擎的一个工具。
 *
 * 连接断了（引擎重启/会话过期）会**重连一次**再试——上游是 HTTP 会话制的，
 * 它重启之后旧会话就没了，不重连的话每次调用都要用户手动重开 MCP。
 */
export async function callEngine(
  tool: string,
  args: Record<string, unknown>,
  { retry = true }: { retry?: boolean } = {},
): Promise<EngineResult> {
  const c = await getClient();
  try {
    const raw = await c.callTool({ name: tool, arguments: args }, undefined, {
      timeout: CALL_TIMEOUT_MS,
    });
    return {
      text: textOf(raw),
      raw,
      isError: Boolean((raw as { isError?: boolean })?.isError),
    };
  } catch (e) {
    await closeEngine();
    if (retry) {
      log(`调用 ${tool} 失败，重连后重试一次：`, e instanceof Error ? e.message : e);
      return callEngine(tool, args, { retry: false });
    }
    throw e;
  }
}

/** 引擎暴露了哪些工具——用于 xhs_status 与排错。 */
export async function engineToolNames(): Promise<string[]> {
  const c = await getClient();
  const r = await c.listTools();
  return (r.tools ?? []).map((t: { name: string }) => t.name).sort();
}

let toolCache: { at: number; names: Set<string> } | null = null;

/** 带缓存的引擎工具集（30 秒），避免每次调用都多一个往返。 */
export async function engineTools(): Promise<Set<string>> {
  if (toolCache && Date.now() - toolCache.at < 30_000) return toolCache.names;
  const names = new Set(await engineToolNames());
  toolCache = { at: Date.now(), names };
  return names;
}

/**
 * **两个引擎的工具集不一样**，调用前必须先确认。
 *
 * 实测（xpzouying 的 `mcp_server.go`，main 分支）：它有
 * `check_login_status / get_login_qrcode / publish_content / publish_with_video /
 * list_feeds / search_feeds / get_feed_detail / user_profile / get_my_profile /
 * likes / comments / notifications`，
 * **但没有 `save_draft`、`get_my_feeds`、`delete_feed`**——这三个是 vmxmy 那版才有的。
 *
 * 所以不能假设"工具名通用"：引擎没有就当场说清楚它有什么、能拿什么替代，
 * 而不是把上游的 "unknown tool" 原样抛给用户。
 */
export async function requireTool(tool: string, purpose: string): Promise<void> {
  const names = await engineTools();
  if (names.has(tool)) return;
  const all = [...names].sort();
  const stem = tool.split("_")[0];
  const near = all.filter((n) => n.includes(stem));
  throw new Error(
    [
      `这个引擎没有提供 ${tool}（${purpose}），本工具用不了。`,
      `它提供的工具是：${all.join(", ")}`,
      near.length ? `名字相近的：${near.join(", ")}` : "",
      "不同引擎的工具集不一样：xpzouying 版没有 save_draft / get_my_feeds / delete_feed，vmxmy 版有。",
      "可以换引擎，或用 xhs_raw 直接调它能提供的工具。",
    ].filter(Boolean).join("\n"),
  );
}

// ══════════════════════════════════════════════════════════
// 参数加工（本服务真正的价值）
// ══════════════════════════════════════════════════════════

export const TITLE_MAX_CHARS = 20;
export const IMAGE_MAX = 18;
/**
 * 正文长度提醒线。**只提醒不硬拦**：小红书各端历史上限不一（约 1000～2000 字，
 * 且变过），硬拦会把本来能发的内容挡在外面；但超了大概率发不出，得让人知道。
 */
export const CONTENT_WARN_CHARS = 1000;

/** 小红书正文**不渲染 markdown**，写进去会原样显示。 */
export function findMarkdownLeftovers(content: string): string[] {
  const hits: string[] = [];
  if (/\*\*[^*]+\*\*/.test(content)) hits.push("**加粗**");
  if (/^#{1,6}\s/m.test(content)) hits.push("## 标题");
  if (/`[^`]+`/.test(content)) hits.push("`代码`");
  if (/~~[^~]+~~/.test(content)) hits.push("~~删除线~~");
  if (/\[[^\]]+\]\([^)]+\)/.test(content)) hits.push("[文字](链接)");
  if (/^\s*[-*+]\s/m.test(content)) hits.push("- 列表");
  return hits;
}
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

export interface NoteInput {
  title?: string;
  content?: string;
  images?: string[];
  tags?: string[];
  location?: string;
  note_type?: string;
}

export interface NotePayload {
  title: string;
  content: string;
  images: string[];
  tags: string[];
  location?: string;
  note_type?: string;
}

/** 字符数按**码点**算：`"𠮷"` 这类补平面字符不能被算成 2 个字。 */
export function charLen(s: string): number {
  return Array.from(s).length;
}

/** 从正文里抽出 `#话题`，返回清理后的正文与话题列表。 */
export function splitTagsInContent(
  content: string,
  given: string[],
): { content: string; tags: string[]; moved: string[] } {
  const moved: string[] = [];
  // 话题名允许中英文、数字、下划线、短横线；遇到空格/标点结束。
  const cleaned = content.replace(/#([^\s#,，。；;：:！!？?、（）()\[\]【】"“”'‘’]{1,30})/g, (_m, name: string) => {
    moved.push(name);
    return "";
  });
  const norm = (t: string) => t.replace(/^#+/, "").trim();
  const all = [...given, ...moved].map(norm).filter((t) => t.length > 0);
  const tags: string[] = [];
  for (const t of all) if (!tags.includes(t)) tags.push(t);
  // 抽掉标签后可能出现连续空格/行首空行，收拾一下
  const tidy = cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+(\n|$)/g, "$1")
    .trim();
  return { content: tidy, tags, moved };
}

export interface Normalised {
  payload: NotePayload;
  warnings: string[];
}

/**
 * 校验并组装要发给引擎的参数。**任何一项不合格都抛错**，绝不带着已知问题去发。
 * 返回的 payload 就是 dry_run 预览与实际发送的同一个对象。
 */
export function normaliseNote(input: NoteInput): Normalised {
  const warnings: string[] = [];

  const title = (input.title ?? "").trim();
  if (!title) throw new Error("标题不能为空。");
  if (charLen(title) > TITLE_MAX_CHARS) {
    const cut = Array.from(title).slice(0, TITLE_MAX_CHARS).join("");
    throw new Error(
      `标题 ${charLen(title)} 字，超过小红书上限 ${TITLE_MAX_CHARS} 字。` +
        `\n截到上限是：「${cut}」\n请改短后重发（标题里不要放话题标签，标签走 tags）。`,
    );
  }

  const rawContent = (input.content ?? "").trim();
  if (!rawContent) throw new Error("正文不能为空。");

  const { content, tags, moved } = splitTagsInContent(
    rawContent,
    input.tags ?? [],
  );
  if (moved.length) {
    warnings.push(
      `正文里的 ${moved.map((m) => "#" + m).join("、")} 已自动移到话题（tags）——` +
        `上游要求正文不带标签，否则话题不生效。`,
    );
  }

  const images = (input.images ?? []).map((s) => s.trim()).filter(Boolean);
  if (images.length > IMAGE_MAX) {
    throw new Error(`图片 ${images.length} 张，超过上限 ${IMAGE_MAX} 张。`);
  }
  const missing: string[] = [];
  const badExt: string[] = [];
  for (const im of images) {
    if (/^https?:\/\//i.test(im)) continue; // 网络图交给引擎
    if (!existsSync(im)) {
      missing.push(im);
      continue;
    }
    const ext = extname(im).toLowerCase();
    if (!IMAGE_EXT.has(ext)) badExt.push(`${im}（${ext || "无扩展名"}）`);
  }
  if (missing.length) {
    throw new Error(
      `这些本地图片不存在：\n  ${missing.join("\n  ")}\n` +
        `（路径要写绝对路径；网络图片请用 http(s) 链接）`,
    );
  }
  if (badExt.length) {
    throw new Error(
      `这些图片格式上游可能不支持：\n  ${badExt.join("\n  ")}\n` +
        `支持 ${[...IMAGE_EXT].join(" / ")}`,
    );
  }
  if (images.length === 0) {
    warnings.push(
      "没有传图片。上游的 publish_content 一般要求至少 1 张图，纯文字笔记请先确认引擎版本支持，否则很可能失败。",
    );
  }

  // 正文太长：只提醒。实测自己写的一篇 1522 字的稿子就被这条拦下过。
  const nChars = charLen(content);
  if (nChars > CONTENT_WARN_CHARS) {
    warnings.push(
      `正文 ${nChars} 字，超过约 ${CONTENT_WARN_CHARS} 字的常见上限：可能发不出去，` +
        `建议压缩（小红书正文不是长文场景）。`,
    );
  }

  // markdown 残留：小红书正文不渲染 markdown，`**加粗**` 会原样显示成星号。
  // 这类"换个平台就不渲染"的写法，在论文、图注、帖子里已经咬过好几次了。
  const md = findMarkdownLeftovers(content);
  if (md.length) {
    warnings.push(
      `正文里有 markdown 写法（${md.join("、")}）——小红书**不渲染** markdown，` +
        `会原样显示成符号。建议换成【】或 emoji 分段。`,
    );
  }

  const payload: NotePayload = { title, content, images, tags };
  if (input.location?.trim()) payload.location = input.location.trim();
  if (input.note_type?.trim()) payload.note_type = input.note_type.trim();
  return { payload, warnings };
}

/** dry_run 与出错时给人看的样子。 */
export function renderPreview(payload: NotePayload, warnings: string[]): string {
  const L: string[] = [];
  L.push("【即将发送给引擎的参数】");
  L.push(`标题（${charLen(payload.title)}/${TITLE_MAX_CHARS} 字）：${payload.title}`);
  if (payload.tags.length) L.push(`话题：${payload.tags.join("、")}`);
  if (payload.location) L.push(`位置：${payload.location}`);
  if (payload.note_type) L.push(`笔记类型：${payload.note_type}`);
  L.push(`图片（${payload.images.length} 张）：`);
  for (const im of payload.images) L.push(`  - ${im}`);
  L.push("");
  L.push("正文：");
  L.push(payload.content);
  if (warnings.length) {
    L.push("");
    L.push("【提醒】");
    for (const w of warnings) L.push(`  · ${w}`);
  }
  return L.join("\n");
}
