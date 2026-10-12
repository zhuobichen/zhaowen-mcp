/**
 * 仓库 README.md 表格 upsert。
 *
 * 行匹配：按「目录」单元格在**全文件**范围命中 → 原地整行替换；未命中 → 插入指定分区。
 * 分区路由（仅在传入 opts 时启用；sync_self 等不传 opts 的调用保持「首个表头」旧行为）：
 *   1) opts.section 为分区标题关键词（子串匹配、忽略大小写）
 *   2) opts.section = "prefixed"，或未传 section 而 prefixed=true → 标题含「前缀」的分区
 *   3) opts.section = "plain"，或未传 section 而 prefixed=false → 标题含「无前缀 / 其他自制」的分区
 * 单元格净化：折叠换行与连续空白、转义 `|`。此前多行 description 会把一行撑成多行、截断处
 * 断在句中，是 README 表格写坏的根因。
 */
import { promises as fs } from "fs";

const HEADER_RE = /^\|\s*Skill\s*\|\s*目录\s*\|\s*用途\s*\|$/;
const SEPARATOR_RE = /^\s*\|[\s\-:|]+\|\s*$/;
const HEADING_RE = /^##\s+(.+?)\s*$/;

export interface UpsertResult {
  changed: boolean;
  content: string;
}

export interface UpsertOptions {
  /** 分区标题关键词；或用 "prefixed" / "plain" 走内置分区语义 */
  section?: string;
  /** 技能名是否带来源前缀（ylx_/clz_）；未传 section 时据此选分区 */
  prefixed?: boolean;
}

/** 折叠成单行单元格：去换行、压缩连续空白、转义竖线 */
export function sanitizeCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * 用途列文本：优先取首个中文句末标点（。！？）之前的内容，否则整体文本；
 * 超过 max 字符则截断补省略号。返回值保证是单行。
 */
export function summarize(description: string, max = 120): string {
  const flat = sanitizeCell(description);
  if (!flat) return "";
  const end = flat.search(/[。！？]/);
  let text = end >= 0 ? flat.slice(0, end + 1) : flat;
  if (text.length > max) text = `${text.slice(0, max).trimEnd()}…`;
  return text;
}

/** 收集 `## 标题` 行（只认二级标题，避免把 ### 小节当分区） */
function headingIndexes(lines: string[]): { title: string; index: number }[] {
  const headings: { title: string; index: number }[] = [];
  lines.forEach((line, index) => {
    const match = HEADING_RE.exec(line.trim());
    if (match) headings.push({ title: match[1], index });
  });
  return headings;
}

/** 在 [start, end) 区间内找表头行下标，找不到返回 -1 */
function findHeaderInRange(lines: string[], start: number, end: number): number {
  for (let i = Math.max(0, start); i < Math.min(end, lines.length); i++) {
    if (HEADER_RE.test(lines[i].trim())) return i;
  }
  return -1;
}

/** 解析目标分区在 lines 中的区间（不含标题行本身） */
function sectionRange(lines: string[], opts: UpsertOptions): { start: number; end: number } {
  const whole = { start: 0, end: lines.length };
  const { section, prefixed } = opts;
  if (section === undefined && prefixed === undefined) return whole; // 旧行为

  const headings = headingIndexes(lines);
  if (headings.length === 0) return whole;
  const rangeOf = (h: number) => ({
    start: headings[h].index + 1,
    end: h + 1 < headings.length ? headings[h + 1].index : lines.length,
  });
  const pick = (predicate: (title: string) => boolean) => {
    for (let h = 0; h < headings.length; h++) {
      if (predicate(headings[h].title)) return rangeOf(h);
    }
    return null;
  };

  // 1) 显式关键词
  if (section && section !== "prefixed" && section !== "plain") {
    const key = section.toLowerCase();
    const hit = pick((title) => title.toLowerCase().includes(key));
    if (hit) return hit;
  }
  // 2) 前缀语义
  const wantPrefixed = section === "prefixed" || (section === undefined && prefixed === true);
  const hit = wantPrefixed
    ? pick((title) => /前缀/.test(title))
    : pick((title) => /无前缀|其他自制/.test(title));
  return hit ?? whole;
}

export function upsertReadmeRow(
  readme: string,
  targetDir: string,
  title: string,
  description: string,
  opts: UpsertOptions = {}
): UpsertResult {
  const cell = `[\`${targetDir}/\`](${targetDir}/)`;
  const lines = readme.split(/\r?\n/);
  const row = `| ${sanitizeCell(title)} | ${cell} | ${sanitizeCell(description)} |`;

  // 1. 命中：整行替换（全文件范围，保证不会重复插一行）
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(cell)) {
      if (lines[i].trim() === row) return { changed: false, content: readme };
      lines[i] = row;
      return { changed: true, content: lines.join("\n") };
    }
  }

  // 2. 未命中：在目标分区的表头 / 分隔行之后插入
  const range = sectionRange(lines, opts);
  const headerAt = findHeaderInRange(lines, range.start, range.end);
  if (headerAt >= 0) {
    let insertAt = headerAt + 1;
    while (insertAt < lines.length && SEPARATOR_RE.test(lines[insertAt])) insertAt++;
    lines.splice(insertAt, 0, row);
    return { changed: true, content: lines.join("\n") };
  }

  // 3. 无表头：追加到文件末尾
  if (readme.trim()) lines.push("", row);
  else lines.push(row);
  return { changed: true, content: lines.join("\n") };
}

export async function upsertReadmeRowFile(
  readmePath: string,
  targetDir: string,
  title: string,
  description: string,
  opts: UpsertOptions = {}
): Promise<{ changed: boolean }> {
  let content: string;
  try {
    content = await fs.readFile(readmePath, "utf8");
  } catch {
    content = "# zhaowen-skill\n\n| Skill | 目录 | 用途 |\n|---|---|---|\n";
  }
  const res = upsertReadmeRow(content, targetDir, title, description, opts);
  if (res.changed) await fs.writeFile(readmePath, res.content, "utf8");
  return { changed: res.changed };
}
