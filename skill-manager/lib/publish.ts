/**
 * publish_skill 主流程编排：校验 → 命名规范化 → 敏感检查 → 复制 → 脱敏 → README → git。
 * git push 只发生在本模块（被 index.ts 的 publish_skill 调用）。
 */
import { promises as fs } from "fs";
import * as path from "path";
import type { SkillManagerConfig } from "./config.js";
import { resolveTargetName } from "./naming.js";
import { scanPath, maskDir, isTextFile } from "./sensitive.js";
import { upsertReadmeRowFile } from "./readme.js";
import {
  ensureRepo,
  gitAdd,
  gitCommit,
  gitPush,
  gitCurrentBranch,
  gitRevParseHead,
  gitStatus,
} from "./git.js";
import { parseFrontmatter } from "./skills.js";

export interface PublishArgs {
  skill_dir: string;
  new_name?: string;
  check_sensitive?: boolean;
  sensitive_action?: "abort" | "mask";
}

export interface PublishResult {
  ok: boolean;
  message: string;
  skillDir?: string;
  targetName?: string;
  targetRepoDir?: string;
  sensitive?: { checked: boolean; hits: number; action: string };
  commitHash?: string;
  commitMessage?: string;
  pushed?: boolean;
  warnings?: string[];
}

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__",
  ".venv", "venv", "output", ".publish-tmp",
]);

function formatHits(
  hits: { ruleId: string; category: string; label: string; file: string; line: number; sample: string }[]
): string {
  const shown = hits.slice(0, 20);
  const lines = [
    `检测到 ${hits.length} 处敏感信息，已中止发布：`,
    ...shown.map(
      (h) =>
        `- [${h.category}] ${h.label}（规则 ${h.ruleId}） @ ${h.file}:${h.line}\n  ${h.sample}`
    ),
  ];
  if (hits.length > shown.length) lines.push(`  ... 其余 ${hits.length - shown.length} 处`);
  lines.push(
    "可处理：修改本地文件后重试；或 publish_skill 传 sensitive_action='mask' 自动脱敏上传版（本地不动）。"
  );
  return lines.join("\n");
}

async function copySkill(src: string, dst: string): Promise<void> {
  // 更新语义：目标已存在则先删除（Node fs API，非 shell rm）
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.cp(src, dst, {
    recursive: true,
    filter: (s) => {
      if (s === src) return true;
      const rel = path.relative(src, s);
      const first = rel.split(path.sep)[0];
      if (EXCLUDE_DIRS.has(first)) return false;
      return true;
    },
  });
}

/** 改写副本 SKILL.md frontmatter 的 name 为目标名（保证目录名与 name 一致） */
async function rewriteName(skillDir: string, targetName: string): Promise<void> {
  const md = path.join(skillDir, "SKILL.md");
  let content: string;
  try {
    content = await fs.readFile(md, "utf8");
  } catch {
    return;
  }
  const updated = content.replace(/^name:\s*["']?[^"'\n]+["']?/m, `name: ${targetName}`);
  if (updated !== content) await fs.writeFile(md, updated, "utf8");
}

function buildCommitMessage(
  targetName: string,
  skillDir: string,
  sensitiveNote: string,
  changeSummary: string,
  isUpdate: boolean
): string {
  return [
    `skill(${isUpdate ? "更新" : "发布"}): ${targetName}`,
    "",
    `- 来源: ${skillDir}`,
    `- 敏感检查: ${sensitiveNote}`,
    `- 变更: ${changeSummary}`,
    "",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
  ].join("\n");
}

export async function publishSkill(
  config: SkillManagerConfig,
  args: PublishArgs
): Promise<PublishResult> {
  const warnings: string[] = [];

  // 1. 校验 skill_dir + SKILL.md
  const skillDir = path.resolve(args.skill_dir);
  const skillMd = path.join(skillDir, "SKILL.md");
  let fm: { name?: string; description?: string };
  try {
    fm = parseFrontmatter(await fs.readFile(skillMd, "utf8"));
  } catch {
    return { ok: false, message: `skill 目录不存在或缺少 SKILL.md: ${skillDir}` };
  }
  const rawName = path.basename(skillDir);

  // 2. 命名规范化
  const nm = resolveTargetName(
    rawName,
    args.new_name,
    config.namespace,
    config.namePrefixes
  );
  if (!nm.ok) return { ok: false, message: nm.reason! };
  const targetName = nm.name;

  // 3. 敏感检查
  const checkSensitive = args.check_sensitive !== false;
  const action = args.sensitive_action === "mask" ? "mask" : "abort";
  let hits = 0;
  if (checkSensitive) {
    const scan = await scanPath(skillDir);
    hits = scan.hits.length;
    if (hits > 0 && action === "abort") {
      return {
        ok: false,
        message: formatHits(scan.hits),
        skillDir,
        targetName,
        sensitive: { checked: true, hits, action },
      };
    }
  }

  // 4. 确保仓库 + 复制
  try {
    await ensureRepo(config);
  } catch (e: any) {
    return {
      ok: false,
      message: `仓库工作副本不可用：${e.message}。请确认 SSH key 已配置且可访问 ${config.repoUrl}`,
    };
  }
  const targetRepoDir = path.join(config.repoDir, targetName);
  const isUpdate = await fs.access(targetRepoDir).then(() => true).catch(() => false);
  try {
    await copySkill(skillDir, targetRepoDir);
  } catch (e: any) {
    return {
      ok: false,
      message: `复制失败：${e.message}。仓库副本可能已部分改动，可用 git status 查看，未执行 commit/push。`,
      skillDir,
      targetName,
      warnings,
    };
  }

  // 5. 脱敏（仅对仓库副本）
  if (checkSensitive && hits > 0 && action === "mask") {
    try {
      await maskDir(targetRepoDir);
    } catch (e: any) {
      return { ok: false, message: `脱敏失败：${e.message}` };
    }
  }

  // 6. 改写副本 name + 更新 README
  await rewriteName(targetRepoDir, targetName);
  const title = (fm.description ? fm.description.split(/[。.]/)[0] : targetName).slice(0, 20) || targetName;
  const desc = (fm.description || "可复用 skill").slice(0, 60);
  try {
    await upsertReadmeRowFile(path.join(config.repoDir, "README.md"), targetName, title, desc);
  } catch (e: any) {
    warnings.push(`README 更新失败（已跳过）：${e.message}`);
  }

  // 7. 变更检查 + git
  let statusBefore: string;
  try {
    statusBefore = await gitStatus(config.repoDir, config.gitBin);
  } catch (e: any) {
    return { ok: false, message: `git status 失败：${e.message}`, warnings };
  }
  if (!statusBefore.trim()) {
    return {
      ok: false,
      message: `无任何变更（${targetName} 与仓库现状一致），未提交未推送。`,
      skillDir,
      targetName,
      targetRepoDir,
      sensitive: checkSensitive ? { checked: true, hits, action } : { checked: false, hits: 0, action },
      warnings,
    };
  }

  const branch = await gitCurrentBranch(config.repoDir, config.gitBin).catch(() => "main");
  const changeSummary = `status 变更 ${statusBefore.trim().split(/\r?\n/).length} 项`;
  const sensitiveNote = !checkSensitive
    ? "跳过（check_sensitive=false）"
    : hits === 0
    ? "通过"
    : `已脱敏 ${hits} 项`;
  const commitMessage = buildCommitMessage(targetName, skillDir, sensitiveNote, changeSummary, isUpdate);

  try {
    await gitAdd(config.repoDir, config.gitBin);
    await gitCommit(config.repoDir, config.gitBin, commitMessage);
  } catch (e: any) {
    return {
      ok: false,
      message: `git add/commit 失败：${e.message}。仓库副本已改动但未提交，可手动处理。`,
      skillDir,
      targetName,
      targetRepoDir,
      warnings,
    };
  }
  const commitHash = await gitRevParseHead(config.repoDir, config.gitBin).catch(() => "");

  // 8. push（唯一 push 入口）
  try {
    await gitPush(config.repoDir, config.gitBin, branch);
  } catch (e: any) {
    return {
      ok: false,
      message: `已本地提交 ${commitHash.slice(0, 7)} 但 push 失败：${e.message}\n可手动执行：git -C "${config.repoDir}" push origin ${branch}（不会自动回滚）`,
      skillDir,
      targetName,
      targetRepoDir,
      commitHash,
      commitMessage,
      pushed: false,
      warnings,
    };
  }

  return {
    ok: true,
    message: `✅ 已发布 ${targetName}（commit ${commitHash.slice(0, 7)}）到 ${config.repoUrl}（分支 ${branch}）`,
    skillDir,
    targetName,
    targetRepoDir,
    sensitive: checkSensitive ? { checked: true, hits, action } : { checked: false, hits: 0, action },
    commitHash,
    commitMessage,
    pushed: true,
    warnings,
  };
}
