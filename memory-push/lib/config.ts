/**
 * memory-push 配置：把本地零散文档资料推送到 MEMORY 知识库仓库。
 */
export interface MemoryPushConfig {
  /** MEMORY 仓库远程地址 */
  repoUrl: string;
  /** 仓库工作副本目录 */
  repoDir: string;
  gitBin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MemoryPushConfig {
  return {
    repoUrl: env.MEMORY_REPO_URL || "git@github.com:zhuobichen/MEMORY.git",
    repoDir: env.MEMORY_REPO_DIR || "E:\\CodeProject\\mcp-server\\MEMORY",
    gitBin: env.GIT_BIN || "git",
  };
}
