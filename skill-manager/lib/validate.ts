import { promises as fs } from "fs";
import * as path from "path";
import { parseFrontmatter } from "./skills.js";

export interface SkillValidationResult {
  ok: boolean;
  skillDir: string;
  files: number;
  errors: string[];
  warnings: string[];
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);

async function collectFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await collectFiles(full)));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function referencedLocalFiles(markdown: string): string[] {
  const result: string[] = [];
  const pattern = /\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const target = match[1].trim().split(/[?#]/, 1)[0];
    if (!target || target.startsWith("http://") || target.startsWith("https://")) continue;
    if (target.startsWith("<") && target.endsWith(">")) continue;
    if (target.startsWith("/") || target.includes(":\\")) continue;
    result.push(target);
  }
  return result;
}

/** Read-only validation for a Skill directory before publishing or installation. */
export async function validateSkill(
  inputDir: string,
  strict = false,
): Promise<SkillValidationResult> {
  const skillDir = path.resolve(inputDir);
  const errors: string[] = [];
  const warnings: string[] = [];
  let files = 0;

  let stat;
  try {
    stat = await fs.stat(skillDir);
  } catch {
    return { ok: false, skillDir, files: 0, errors: [`目录不存在: ${skillDir}`], warnings };
  }
  if (!stat.isDirectory()) {
    return { ok: false, skillDir, files: 0, errors: [`不是目录: ${skillDir}`], warnings };
  }

  const skillPath = path.join(skillDir, "SKILL.md");
  let markdown: string;
  try {
    markdown = await fs.readFile(skillPath, "utf8");
  } catch {
    return { ok: false, skillDir, files: 0, errors: [`缺少 SKILL.md: ${skillPath}`], warnings };
  }

  const frontmatter = parseFrontmatter(markdown);
  if (!frontmatter.name) errors.push("SKILL.md frontmatter 缺少 name");
  if (!frontmatter.description) errors.push("SKILL.md frontmatter 缺少 description");
  if (frontmatter.name && frontmatter.name !== path.basename(skillDir)) {
    const message = `frontmatter name (${frontmatter.name}) 与目录名 (${path.basename(skillDir)}) 不一致`;
    (strict ? errors : warnings).push(message);
  }

  const agentMetadata = path.join(skillDir, "agents", "openai.yaml");
  try {
    await fs.access(agentMetadata);
  } catch {
    warnings.push("缺少可选的 agents/openai.yaml；Codex UI 元数据不会自动生成");
  }

  const allFiles = await collectFiles(skillDir);
  files = allFiles.length;
  const seen = new Set<string>();
  for (const relative of referencedLocalFiles(markdown)) {
    if (seen.has(relative)) continue;
    seen.add(relative);
    const target = path.resolve(skillDir, relative);
    if (!target.startsWith(`${skillDir}${path.sep}`) && target !== skillDir) {
      warnings.push(`SKILL.md 引用了目录外路径: ${relative}`);
      continue;
    }
    try {
      await fs.access(target);
    } catch {
      warnings.push(`SKILL.md 引用的本地文件不存在: ${relative}`);
    }
  }

  return { ok: errors.length === 0, skillDir, files, errors, warnings };
}
