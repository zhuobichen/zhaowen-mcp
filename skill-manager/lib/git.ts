/**
 * git 操作封装：child_process execFile/spawn（数组传参，规避中文/空格路径转义）。
 * 注意：只有 publishSkill 会调用 gitPush；list_skills/check_sensitive/get_config 不触碰 add/commit/push。
 */
import { execFile, spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import type { SkillManagerConfig } from "./config.js";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT = 60_000;

export function runGit(
  repoDir: string,
  gitBin: string,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      gitBin,
      args,
      { cwd: repoDir, timeout: timeoutMs, env: { ...process.env, LANG: "C" } },
      (error, stdout, stderr) => {
        if (error && (error as any).killed) {
          reject(new Error(`git 命令超时（${timeoutMs}ms），已终止进程: git ${args.join(" ")}`));
          return;
        }
        if (error) {
          reject(new Error(`git 失败(${args[0]}): ${(stderr || "").trim() || (error as any).message}`));
          return;
        }
        resolve({ code: 0, stdout: stdout.toString(), stderr: stderr.toString() });
      }
    );
  });
}

/** 带 stdin 输入的 git 命令（用于 `git commit -F -` 传中文 message，避免 shell 干扰） */
export function runGitInput(
  repoDir: string,
  gitBin: string,
  args: string[],
  input: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitBin, args, { cwd: repoDir, env: { ...process.env, LANG: "C" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`git 命令超时（${timeoutMs}ms），已终止进程: git ${args.join(" ")}`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`git 启动失败: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`git 失败(${args[0]}): ${stderr.trim()}`));
        return;
      }
      resolve({ code: 0, stdout, stderr });
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** 确保仓库工作副本存在；不存在或非 git 仓库则 clone */
export async function ensureRepo(config: SkillManagerConfig): Promise<void> {
  try {
    await fs.access(path.join(config.repoDir, ".git"));
    return;
  } catch {
    /* 需要 clone */
  }
  await fs.mkdir(path.dirname(config.repoDir), { recursive: true });
  await runGit(path.dirname(config.repoDir), config.gitBin, [
    "clone", config.repoUrl, config.repoDir,
  ]);
}

export function gitStatus(repoDir: string, gitBin: string): Promise<string> {
  return runGit(repoDir, gitBin, ["status", "--porcelain"]).then((r) => r.stdout);
}

export function gitLsFiles(repoDir: string, gitBin: string, dir: string): Promise<string[]> {
  return runGit(repoDir, gitBin, ["ls-files", "--", dir]).then((r) =>
    r.stdout.split(/\r?\n/).filter(Boolean)
  );
}

export function gitAdd(repoDir: string, gitBin: string, paths: string[] = []): Promise<GitResult> {
  return runGit(repoDir, gitBin, ["add", "-A", ...paths]);
}

export function gitCommit(repoDir: string, gitBin: string, message: string): Promise<GitResult> {
  return runGitInput(repoDir, gitBin, ["commit", "-F", "-"], message);
}

/** push 守卫：仅被 publishSkill 调用 */
export function gitPush(repoDir: string, gitBin: string, branch: string): Promise<GitResult> {
  return runGit(repoDir, gitBin, ["push", "origin", branch], 120_000);
}

export function gitCurrentBranch(repoDir: string, gitBin: string): Promise<string> {
  return runGit(repoDir, gitBin, ["symbolic-ref", "--short", "HEAD"]).then((r) => r.stdout.trim());
}

export function gitRevParseHead(repoDir: string, gitBin: string): Promise<string> {
  return runGit(repoDir, gitBin, ["rev-parse", "HEAD"]).then((r) => r.stdout.trim());
}
