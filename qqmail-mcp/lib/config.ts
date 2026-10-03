/**
 * 配置一律走环境变量。凭据只从环境读，**永不写进代码、日志或返回给模型的内容里**。
 */
export interface Config {
  user: string;
  authCode: string;
  host: string;
  port: number;
  secure: boolean;
  /** 默认打开的文件夹 */
  defaultFolder: string;
  /** 搜索时扫描最近多少封（IMAP 的中文搜索不可靠，改成取头部本地过滤） */
  scanLimit: number;
  /** 单次返回的邮件条数上限 */
  maxResults: number;
  /** 读正文时正文最多取多少字符 */
  maxBodyChars: number;
  connectTimeoutMs: number;
}

export const MISSING_CREDENTIAL_HINT =
  "未配置凭据。请在 MCP 注册的 env 里设置 QQMAIL_USER（你的 QQ 邮箱地址）与 " +
  "QQMAIL_AUTH_CODE（在 QQ 邮箱网页版 设置→账户→IMAP/SMTP服务 里生成的 16 位授权码，" +
  "不是 QQ 登录密码）。改完要重开会话才生效。";

export function loadConfig(): Config {
  const user = (process.env.QQMAIL_USER || "").trim();
  const authCode = (process.env.QQMAIL_AUTH_CODE || "").trim();
  return {
    user,
    authCode,
    host: (process.env.QQMAIL_IMAP_HOST || "imap.qq.com").trim(),
    port: Number(process.env.QQMAIL_IMAP_PORT || 993),
    secure: process.env.QQMAIL_IMAP_SECURE !== "false",
    defaultFolder: (process.env.QQMAIL_FOLDER || "INBOX").trim(),
    scanLimit: Number(process.env.QQMAIL_SCAN_LIMIT || 300),
    maxResults: Number(process.env.QQMAIL_MAX_RESULTS || 50),
    maxBodyChars: Number(process.env.QQMAIL_MAX_BODY_CHARS || 4000),
    connectTimeoutMs: Number(process.env.QQMAIL_TIMEOUT_MS || 20000),
  };
}

export function hasCredentials(c: Config): boolean {
  return Boolean(c.user && c.authCode);
}

/**
 * 任何要输出给模型/用户的文本都过这一层，避免授权码意外泄漏。
 * 只打码授权码——邮箱地址本身保留，否则用户看不出是哪封信。
 */
export function redact(text: string, c: Config): string {
  if (!c.authCode) return text;
  return text.split(c.authCode).join("***");
}
