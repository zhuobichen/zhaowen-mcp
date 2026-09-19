/**
 * publish_doc：把本地零散文档资料推送到 MEMORY 知识库仓库。
 * 流程：校验源 → 复制到仓库 <subdir>/（合并语义，不删旧文件）→ 敏感检查 → git add/commit/push。
 * 只有显式调用本工具才会 push；dry_run 可只预览。
 */
import { promises as fs } from "fs";
import * as path from "path";
import type { MemoryPushConfig } from "./config.js";
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

/** 复制时排除的目录/文件（文档推送一般不需要这些） */
const EXCLUDE = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv",
  ".idea", ".vscode", "dist", ".cache", ".pytest_cache",
  ".DS_Store", "Thumbs.db",
]);

export interface PublishDocOptions {
  /** 本地文件或目录（绝对路径） */
  src: string;
  /** MEMORY 仓库内的目标子目录（如 "AI参考资料"）；缺省 "" 表示仓库根目录 */
  subdir?: string;
  /** 提交说明（缺省自动生成） */
  message?: string;
  sensitiveAction?: "abort" | "mask";
  dryRun?: boolean;
}

export interface PublishDocResult {
  ok: boolean;
  message: string;
  targetPath?: string;
  copiedFiles?: number;
  commitHash?: string;
  pushed?: boolean;
  warnings?: string[];
}

/** 收集要复制的文件数（用于报告） */
async function countFiles(p: string): Promise<number> {
  const st = await fs.stat(p);
  if (st.isFile()) return 1;
  let n = 0;
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (EXCLUDE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else n++;
    }
  };
  await walk(p);
  return n;
}

export async function publishDoc(
  config: MemoryPushConfig,
  opts: PublishDocOptions
): Promise<PublishDocResult> {
  const warnings: string[] = [];
  const src = path.resolve(opts.src);

  // 1. 校验源
  let isDir = false;
  try {
    const st = await fs.stat(src);
    isDir = st.isDirectory();
  } catch (e: any) {
    return { ok: false, message: `源不可用：${e.message}` };
  }

  const repoDir = config.repoDir;
  const subdir = (opts.subdir || "").replace(/^[/\\]+|[/\\]+$/g, "");

  // 2. 目标路径：文件 → <repo>/<subdir>/<文件名>；目录 → <repo>/<subdir>/<目录名>/
  const target = path.join(repoDir, subdir, path.basename(src));

  // 防呆：不要把仓库自身或仓库内的东西推进去
  if (path.resolve(target) === src || src.startsWith(repoDir + path.sep) || src === repoDir) {
    return { ok: false, message: "源位于仓库内部或与目标相同，拒绝发布（会造成递归复制）。" };
  }

  // 3. 确保仓库存在
  try {
    await ensureRepo(repoDir, config.repoUrl, config.gitBin);
  } catch (e: any) {
    return { ok: false, message: `仓库不可用：${e.message}。请确认 SSH key 可访问 ${config.repoUrl}` };
  }

  // 4. 复制（合并语义：同名覆盖，不删除目标目录中已有文件）
  let copied = 0;
  try {
    copied = await countFiles(src);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (isDir) {
      await fs.cp(src, target, {
        recursive: true,
        filter: (s) => {
          if (s === src) return true;
          const rel = path.relative(src, s);
          const first = rel.split(path.sep)[0];
          return !EXCLUDE.has(first);
        },
      });
    } else {
      await fs.copyFile(src, target);
    }
  } catch (e: any) {
    return { ok: false, message: `复制失败：${e.message}。仓库副本可能已部分改动，未执行 commit/push。`, warnings };
  }

  // 5. 敏感检查（默认 abort）—— 只扫刚推送的内容（target 本身），不扫目标目录中的既有文件
  try {
    const scan = await scanPath(target);
    if (scan.hits.length) {
      const preview = scan.hits
        .slice(0, 8)
        .map((h) => `  - [${h.category}] ${h.ruleId} @ ${path.relative(repoDir, h.file)}:${h.line}  ${h.sample}`)
        .join("\n");
      if (opts.sensitiveAction !== "mask") {
        return {
          ok: false,
          message: `敏感检查命中 ${scan.hits.length} 处，已中止（副本已复制但未 commit/push）：\n${preview}\n提示：确认无泄露后重试，或 sensitive_action="mask"。`,
          targetPath: target,
          copiedFiles: copied,
          warnings,
        };
      }
      warnings.push(`敏感检查命中 ${scan.hits.length} 处（mask 模式，仅提示，未自动改写）`);
    }
  } catch (e: any) {
    warnings.push(`敏感检查失败（已跳过）：${e.message}`);
  }

  // 6. 变更检查
  let statusBefore: string;
  try {
    statusBefore = await gitStatus(repoDir, config.gitBin);
  } catch (e: any) {
    return { ok: false, message: `git status 失败：${e.message}`, warnings };
  }
  if (!statusBefore.trim()) {
    return {
      ok: false,
      message: `无任何变更（仓库内容已与源一致），未提交未推送。`,
      targetPath: target,
      copiedFiles: copied,
      warnings,
    };
  }
  if (opts.dryRun) {
    return {
      ok: true,
      message: `[dry-run] 已复制到 ${target}，检测到变更：\n${statusBefore.trim()}\n未提交未推送。`,
      targetPath: target,
      copiedFiles: copied,
      pushed: false,
      warnings,
    };
  }

  // 7. git add/commit/push
  const branch = await gitCurrentBranch(repoDir, config.gitBin).catch(() => "main");
  const relTarget = path.relative(repoDir, target) || ".";
  const commitMessage =
    opts.message ||
    [
      `docs: 新增 ${relTarget.replace(/\\/g, "/")}`,
      "",
      "(由 memory-push MCP 推送零散文档资料)",
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
      targetPath: target,
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
      targetPath: target,
      copiedFiles: copied,
      commitHash,
      pushed: false,
      warnings,
    };
  }

  return {
    ok: true,
    message: `✅ 已推送 ${relTarget.replace(/\\/g, "/")} 到 MEMORY（commit ${commitHash.slice(0, 7)}，分支 ${branch}）`,
    targetPath: target,
    copiedFiles: copied,
    commitHash,
    pushed: true,
    warnings,
  };
}
