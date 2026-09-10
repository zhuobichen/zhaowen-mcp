/**
 * publish_project：把「帮别人做的任务」本地目录发布到 Other_Projects 仓库同名子目录并 push。
 * 流程：校验源 → 复制到仓库 <name>/ → 敏感检查 → git add/commit/push。
 * 只有显式调用本工具才会 push；dry_run 可只预览。
 */
import { promises as fs } from "fs";
import * as path from "path";
import type { OtherProjectsConfig } from "./config.js";
import {
  ensureRepo,
  gitAdd,
  gitCommit,
  gitPush,
  gitCurrentBranch,
  gitRevParseHead,
  gitStatus,
} from "./git.js";
import { scanPath } from "./sensitive.js";

const EXCLUDE = new Set([
  "node_modules", "dist", "__pycache__", ".venv", "venv", ".git",
  ".idea", ".vscode", "coverage", ".cache", ".pytest_cache",
]);

export interface PublishProjectOptions {
  /** 本地任务目录（绝对路径） */
  srcDir: string;
  /** 仓库内子目录名（缺省用源目录名） */
  name?: string;
  /** 提交说明（缺省自动生成） */
  message?: string;
  sensitiveAction?: "abort" | "mask";
  dryRun?: boolean;
}

export interface PublishProjectResult {
  ok: boolean;
  message: string;
  targetDir?: string;
  copiedFiles?: number;
  commitHash?: string;
  pushed?: boolean;
  warnings?: string[];
}

function slug(name: string): string {
  // 保留中文，仅去掉路径非法字符
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/^[.\s-]+|[.\s-]+$/g, "") || "project";
}

export async function publishProject(
  config: OtherProjectsConfig,
  opts: PublishProjectOptions
): Promise<PublishProjectResult> {
  const warnings: string[] = [];
  const src = path.resolve(opts.srcDir);

  // 1. 校验源目录
  try {
    const st = await fs.stat(src);
    if (!st.isDirectory()) throw new Error("不是目录");
    const entries = await fs.readdir(src);
    if (entries.length === 0) return { ok: false, message: `源目录为空：${src}` };
  } catch (e: any) {
    return { ok: false, message: `源目录不可用：${e.message}` };
  }

  const name = slug(opts.name || path.basename(src));
  const repoDir = config.repoDir;
  const target = path.join(repoDir, name);

  // 2. 确保仓库存在
  try {
    await ensureRepo(repoDir, config.repoUrl, config.gitBin);
  } catch (e: any) {
    return { ok: false, message: `仓库不可用：${e.message}。请确认 SSH key 可访问 ${config.repoUrl}` };
  }

  if (path.resolve(target) === src) {
    return { ok: false, message: "源目录与仓库目标目录相同，无需发布。" };
  }
  // 防止把仓库自身复制进去
  if (src.startsWith(repoDir + path.sep)) {
    return { ok: false, message: "源目录位于仓库内部，拒绝发布（会造成递归复制）。" };
  }

  // 3. 复制（更新语义：先删目标）
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
    return { ok: false, message: `复制失败：${e.message}。仓库副本可能已部分改动，未执行 commit/push。`, warnings };
  }

  // 4. 敏感检查（默认 abort）
  try {
    const scan = await scanPath(target);
    if (scan.hits.length) {
      const preview = scan.hits
        .slice(0, 8)
        .map((h) => `  - [${h.category}] ${h.ruleId} @ ${path.relative(target, h.file)}:${h.line}  ${h.sample}`)
        .join("\n");
      if (opts.sensitiveAction !== "mask") {
        return {
          ok: false,
          message: `敏感检查命中 ${scan.hits.length} 处，已中止发布（副本已复制但未 commit/push）：\n${preview}\n提示：确认无泄露后重试，或 sensitive_action="mask"。`,
          targetDir: target,
          copiedFiles: copied,
          warnings,
        };
      }
      warnings.push(`敏感检查命中 ${scan.hits.length} 处（mask 模式，仅提示，未自动改写）`);
    }
  } catch (e: any) {
    warnings.push(`敏感检查失败（已跳过）：${e.message}`);
  }

  // 5. 变更检查
  let statusBefore: string;
  try {
    statusBefore = await gitStatus(repoDir, config.gitBin);
  } catch (e: any) {
    return { ok: false, message: `git status 失败：${e.message}`, warnings };
  }
  if (!statusBefore.trim()) {
    return { ok: false, message: `无任何变更（仓库内容与 ${name} 一致），未提交未推送。`, targetDir: target, copiedFiles: copied, warnings };
  }
  if (opts.dryRun) {
    return {
      ok: true,
      message: `[dry-run] 已复制到 ${target}，检测到变更：\n${statusBefore.trim()}\n未提交未推送。`,
      targetDir: target,
      copiedFiles: copied,
      pushed: false,
      warnings,
    };
  }

  // 6. git add/commit/push
  const branch = await gitCurrentBranch(repoDir, config.gitBin).catch(() => "main");
  const commitMessage =
    opts.message ||
    [
      `feat: 添加 ${name}`,
      "",
      "(帮别人做的任务，由 other-projects MCP 发布)",
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
      targetDir: target,
      copiedFiles: copied,
      warnings,
    };
  }
  const commitHash = await gitRevParseHead(repoDir, config.gitBin).catch(() => "");

  try {
    await gitPush(repoDir, config.gitBin, branch);
  } catch (e: any) {
    return {
      ok: false,
      message: `已本地提交 ${commitHash.slice(0, 7)} 但 push 失败：${e.message}\n可手动执行：git -C "${repoDir}" push origin ${branch}`,
      targetDir: target,
      copiedFiles: copied,
      commitHash,
      pushed: false,
      warnings,
    };
  }

  return {
    ok: true,
    message: `✅ 已发布 ${name} 到 ${config.repoUrl}（commit ${commitHash.slice(0, 7)}，分支 ${branch}）`,
    targetDir: target,
    copiedFiles: copied,
    commitHash,
    pushed: true,
    warnings,
  };
}
