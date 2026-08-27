/**
 * skill 盘点：扫描根目录、解析 SKILL.md frontmatter、INDEX.md 注册检测、仓库比对。
 */
import { promises as fs } from "fs";
import * as path from "path";
import type { SkillManagerConfig } from "./config.js";

export interface SkillInfo {
  /** skill 目录绝对路径 */
  dir: string;
  /** 目录名 */
  name: string;
  /** 所属根目录 */
  root: string;
  hasSkillMd: boolean;
  /** SKILL.md frontmatter name（若有） */
  frontmatterName?: string;
  /** frontmatter description 首行 */
  description?: string;
  isSymlink: boolean;
  /** 是否已在 GitHub 仓库中（按目录名比对） */
  inRepo: boolean;
  /** 是否已注册 INDEX.md */
  inIndex: boolean;
}

export function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 4);
  if (end < 0) return {};
  const fm = content.slice(4, end);
  const nameMatch = fm.match(/^name:\s*["']?([^"'\n]+)["']?/m);
  const descMatch = fm.match(/^description:\s*["']?([^\n]+?)["']?$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
  };
}

async function readFrontmatter(skillMdPath: string): Promise<{ name?: string; description?: string }> {
  try {
    const content = await fs.readFile(skillMdPath, "utf8");
    return parseFrontmatter(content);
  } catch {
    return {};
  }
}

export async function scanRoot(root: string): Promise<SkillInfo[]> {
  const infos: SkillInfo[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return infos;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    const isDir = entry.isDirectory();
    if (!isDir && !entry.isSymbolicLink()) continue;
    // 解析真实目录（符号链接目标）
    let realPath: string | undefined;
    let isDirFinal = isDir;
    if (entry.isSymbolicLink()) {
      try {
        realPath = await fs.realpath(full);
        const st = await fs.stat(realPath);
        isDirFinal = st.isDirectory();
      } catch {
        continue; // broken symlink
      }
    }
    if (!isDirFinal) continue;

    const skillMd = path.join(full, "SKILL.md");
    let hasSkillMd = false;
    let fm: { name?: string; description?: string } = {};
    try {
      await fs.access(skillMd);
      hasSkillMd = true;
      fm = await readFrontmatter(skillMd);
    } catch {
      /* 无 SKILL.md，仍列入（可能是散落目录） */
    }
    infos.push({
      dir: full,
      name: entry.name,
      root,
      hasSkillMd,
      frontmatterName: fm.name,
      description: fm.description,
      isSymlink: entry.isSymbolicLink(),
      inRepo: false,
      inIndex: false,
    });
  }
  return infos;
}

async function readIndexNames(indexPath: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const content = await fs.readFile(indexPath, "utf8");
    const re = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) names.add(m[1]);
  } catch {
    /* INDEX 缺失则全部未注册 */
  }
  return names;
}

async function repoSkillNames(repoDir: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const entries = await fs.readdir(repoDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && (await fs.stat(path.join(repoDir, e.name, "SKILL.md")).catch(() => null))) {
        names.add(e.name);
      }
    }
  } catch {
    /* 仓库不存在则空 */
  }
  return names;
}

/** 汇总扫描全部根目录，并标注 inRepo / inIndex */
export async function scanAll(config: SkillManagerConfig): Promise<SkillInfo[]> {
  const [indexNames, repoNames] = await Promise.all([
    readIndexNames(config.indexPath),
    repoSkillNames(config.repoDir),
  ]);
  const all: SkillInfo[] = [];
  for (const root of config.roots) {
    const infos = await scanRoot(root);
    for (const info of infos) {
      info.inIndex = indexNames.has(info.name);
      info.inRepo = repoNames.has(info.name);
    }
    all.push(...infos);
  }
  return all;
}
