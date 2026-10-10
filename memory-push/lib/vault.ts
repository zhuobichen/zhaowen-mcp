/**
 * vault 层通用能力：路径归一化与越界校验、frontmatter 解析、
 * Evergreen 卡片规范校验、目录递归遍历。
 *
 * 刻意不依赖 Obsidian CLI —— 它要求 Obsidian 进程常驻、不在 PATH 中、
 * 且输出面向人类阅读无稳定机器格式。
 */
import { promises as fs } from "fs";
import type { Dirent } from "fs";
import * as path from "path";

/** 遍历时跳过的目录名 */
export const SKIP_DIRS = new Set([
  ".git", "node_modules", ".obsidian", ".trash", "dist", "build",
  "__pycache__", ".venv", "venv", ".cache", ".publish-tmp",
]);

/** 单文件扫描上限，超过则跳过（知识库里的卡片都很小，大文件是附件） */
export const MAX_SCAN_FILE_BYTES = 512 * 1024;

export type PathCheck = { ok: true; rel: string } | { ok: false; error: string };

/** 把仓库相对路径归一化为 POSIX 风格，并拒绝越界/危险路径 */
export function normalizeRelPath(relPath: string): PathCheck {
  const raw = String(relPath ?? "").trim().replace(/\\/g, "/");
  if (!raw) return { ok: false, error: "路径为空" };
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, error: "请使用仓库内相对路径，不接受绝对路径" };
  }
  const segments = raw.split("/").filter((s) => s && s !== ".");
  if (segments.some((s) => s === "..")) return { ok: false, error: "路径不得包含 .." };
  if (segments.some((s) => s === ".git")) return { ok: false, error: "不得写入 .git 目录" };
  if (!segments.length) return { ok: false, error: "路径为空" };
  return { ok: true, rel: segments.join("/") };
}

/** 解析后的绝对路径必须仍落在 repoDir 内，否则返回 null */
export function resolveInside(repoDir: string, rel: string): string | null {
  const root = path.resolve(repoDir);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

export interface Frontmatter {
  /** frontmatter 原文（不含 --- 包裹） */
  raw: string;
  data: Record<string, string | string[]>;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** 极简 YAML 子集解析：只认顶层标量与「key:\n  - item」列表，够用于 Evergreen frontmatter */
export function parseFrontmatter(content: string): Frontmatter | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return null;
  const raw = m[1];
  const data: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      const prev = data[currentKey];
      const val = stripQuotes(listItem[1]);
      if (Array.isArray(prev)) prev.push(val);
      else data[currentKey] = [val];
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      const v = kv[2].trim();
      data[currentKey] = v ? stripQuotes(v) : [];
      continue;
    }
    currentKey = null;
  }
  return { raw, data };
}

/** 去掉 frontmatter，返回正文 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export interface CardValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/;

/**
 * Evergreen 卡片规范校验。针对知识库 Gotchas 里反复出现的坑做静态拦截，
 * 其中最关键的是 status 被 [[]] 包裹导致的死链（`obsidian unresolved`）。
 */
export function validateEvergreenCard(relPath: string, content: string): CardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const base = path.posix.basename(relPath);
  const stem = base.replace(/\.md$/i, "");
  if (ILLEGAL_FILENAME_CHARS.test(stem)) {
    errors.push(`文件名含非法字符 /\\:*?"<>|：${base}`);
  }
  if (base.length > 60) {
    warnings.push(`文件名 ${base.length} 字符，偏长（建议 ≤60，标题即观点且 ≤20 字）`);
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push("缺少 YAML frontmatter（--- 包裹）");
    return { ok: false, errors, warnings };
  }
  const { data } = fm;

  if (!data["categories"]) errors.push("frontmatter 缺少 categories");
  if (!data["created"]) errors.push("frontmatter 缺少 created");

  const tags = data["tags"];
  if (!tags) {
    errors.push("frontmatter 缺少 tags");
  } else {
    const tagList = Array.isArray(tags) ? tags : [tags];
    if (!tagList.includes("0🌲")) errors.push("tags 必须包含 0🌲（常青笔记标记）");
  }

  // 死链根因：status 被 wikilink 包裹
  const status = data["status"];
  const statusStr = Array.isArray(status) ? status.join(",") : String(status ?? "");
  if (statusStr.includes("[[")) {
    errors.push('status 不得用 [[]] 包裹（会产生死链），应为纯文本如「整理中」');
  }

  const body = stripFrontmatter(content);
  const h1 = body.match(/^#\s+\S/gm) ?? [];
  if (h1.length === 0) errors.push("正文缺少 H1 标题");
  if (h1.length > 1) errors.push(`正文有 ${h1.length} 个 H1，只允许一个（合并时易误追加）`);

  if (!/^##\s*来源\s*$/m.test(body)) {
    warnings.push("正文缺少「## 来源」区块");
  }

  const lineCount = body.split(/\r?\n/).length;
  if (lineCount > 200) {
    warnings.push(`正文 ${lineCount} 行偏长（>120 行时建议裂卡为多张原子卡并互链）`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** 递归遍历目录，收集满足条件的文件（返回绝对路径 + 相对 rootDir 的 POSIX 路径） */
export async function walkFiles(
  rootDir: string,
  predicate: (abs: string, rel: string) => boolean
): Promise<Array<{ abs: string; rel: string }>> {
  const out: Array<{ abs: string; rel: string }> = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        const rel = path.relative(rootDir, full).replace(/\\/g, "/");
        if (predicate(full, rel)) out.push({ abs: full, rel });
      }
    }
  };
  await walk(rootDir);
  return out;
}
