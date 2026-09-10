/**
 * publish_mcp：把指定本地 MCP server 目录发布到 zhaowen-mcp 集合仓库并 push。
 * 流程：校验源 → 复制（排除 node_modules/dist）→ 敏感检查 → README 表格 upsert → git add/commit/push。
 * 只被 index.ts 的 publish_mcp 工具调用（显式调用才 push）。
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
import { scanPath } from "./sensitive.js";
import { upsertReadmeRow } from "./readme.js";

const EXCLUDE = new Set([
  "node_modules", "dist", "__pycache__", ".venv", "venv", ".git",
  "reports", ".cache", "coverage", ".next",
]);

export interface PublishMcpOptions {
  /** 本地 MCP 源目录（绝对路径） */
  srcDir: string;
  /** 仓库内的目录名/服务名（缺省用源目录名） */
  targetName?: string;
  /** 功能描述（README 表格「功能」列） */
  description?: string;
  /** 服务简介（README 表格「服务」列） */
  title?: string;
  /** 敏感检查命中时的处理：abort 中止 / mask 仅提示 */
  sensitiveAction?: "abort" | "mask";
  /** 仅预览不实际提交 */
  dryRun?: boolean;
}

export interface PublishMcpResult {
  ok: boolean;
  message: string;
  targetDir?: string;
  copiedFiles?: number;
  commitHash?: string;
  pushed?: boolean;
  warnings?: string[];
}

function slug(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp";
}

export async function publishMcp(
  config: SkillManagerConfig,
  opts: PublishMcpOptions
): Promise<PublishMcpResult> {
  const warnings: string[] = [];
  const src = path.resolve(opts.srcDir);

  // 1. 校验源目录
  try {
    const st = await fs.stat(src);
    if (!st.isDirectory()) throw new Error("不是目录");
    const hasIndex = await fs
      .access(path.join(src, "index.ts"))
      .then(() => true)
      .catch(() => false);
    const hasPkg = await fs
      .access(path.join(src, "package.json"))
      .then(() => true)
      .catch(() => false);
    if (!hasIndex && !hasPkg) {
      return { ok: false, message: `源目录缺少 index.ts / package.json，可能不是 MCP server：${src}` };
    }
  } catch (e: any) {
    return { ok: false, message: `源目录不可用：${e.message}` };
  }

  const name = slug(opts.targetName || path.basename(src));
  const repoDir = config.mcpRepoDir;
  const target = path.join(repoDir, name);
  const repoUrl = config.mcpRepoUrl;

  // 2. 确保集合仓库工作副本存在
  try {
    await ensureRepo({ ...config, repoDir, repoUrl });
  } catch (e: any) {
    return { ok: false, message: `仓库不可用：${e.message}。请确认 SSH key 可访问 ${repoUrl}` };
  }

  // 3. 复制（更新语义：先删目标再复制）
  let copied = 0;
  try {
    if (path.resolve(target) === src) {
      return { ok: false, message: "源目录与仓库目标目录相同，无需发布。" };
    }
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

  // 5. README 表格 upsert
  const title = opts.title || name;
  const desc = opts.description || "（待补充功能说明）";
  try {
    const readmePath = path.join(repoDir, "README.md");
    const readme = await fs.readFile(readmePath, "utf8");
    if (!readme.includes(`${name}/`)) {
      const res = upsertReadmeRow(readme, `${name}/`, title, desc);
      if (res.changed) await fs.writeFile(readmePath, res.content, "utf8");
    } else {
      warnings.push(`README 已存在 ${name}/ 行，未重复登记（如需更新描述请手动改）`);
    }
  } catch (e: any) {
    warnings.push(`README 更新失败（已跳过）：${e.message}`);
  }

  // 6. 变更检查 + dryRun
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
      message: `[dry-run] 已复制到 ${target} 并更新 README，检测到变更：\n${statusBefore.trim()}\n未提交未推送。`,
      targetDir: target,
      copiedFiles: copied,
      pushed: false,
      warnings,
    };
  }

  // 7. git add/commit/push
  const branch = await gitCurrentBranch(repoDir, config.gitBin).catch(() => "main");
  const commitMessage = [
    `feat: publish ${name} MCP`,
    "",
    `- 来源: ${src}`,
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
    message: `✅ 已发布 ${name} 到 ${repoUrl}（commit ${commitHash.slice(0, 7)}，分支 ${branch}）`,
    targetDir: target,
    copiedFiles: copied,
    commitHash,
    pushed: true,
    warnings,
  };
}
