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
export async function gitAdd(repoDir: string, gitBin: string, paths: string[] = []): Promise<GitResult> {
  return runGit(repoDir, gitBin, ["add", ...(paths.length ? paths : ["-A"])]);
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
