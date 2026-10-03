import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, redact, type Config } from "./lib/config.js";
import {
  listFolders,
  matches,
  readMessage,
  recentMessages,
  withClient,
  type MessageMeta,
} from "./lib/imap.js";

// ---------------------------------------------------------------- 工具实现

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

function fmtDate(iso: string): string {
  if (!iso) return "?";
  // 输出本地时间，方便人看；ISO 留给机器
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function line(m: MessageMeta): string {
  const flags = [m.seen ? "" : "未读", m.hasAttachments ? "有附件" : ""].filter(Boolean).join(" ");
  return `- uid=${m.uid}  ${fmtDate(m.date)}  ${flags ? `[${flags}] ` : ""}${fmtSize(m.size)}\n    ${m.subject}\n    发件: ${m.from || "?"}`;
}

function parseKeywords(q: string): string[] {
  return (q || "")
    .split(/[\s,，、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 本地日期过滤；since/until 都是 YYYY-MM-DD，闭区间。 */
function inDateRange(m: MessageMeta, since?: string, until?: string): boolean {
  if (!since && !until) return true;
  const d = (m.date || "").slice(0, 10);
  if (!d) return true;
  if (since && d < since) return false;
  if (until && d > until) return false;
  return true;
}

async function toolCheckStatus(cfg: Config): Promise<string> {
  const out: string[] = [];
  out.push("## 配置");
  out.push(`  账号: ${cfg.user || "(未设置 QQMAIL_USER)"}`);
  out.push(`  授权码: ${cfg.authCode ? "已设置（" + cfg.authCode.length + " 位）" : "(未设置 QQMAIL_AUTH_CODE)"}`);
  out.push(`  服务器: ${cfg.host}:${cfg.port} secure=${cfg.secure}`);
  out.push(`  默认文件夹: ${cfg.defaultFolder}`);
  out.push(`  搜索扫描量: 最近 ${cfg.scanLimit} 封`);
  out.push("");
  if (!cfg.user || !cfg.authCode) {
    out.push("**凭据不全，无法连接。**");
    out.push("请在 MCP 注册的 env 里设置 QQMAIL_USER 与 QQMAIL_AUTH_CODE（授权码不是登录密码），改完重开会话。");
    return out.join("\n");
  }
  out.push("## 连通性");
  try {
    const r = await withClient(async (client) => {
      const folders = await listFolders(client);
      const box = await client.mailboxOpen(cfg.defaultFolder, { readOnly: true });
      return { folders: folders.length, inboxTotal: box.exists };
    });
    out.push(`  登录成功。文件夹 ${r.folders} 个；${cfg.defaultFolder} 里共 ${r.inboxTotal} 封。`);
    out.push("  连接以 **readOnly** 打开，本服务不具备改动的能力。");
  } catch (e: any) {
    out.push(`  连接失败: ${redact(String(e?.message ?? e), cfg)}`);
  }
  return out.join("\n");
}

async function toolListFolders(cfg: Config): Promise<string> {
  return withClient(async (client) => {
    const folders = await listFolders(client);
    const out = [`# 文件夹（共 ${folders.length} 个）`, ""];
    for (const f of folders) {
      const tag = f.specialUse ? `  [${f.specialUse}]` : "";
      out.push(`- ${f.path}${tag}`);
    }
    out.push("");
    out.push("用 `list_recent` 或 `search` 时，folder 传上面这个路径。");
    return out.join("\n");
  });
}

async function toolListRecent(cfg: Config, args: any): Promise<string> {
  const folder = String(args.folder ?? cfg.defaultFolder);
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  return withClient(async (client) => {
    const msgs = await recentMessages(client, folder, limit);
    if (!msgs.length) return `${folder} 里没有邮件。`;
    const unread = msgs.filter((m) => !m.seen).length;
    const out = [`# ${folder} 最近 ${msgs.length} 封（其中未读 ${unread} 封）`, ""];
    for (const m of msgs) out.push(line(m));
    out.push("");
    out.push("读正文用 `read_message`，传 uid 和 folder。");
    return out.join("\n");
  });
}

async function toolSearch(cfg: Config, args: any): Promise<string> {
  const q = String(args.q ?? "").trim();
  const keywords = parseKeywords(q);
  const folder = String(args.folder ?? cfg.defaultFolder);
  const scan = Math.min(Math.max(Number(args.scan_limit) || cfg.scanLimit, 10), 2000);
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), cfg.maxResults);
  const since = args.since ? String(args.since) : undefined;
  const until = args.until ? String(args.until) : undefined;
  const unreadOnly = args.unread_only === true || args.unread_only === "true";

  return withClient(async (client) => {
    const msgs = await recentMessages(client, folder, scan);
    const hits = msgs.filter(
      (m) => matches(m, keywords) && inDateRange(m, since, until) && (!unreadOnly || !m.seen)
    );
    const head = [
      `# 搜索「${q || "(全部)"}」in ${folder}`,
      `扫描最近 ${msgs.length} 封` +
        (since || until ? `，日期 ${since || "…"} ~ ${until || "…"}` : "") +
        (unreadOnly ? "，只要未读" : "") +
        ` → 命中 ${hits.length} 封`,
      "",
    ];
    if (!hits.length) {
      head.push("没有命中。");
      head.push("");
      head.push("注意：本服务**扫描范围是最近 " + scan + " 封**，不是全邮箱。");
      head.push("更早的邮件请调大 `scan_limit`，或先把 folder 换成具体文件夹（如已归档的）再搜。");
      return head.join("\n");
    }
    for (const m of hits.slice(0, limit)) head.push(line(m));
    if (hits.length > limit) head.push(`\n…另有 ${hits.length - limit} 封命中的没列出来（调大 limit）。`);
    head.push("");
    head.push("读正文用 `read_message`，传 uid 和 folder。");
    return head.join("\n");
  });
}

async function toolReadMessage(cfg: Config, args: any): Promise<string> {
  const uid = Number(args.uid);
  if (!Number.isFinite(uid)) return "错误: 需要 uid（数字，从 list_recent 或 search 的结果里拿）";
  const folder = String(args.folder ?? cfg.defaultFolder);
  return withClient(async (client) => {
    const m = await readMessage(client, folder, uid, cfg.maxBodyChars);
    if (!m) return `在 ${folder} 里找不到 uid=${uid} 的邮件（可能已被移动或 uid 不属于该文件夹）。`;
    const out = [
      `# ${m.subject}`,
      "",
      `- 发件: ${m.from}`,
      `- 收件: ${m.to}`,
      m.cc ? `- 抄送: ${m.cc}` : "",
      `- 时间: ${fmtDate(m.date)}`,
      `- uid: ${m.uid}  文件夹: ${folder}`,
      "",
    ].filter(Boolean);

    if (m.attachments.length) {
      out.push(`## 附件（${m.attachments.length} 个，本服务只列清单，不下载）`);
      for (const a of m.attachments) out.push(`- ${a.filename}  ${fmtSize(a.size)}  ${a.contentType}`);
      out.push("");
    }

    out.push("## 正文");
    out.push(m.text || "(这封信没有纯文本正文。可能只有 HTML——本服务不解析 HTML，避免把标签糊你一脸。)");
    return out.join("\n");
  });
}

// ---------------------------------------------------------------- MCP 装配

async function main() {
  const cfg = loadConfig();
  const server = new Server({ name: "qqmail-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

  const TOOLS = [
    {
      name: "check_status",
      description: "检查 QQ 邮箱配置与连通性：账号、服务器、能否登录、默认文件夹有多少封。排障先跑这个。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_folders",
      description: "列出 QQ 邮箱的所有文件夹（含已发送、草稿等特殊文件夹），用于确定 search/list_recent 的 folder 参数。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_recent",
      description: "列出某个文件夹里最近的邮件（主题/发件人/时间/未读/有无附件）。只读头部，不取正文。",
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "可选：文件夹路径，默认 INBOX" },
          limit: { type: "number", description: "可选：列多少封，默认 20，上限 100" },
        },
      },
    },
    {
      name: "search",
      description:
        "按关键词搜邮件（多个词用空格分隔，全部命中才算）。**在本地对最近 N 封的头部做匹配，不用 IMAP 的 SEARCH**——" +
        "因为 QQ 邮箱对中文的 IMAP 搜索支持不稳，会安静地返回空。可加日期范围、只看未读。",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "关键词，如「发票」「github 通知」；留空=不按关键词过滤" },
          folder: { type: "string", description: "可选：文件夹路径，默认 INBOX" },
          scan_limit: { type: "number", description: "可选：扫描最近多少封，默认 300" },
          limit: { type: "number", description: "可选：最多返回多少条，默认 20" },
          since: { type: "string", description: "可选：起始日期 YYYY-MM-DD（含）" },
          until: { type: "string", description: "可选：截止日期 YYYY-MM-DD（含）" },
          unread_only: { type: "boolean", description: "可选：只看未读" },
        },
      },
    },
    {
      name: "read_message",
      description: "读一封邮件的正文（纯文本）与附件清单。需要 uid 和 folder。不下载附件、不改已读状态。",
      inputSchema: {
        type: "object",
        properties: {
          uid: { type: "number", description: "邮件 uid，从 list_recent 或 search 的结果里拿" },
          folder: { type: "string", description: "可选：文件夹路径，默认 INBOX" },
        },
        required: ["uid"],
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const c = loadConfig();
    try {
      switch (name) {
        case "check_status":
          return { content: [{ type: "text", text: await toolCheckStatus(c) }] };
        case "list_folders":
          return { content: [{ type: "text", text: await toolListFolders(c) }] };
        case "list_recent":
          return { content: [{ type: "text", text: await toolListRecent(c, args) }] };
        case "search":
          return { content: [{ type: "text", text: await toolSearch(c, args) }] };
        case "read_message":
          return { content: [{ type: "text", text: await toolReadMessage(c, args) }] };
        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      const msg = redact(String(e?.message ?? e), c);
      return { content: [{ type: "text", text: `错误: ${msg}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
