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

export interface SyncSelfOptions {
  /** true 时只比对并报告会新增/删除哪些文件，不复制、不提交 */
  dryRun?: boolean;
}

/** 递归列出相对文件路径（POSIX 风格），跳过 EXCLUDE —— 用于同步前的镜像比对 */
async function listRelFiles(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (EXCLUDE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.add(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  await walk(root);
  return out;
}

export async function syncSelf(
  config: SkillManagerConfig,
  opts: SyncSelfOptions = {}
): Promise<SyncSelfResult> {
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

  // 2. 镜像比对：找出「只在仓库存在」的文件 —— 它们会被下面的 rm 删掉。
  //    加这一步是为了不让同步静默丢文件（曾因此误删仓库里的 validate*.ts）。
  let onlyInTarget: string[] = [];
  let onlyInSource: string[] = [];
  let onBothSides: string[] = [];
  try {
    const [srcFiles, dstFiles] = await Promise.all([listRelFiles(src), listRelFiles(target)]);
    onlyInTarget = [...dstFiles].filter((f) => !srcFiles.has(f)).sort();
    onlyInSource = [...srcFiles].filter((f) => !dstFiles.has(f)).sort();
    onBothSides = [...srcFiles].filter((f) => dstFiles.has(f)).sort();
  } catch {
    /* 目标不存在 → 首次同步，无历史文件可丢 */
  }

  if (onlyInTarget.length) {
    warnings.push(
      `⚠️ 本次同步将【删除】仓库中 ${onlyInTarget.length} 个本地不存在的文件：\n` +
        onlyInTarget.map((f) => `  - skill-manager/${f}`).join("\n") +
        `\n（sync_self 是镜像同步、以本地为准。若要保留它们，请先补回本地 ${src}，或先用 dry_run 查看清单。）`
    );
  }

  if (opts.dryRun) {
    const modified: string[] = [];
    for (const f of onBothSides) {
      try {
        const [a, b] = await Promise.all([
          fs.readFile(path.join(src, f)),
          fs.readFile(path.join(target, f)),
        ]);
        if (!a.equals(b)) modified.push(f);
      } catch {
        /* 读不到就略过 */
      }
    }
    return {
      ok: true,
      message:
        `[dry-run] 未复制、未提交。新增 ${onlyInSource.length} 个；修改 ${modified.length} 个；删除 ${onlyInTarget.length} 个。` +
        (onlyInTarget.length ? "（删除清单见 warnings）" : ""),
      warnings,
    };
  }

  // 3. 复制自身源码 → 仓库副本（镜像语义：先删旧目标）
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

  // 4. 主 README 表格行检查（skill-manager 行存在则跳过，缺失则追加）
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

  // 5. 变更检查 + git
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

  // 6. push（显式调用本工具才执行）
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
