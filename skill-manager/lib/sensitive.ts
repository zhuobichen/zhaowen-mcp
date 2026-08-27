/**
 * 敏感信息检测 + 脱敏替换。
 * 只检查文本文件（扩展名白名单）；二进制跳过。上传前 abort/mask 由上层决定。
 */
import { promises as fs } from "fs";
import * as path from "path";

export interface SensitiveRule {
  id: string;
  category: string;
  label: string;
  pattern: RegExp;
  placeholder?: string;
}

export const SENSITIVE_RULES: SensitiveRule[] = [
  { id: "pass-1", category: "密码", label: "键值对明文密码", pattern: /\b(password|passwd|pass_word|pwd)\b\s*[:=]\s*\S+/i, placeholder: "<密码>" },
  { id: "pass-2", category: "密码", label: "中文密码/口令（冒号分隔）", pattern: /(密码|口令)\s*[:：]\s*\S+/, placeholder: "<密码>" },
  { id: "pass-3", category: "密码", label: "中文密码/口令（空格分隔）", pattern: /(密码|口令)\s+[\w@.\-]{4,}/, placeholder: "<密码>" },
  { id: "acct-1", category: "账号", label: "键值对账号", pattern: /\b(username|user_id|account|login)\b\s*[:=]\s*\S+/i, placeholder: "<账号>" },
  { id: "acct-2", category: "账号", label: "中文账号", pattern: /账号\s*[:：]\s*\S+/, placeholder: "<账号>" },
  { id: "key-1", category: "API Key", label: "OpenAI/DeepSeek 风格 key", pattern: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/, placeholder: "<API Key>" },
  { id: "key-2", category: "API Key", label: "api_key 键值", pattern: /\bapi[_-]?key\b\s*[:=]\s*\S+/i, placeholder: "<API Key>" },
  { id: "key-3", category: "密钥", label: "secret 键值", pattern: /\b(secret|client_secret|app_secret)\b\s*[:=]\s*\S+/i, placeholder: "<Secret>" },
  { id: "key-4", category: "密钥", label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/, placeholder: "<AWS Key>" },
  { id: "tok-1", category: "Token", label: "token/bearer 键值", pattern: /\b(access_token|refresh_token|auth_token|bearer)\b\s*[:=]\s*[^\s,;]{4,}/i, placeholder: "<Token>" },
  { id: "tok-2", category: "Token", label: "Authorization Bearer", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/, placeholder: "<Token>" },
  { id: "tok-3", category: "Token", label: "x-api-key 头", pattern: /x-api-key\s*[:=]\s*\S+/i, placeholder: "<Token>" },
  { id: "ip-1", category: "内网 IP", label: "10.x 私网", pattern: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/, placeholder: "<内网IP>" },
  { id: "ip-2", category: "内网 IP", label: "172.16-31.x 私网", pattern: /\b(172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, placeholder: "<内网IP>" },
  { id: "ip-3", category: "内网 IP", label: "192.168.x 私网", pattern: /\b(192\.168\.\d{1,3}\.\d{1,3})\b/, placeholder: "<内网IP>" },
  { id: "dom-1", category: "内网域名", label: "内网域名后缀", pattern: /\b[\w.-]+\.(local|lan|internal|corp|localdomain)\b/i, placeholder: "<域名>" },
];

export const TEXT_FILE_EXT = new Set([
  ".md", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".mts", ".cts",
  ".py", ".sh", ".bash", ".ps1", ".json", ".yaml", ".yml", ".toml",
  ".ini", ".cfg", ".conf", ".env", ".txt", ".csv", ".xml", ".html",
  ".css", ".sql", ".log", ".vue", ".java", ".go", ".rs", ".c", ".cpp",
  ".h", ".rb", ".php",
]);

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__",
  ".venv", "venv", "output", ".publish-tmp",
]);

/** 凭据文件文件名（不读内容即命中） */
const CRED_FILENAME_RE =
  /^(\.env|\.env\.[a-z0-9]+|\.netrc|\.git-credentials|id_rsa|id_ed25519|credentials\.json|secrets\.(json|yaml)|[^.]*\.(pem|key))$/i;

export interface SensitiveHit {
  ruleId: string;
  category: string;
  label: string;
  file: string;
  line: number;
  sample: string;
}

export interface ScanResult {
  hits: SensitiveHit[];
  binarySkipped: number;
  filesChecked: number;
}

export function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_FILE_EXT.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return base === "makefile" || base === "dockerfile";
}

export function isCredFileName(filePath: string): boolean {
  return CRED_FILENAME_RE.test(path.basename(filePath));
}

/** 将命中行中匹配到的敏感值替换为占位符（保留第一个捕获组作键名前缀） */
export function maskLine(line: string, rule: SensitiveRule): string {
  return line.replace(rule.pattern, (m, g1?: string) => {
    const placeholder = rule.placeholder || "<占位符>";
    const key = g1 ? g1 + " " : "";
    return key + placeholder;
  });
}

async function walk(dir: string, onFile: (f: string) => Promise<void>): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      await walk(full, onFile);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      try {
        const st = await fs.stat(full);
        if (st.isFile()) await onFile(full);
      } catch {
        /* broken symlink 跳过 */
      }
    }
  }
}

/** 扫描文件或目录，返回敏感命中 + 统计 */
export async function scanPath(
  target: string,
  extraPattern?: string
): Promise<ScanResult> {
  const rules: SensitiveRule[] = extraPattern
    ? [...SENSITIVE_RULES, { id: "extra", category: "自定义", label: "用户自定义正则", pattern: new RegExp(extraPattern) }]
    : SENSITIVE_RULES;

  const hits: SensitiveHit[] = [];
  let binarySkipped = 0;
  let filesChecked = 0;

  async function scanFile(file: string): Promise<void> {
    if (isCredFileName(file)) {
      hits.push({
        ruleId: "file-1", category: "凭据文件", label: "凭据文件文件名",
        file, line: 0, sample: "<凭据文件名>",
      });
      return;
    }
    if (!isTextFile(file)) {
      binarySkipped++;
      return;
    }
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      binarySkipped++;
      return;
    }
    filesChecked++;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of rules) {
        if (rule.pattern.test(line)) {
          hits.push({
            ruleId: rule.id, category: rule.category, label: rule.label,
            file, line: i + 1, sample: line.trim().slice(0, 80) || "<空行>",
          });
        }
      }
    }
  }

  const stat = await fs.stat(target);
  if (stat.isFile()) {
    await scanFile(target);
  } else {
    await walk(target, scanFile);
  }
  return { hits, binarySkipped, filesChecked };
}

/** 对副本目录做就地脱敏（只改仓库副本，不改本地原文件） */
export async function maskDir(dir: string): Promise<number> {
  let masked = 0;
  async function maskFile(file: string): Promise<void> {
    if (!isTextFile(file)) return;
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      return;
    }
    const lines = content.split(/\r?\n/);
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      for (const rule of SENSITIVE_RULES) {
        if (rule.pattern.test(lines[i])) {
          lines[i] = maskLine(lines[i], rule);
          changed = true;
          masked++;
        }
      }
    }
    if (changed) await fs.writeFile(file, lines.join("\n"), "utf8");
  }
  await walk(dir, maskFile);
  return masked;
}
