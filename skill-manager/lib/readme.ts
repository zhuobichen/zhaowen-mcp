/**
 * 仓库 README.md 表格 upsert：匹配 `| Skill | 目录 | 用途 |` 表头，
 * 按目录单元格命中更新行，未命中在表头后追加新行。
 */
import { promises as fs } from "fs";

const HEADER_RE = /^\|\s*Skill\s*\|\s*目录\s*\|\s*用途\s*\|$/;

export interface UpsertResult {
  changed: boolean;
  content: string;
}

export function upsertReadmeRow(
  readme: string,
  targetDir: string,
  title: string,
  description: string
): UpsertResult {
  const cell = `[\`${targetDir}/\`](${targetDir}/)`;
  const lines = readme.split(/\r?\n/);
  const row = `| ${title} | ${cell} | ${description} |`;

  // 1. 命中：整行替换（保持 3 列）
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(cell)) {
      if (lines[i].trim() === row) return { changed: false, content: readme };
      lines[i] = row;
      return { changed: true, content: lines.join("\n") };
    }
  }

  // 2. 未命中：在表头行后追加（紧跟分隔行 `|---` 之后）
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_RE.test(lines[i].trim())) {
      // 跳过紧跟的分隔行
      let insertAt = i + 1;
      while (insertAt < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[insertAt])) {
        insertAt++;
      }
      lines.splice(insertAt, 0, row);
      return { changed: true, content: lines.join("\n") };
    }
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
  description: string
): Promise<{ changed: boolean }> {
  let content: string;
  try {
    content = await fs.readFile(readmePath, "utf8");
  } catch {
    content = "# zhaowen-skill\n\n| Skill | 目录 | 用途 |\n|---|---|---|\n";
  }
  const res = upsertReadmeRow(content, targetDir, title, description);
  if (res.changed) await fs.writeFile(readmePath, res.content, "utf8");
  return { changed: res.changed };
}
