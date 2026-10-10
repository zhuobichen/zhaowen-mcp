/**
 * search_docs / read_doc：知识库检索与读取。
 *
 * 自建遍历，不依赖 Obsidian CLI。用途有二：
 *   1. 写入前判重 —— 同一概念已存在则改走「合并既有卡」而非新建；
 *   2. 合并前读全文 —— 保证读的是即将写入的那个工作副本。
 */
import { promises as fs } from "fs";
import * as path from "path";
import type { MemoryPushConfig } from "./config.js";
import {
  MAX_SCAN_FILE_BYTES,
  normalizeRelPath,
  parseFrontmatter,
  resolveInside,
  stripFrontmatter,
  validateEvergreenCard,
  walkFiles,
} from "./vault.js";

export interface SearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
  kind: "name" | "content";
}

export interface SearchCandidate {
  path: string;
  title: string;
  reason: string;
  topics: string[];
  score: number;
}

export interface SearchResult {
  scope: string;
  query: string;
  hits: SearchHit[];
  candidates: SearchCandidate[];
  filesScanned: number;
  truncated: boolean;
}

/** 归一化用于同名比较：去空格/下划线/连字符、全角转半角、转小写 */
export function normalizeName(s: string): string {
  return s
    .replace(/\.md$/i, "")
    .replace(/[\s_\-·]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 从 query 提取关键词（空格分隔、去重） */
function terms(query: string): string[] {
  return Array.from(
    new Set(
      String(query ?? "")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

export interface SearchOptions {
  query: string;
  /** 仓库内相对目录，缺省为 wikiRoot（OUTPUT） */
  scope?: string;
  mode?: "name" | "content" | "both";
  limit?: number;
  contextLines?: number;
}

export async function searchDocs(
  config: MemoryPushConfig,
  opts: SearchOptions
): Promise<SearchResult> {
  const scopeCheck = normalizeRelPath(opts.scope || config.wikiRoot);
  const scopeRel = scopeCheck.ok ? scopeCheck.rel : config.wikiRoot;
  const scopeAbs = resolveInside(config.repoDir, scopeRel);
  if (!scopeAbs) throw new Error(`搜索范围越界：${scopeRel}`);

  const mode = opts.mode ?? "both";
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  const ctx = Math.max(0, Math.min(opts.contextLines ?? 0, 5));
  const q = String(opts.query ?? "");
  const ts = terms(q);
  const qNorm = normalizeName(q);

  const files = await walkFiles(scopeAbs, (_abs, rel) => rel.toLowerCase().endsWith(".md"));

  const hits: SearchHit[] = [];
  const candidates: SearchCandidate[] = [];
  let scanned = 0;

  for (const f of files) {
    let size = 0;
    try {
      size = (await fs.stat(f.abs)).size;
    } catch {
      continue;
    }
    if (size > MAX_SCAN_FILE_BYTES) continue;

    let content: string;
    try {
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    scanned++;

    const repoRel = path.relative(config.repoDir, f.abs).replace(/\\/g, "/");
    const stem = path.posix.basename(repoRel).replace(/\.md$/i, "");
    const body = stripFrontmatter(content);
    const h1 = /^#\s+(.+)$/m.exec(body);
    const title = h1 ? h1[1].trim() : stem;

    const fm = parseFrontmatter(content);
    const topicsRaw = fm?.data["topics"];
    const topics = (Array.isArray(topicsRaw) ? topicsRaw : topicsRaw ? [topicsRaw] : [])
      .map((t) => String(t).replace(/^\[\[|\]\]$/g, ""));

    // 文件名精确命中：视为同一概念，直接进候选且不再做内容匹配
    if (mode !== "content" && qNorm && normalizeName(stem) === qNorm) {
      hits.push({ path: repoRel, title, line: 0, snippet: "（文件名完全匹配）", kind: "name" });
      candidates.push({
        path: repoRel,
        title,
        reason: "文件名与查询完全一致（同一概念）",
        topics,
        score: 100,
      });
      continue;
    }

    const lines = content.split(/\r?\n/);
    let contentHit = false;
    let overlap = 0;

    if (mode !== "name" && ts.length) {
      for (let i = 0; i < lines.length; i++) {
        const hay = lines[i].toLowerCase();
        const matched = ts.filter((t) => hay.includes(t.toLowerCase()));
        if (!matched.length) continue;
        overlap += matched.length;
        if (!contentHit) {
          const from = Math.max(0, i - ctx);
          const to = Math.min(lines.length, i + ctx + 1);
          hits.push({
            path: repoRel,
            title,
            line: i + 1,
            snippet: lines.slice(from, to).join(" ⏎ ").trim().slice(0, 200),
            kind: "content",
          });
          contentHit = true;
        }
      }
    }

    // 去重候选：同 topics，或标题相近且正文关键词大量重合
    const topicMatch = topics.some((t) => ts.some((x) => normalizeName(x) === normalizeName(t)));
    const nameSimilar =
      !!qNorm && (normalizeName(stem).includes(qNorm) || qNorm.includes(normalizeName(stem)));
    const heavyOverlap = overlap >= Math.max(2, Math.ceil(ts.length * 0.6));
    if (topicMatch || (heavyOverlap && nameSimilar)) {
      candidates.push({
        path: repoRel,
        title,
        reason: topicMatch ? "topics 主题相同" : "标题相近且正文关键词高度重合",
        topics,
        score: (topicMatch ? 60 : 0) + overlap * 5 + (nameSimilar ? 20 : 0),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  hits.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "name" ? -1 : 1));

  return {
    scope: scopeRel,
    query: q,
    hits: hits.slice(0, limit),
    candidates: candidates.slice(0, 10),
    filesScanned: scanned,
    truncated: hits.length > limit,
  };
}

export interface ReadDocResult {
  ok: boolean;
  path: string;
  content?: string;
  frontmatter?: Record<string, string | string[]>;
  validation?: { ok: boolean; errors: string[]; warnings: string[] };
  message: string;
}

export async function readDoc(config: MemoryPushConfig, relPath: string): Promise<ReadDocResult> {
  const check = normalizeRelPath(relPath);
  if (!check.ok) return { ok: false, path: String(relPath), message: `路径非法：${check.error}` };

  const abs = resolveInside(config.repoDir, check.rel);
  if (!abs) return { ok: false, path: check.rel, message: "路径越界，拒绝读取" };

  let content: string;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch (e: any) {
    return { ok: false, path: check.rel, message: `读取失败：${e.message}` };
  }

  const fm = parseFrontmatter(content);
  const validation = /(^|\/)Evergreen\//.test(check.rel)
    ? validateEvergreenCard(check.rel, content)
    : undefined;

  return {
    ok: true,
    path: check.rel,
    content,
    frontmatter: fm?.data,
    validation,
    message: `已读取 ${check.rel}（${content.length} 字符）`,
  };
}
