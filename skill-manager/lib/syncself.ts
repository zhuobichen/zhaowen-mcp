/**
 * sync_self：把 skill-manager MCP 自身源码同步到 zhaowen-mcp 集合仓库并 push。
 * 只被 index.ts 的 sync_self 工具调用（显式调用才 push）。
 */
import { promises as fs } from "fs";
import * as path from "path";
import type { SkillManagerConfig } from "./config.js";
import {
  ensureRepo,
  gitAdd,
  gitCommit,
  gitPush,
  gitCurrentBranch,
  gitRevParseHead,
  gitStatus,
} from "./git.js";

const EXCLUDE = new Set(["node_modules", "dist", "__pycache__", ".venv", "venv", ".git"]);

export interface SyncSelfResult {
  ok: boolean;
  message: string;
  copiedFiles?: number;
  commitHash?: string;
  pushed?: boolean;
  warnings?: string[];
}

export async function syncSelf(config: SkillManagerConfig): Promise<SyncSelfResult> {
  const warnings: string[] = [];
  const src = config.selfSrcDir;
  const repoDir = config.mcpRepoDir;
  const target = path.join(repoDir, "skill-manager");

  // 1. 确保 MCP 集合仓库工作副本存在
  try {
    await ensureRepo({ ...config, repoDir, repoUrl: config.mcpRepoUrl });
  } catch (e: any) {
    return {
      ok: false,
      message: `仓库不可用：${e.message}。请确认 SSH key 可访问 ${config.mcpRepoUrl}`,
    };
  }

  // 2. 复制自身源码 → 仓库副本（更新语义：先删旧目标）
  let copied = 0;
  try {
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(src, target, {
      recursive: true,
      filter: (s) => {
        if (s === src) return true;
        const rel = path.relative(src, s);
        const first = rel.split(path.sep)[0];
        if (EXCLUDE.has(first)) return false;
        copied++;
        return true;
      },
    });
  } catch (e: any) {
    return {
      ok: false,
      message: `复制失败：${e.message}。仓库副本可能已部分改动，未执行 commit/push。`,
      warnings,
    };
  }

  // 3. 主 README 表格行检查（skill-manager 行存在则跳过，缺失则追加）
  try {
    const readmePath = path.join(repoDir, "README.md");
    const readme = await fs.readFile(readmePath, "utf8");
    if (!readme.includes("skill-manager/")) {
      const { upsertReadmeRow } = await import("./readme.js");
      const res = upsertReadmeRow(readme, "skill-manager", "skill 盘点 + 一键发布 GitHub", "`list_skills` 盘点 · `check_sensitive` 敏感检测 · `publish_skill` 发布 · `sync_self` 同步自身 · `get_config`");
      if (res.changed) await fs.writeFile(readmePath, res.content, "utf8");
    }
  } catch (e: any) {
    warnings.push(`README 检查失败（已跳过）：${e.message}`);
  }

  // 4. 变更检查 + git
  let statusBefore: string;
  try {
    statusBefore = await gitStatus(repoDir, config.gitBin);
  } catch (e: any) {
    return { ok: false, message: `git status 失败：${e.message}`, warnings };
  }
  if (!statusBefore.trim()) {
    return { ok: false, message: "无任何变更（源码与仓库一致），未提交未推送。", copiedFiles: copied, warnings };
  }

  const branch = await gitCurrentBranch(repoDir, config.gitBin).catch(() => "main");
  const commitMessage = [
    "chore: sync skill-manager MCP",
    "",
    `- 同步自: ${src}`,
    `- 变更: status ${statusBefore.trim().split(/\r?\n/).length} 项`,
    "",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
  ].join("\n");

  try {
    await gitAdd(repoDir, config.gitBin);
    await gitCommit(repoDir, config.gitBin, commitMessage);
  } catch (e: any) {
    return {
      ok: false,
      message: `git add/commit 失败：${e.message}。仓库副本已改动但未提交。`,
      copiedFiles: copied,
      warnings,
    };
  }
  const commitHash = await gitRevParseHead(repoDir, config.gitBin).catch(() => "");

  // 5. push（显式调用本工具才执行）
  try {
    await gitPush(repoDir, config.gitBin, branch);
  } catch (e: any) {
    return {
      ok: false,
      message: `已本地提交 ${commitHash.slice(0, 7)} 但 push 失败：${e.message}\n可手动执行：git -C "${repoDir}" push origin ${branch}`,
      copiedFiles: copied,
      commitHash,
      pushed: false,
      warnings,
    };
  }

  return {
    ok: true,
    message: `✅ 已同步 skill-manager 源码并推送（commit ${commitHash.slice(0, 7)}）到 ${config.mcpRepoUrl}（分支 ${branch}）`,
    copiedFiles: copied,
    commitHash,
    pushed: true,
    warnings,
  };
}
