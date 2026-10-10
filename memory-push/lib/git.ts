/**
 * git 操作封装。只有 publish_project 会调用 add/commit/push（显式调用才推送）。
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runGit(repoDir: string, gitBin: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(gitBin, args, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as any).code === "ENOENT") {
        reject(new Error(`找不到 git 可执行文件：${gitBin}`));
        return;
      }
      resolve({ code: err ? ((err as any).code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

/** 确保仓库工作副本存在（不存在则 clone） */
export async function ensureRepo(repoDir: string, repoUrl: string, gitBin: string): Promise<void> {
  const gitDir = path.join(repoDir, ".git");
  try {
    await fs.access(gitDir);
    return;
  } catch {
    // 不存在 → clone
  }
  await fs.mkdir(path.dirname(repoDir), { recursive: true });
  const res = await new Promise<GitResult>((resolve, reject) => {
    execFile(gitBin, ["clone", repoUrl, repoDir], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as any).code === "ENOENT") return reject(new Error(`找不到 git：${gitBin}`));
      resolve({ code: err ? ((err as any).code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
  if (res.code !== 0) throw new Error(`clone 失败：${res.stderr || res.stdout}`);
}

export async function gitStatus(repoDir: string, gitBin: string): Promise<string> {
  const r = await runGit(repoDir, gitBin, ["status", "--porcelain"]);
  return r.stdout;
}
/**
 * 暂存指定路径。paths 必填——刻意不提供 `git add -A` 的退化路径，
 * 避免把仓库里无关的未提交改动一起卷进本次提交。
 */
export async function gitAdd(repoDir: string, gitBin: string, paths: string[]): Promise<GitResult> {
  if (!paths.length) throw new Error("gitAdd 需要显式 paths（不执行 git add -A）");
  return runGit(repoDir, gitBin, ["add", "--", ...paths]);
}
export async function gitCommit(repoDir: string, gitBin: string, message: string): Promise<GitResult> {
  return runGit(repoDir, gitBin, ["commit", "-m", message]);
}
export async function gitPush(repoDir: string, gitBin: string, branch: string): Promise<GitResult> {
  return runGit(repoDir, gitBin, ["push", "origin", branch]);
}
export async function gitCurrentBranch(repoDir: string, gitBin: string): Promise<string> {
  const r = await runGit(repoDir, gitBin, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.stdout.trim() || "main";
}
export async function gitRevParseHead(repoDir: string, gitBin: string): Promise<string> {
  const r = await runGit(repoDir, gitBin, ["rev-parse", "HEAD"]);
  return r.stdout.trim();
}

/** 读取远端地址，用于校验工作副本指向的是预期仓库（防写错副本） */
export async function gitRemoteUrl(repoDir: string, gitBin: string, remote = "origin"): Promise<string> {
  const r = await runGit(repoDir, gitBin, ["remote", "get-url", remote]);
  return r.stdout.trim();
}

/**
 * 拉取远端并 rebase 本地提交。脏工作树用 rebase.autoStash 自动 stash/unstash，
 * 避免"副本落后 → push 被拒"。调用方需容忍失败（降级为警告）。
 */
export async function gitPullRebase(repoDir: string, gitBin: string, branch: string): Promise<GitResult> {
  return runGit(repoDir, gitBin, ["-c", "rebase.autoStash=true", "pull", "--rebase", "origin", branch]);
}

/** 判断 HEAD 是否有对应上游分支 */
export async function gitHasUpstream(repoDir: string, gitBin: string): Promise<boolean> {
  const r = await runGit(repoDir, gitBin, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return r.code === 0 && !!r.stdout.trim();
}
