import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { hasCredentials, loadConfig, MISSING_CREDENTIAL_HINT, type Config } from "./config.js";

/**
 * 只读连接。
 *
 * 这里刻意**不实现** SMTP、删除、标已读、移动、追加。
 * 而且每个邮箱都用 `readOnly: true` 打开——即便调用方写错也不会改动服务器上的邮件。
 */
export class NoCredentialsError extends Error {
  constructor() {
    super(MISSING_CREDENTIAL_HINT);
    this.name = "NoCredentialsError";
  }
}

export function requireConfig(): Config {
  const c = loadConfig();
  if (!hasCredentials(c)) throw new NoCredentialsError();
  return c;
}

/**
 * 建连、干活、无论如何都登出。
 * 每次调用一条新连接：偶尔用一次的工具，省掉连接池带来的状态泄漏风险。
 */
export async function withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const c = requireConfig();
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.authCode },
    logger: false, // 默认 logger 会往 stderr 打一堆东西；stderr 留给错误
    greetingTimeout: c.connectTimeoutMs,
    socketTimeout: c.connectTimeoutMs,
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      // 连接可能已经断了，登出失败不该盖住真正的错误
    }
  }
}

export interface FolderInfo {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: string;
  subscribed: boolean;
}

export async function listFolders(client: ImapFlow): Promise<FolderInfo[]> {
  const boxes = await client.list();
  return boxes.map((b) => ({
    path: b.path,
    name: b.name,
    delimiter: b.delimiter ?? "/",
    specialUse: b.specialUse,
    subscribed: Boolean(b.subscribed),
  }));
}

export interface MessageMeta {
  uid: number;
  seq: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  size: number;
  seen: boolean;
  hasAttachments: boolean;
}

function addrText(a: any): string {
  if (!a) return "";
  const list = Array.isArray(a) ? a : [a];
  return list
    .map((x) => (x?.name ? `${x.name} <${x.address ?? ""}>` : (x?.address ?? "")))
    .filter(Boolean)
    .join(", ");
}

/** 用 bodyStructure 判断有没有附件（比拉全文便宜）。 */
function structureHasAttachment(node: any): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(structureHasAttachment);
  return false;
}

/**
 * 取某个文件夹里最近 n 封的头部。
 *
 * 用序号区间（末尾 n 个）而不是 `1:*` 全量拉——大邮箱上全量拉会超时。
 */
export async function recentMessages(
  client: ImapFlow,
  folder: string,
  n: number
): Promise<MessageMeta[]> {
  const box = await client.mailboxOpen(folder, { readOnly: true });
  const total = box.exists;
  if (!total) return [];
  const from = Math.max(1, total - n + 1);
  const out: MessageMeta[] = [];
  for await (const msg of client.fetch(`${from}:${total}`, {
    uid: true,
    envelope: true,
    flags: true,
    size: true,
    bodyStructure: true,
  })) {
    const env: any = msg.envelope ?? {};
    out.push({
      uid: msg.uid,
      seq: msg.seq,
      subject: env.subject ?? "(无主题)",
      from: addrText(env.from),
      to: addrText(env.to),
      date: env.date ? new Date(env.date).toISOString() : "",
      size: msg.size ?? 0,
      seen: Boolean(msg.flags?.has?.("\\Seen")),
      hasAttachments: structureHasAttachment(msg.bodyStructure),
    });
  }
  // 按日期倒序（IMAP 给的是序号升序）
  out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return out;
}

export interface ParsedMessage {
  uid: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  messageId: string;
  text: string;
  attachments: { filename: string; size: number; contentType: string }[];
}

export async function readMessage(
  client: ImapFlow,
  folder: string,
  uid: number,
  maxBodyChars: number
): Promise<ParsedMessage | null> {
  await client.mailboxOpen(folder, { readOnly: true });
  const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
  if (!msg || !msg.source) return null;
  const parsed = await simpleParser(msg.source);
  const text = (parsed.text ?? "").trim();
  return {
    uid,
    subject: parsed.subject ?? "(无主题)",
    from: parsed.from?.text ?? "",
    to: Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text).join(", ") : ((parsed.to as any)?.text ?? ""),
    cc: Array.isArray(parsed.cc) ? parsed.cc.map((t: any) => t.text).join(", ") : ((parsed.cc as any)?.text ?? ""),
    date: parsed.date ? parsed.date.toISOString() : "",
    messageId: parsed.messageId ?? "",
    text: text.length > maxBodyChars ? text.slice(0, maxBodyChars) + `\n\n…（已截断，原文 ${text.length} 字符）` : text,
    attachments: (parsed.attachments ?? []).map((a: any) => ({
      filename: a.filename ?? "(未命名)",
      size: a.size ?? 0,
      contentType: a.contentType ?? "application/octet-stream",
    })),
  };
}

/**
 * 本地过滤式搜索。
 *
 * 为什么不用 IMAP 的 `SEARCH ... CHARSET UTF-8`：QQ 邮箱对非 ASCII 的搜索支持不稳，
 * 中文关键词经常直接搜不到（不是报错，是**安静地返回空**）。
 * 取头部在本地做子串匹配，中文没问题，代价是要多拉一点数据。
 */
export function matches(m: MessageMeta, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = `${m.subject}\n${m.from}\n${m.to}`.toLowerCase();
  return keywords.every((k) => hay.includes(k.toLowerCase()));
}
