/**
 * other-projects 配置：环境变量 + 默认值。
 */
export interface OtherProjectsConfig {
  /** GitHub 仓库远程地址 */
  repoUrl: string;
  /** 仓库工作副本目录 */
  repoDir: string;
  gitBin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OtherProjectsConfig {
  return {
    repoUrl: env.OTHER_REPO_URL || "git@github.com:zhuobichen/Other_Projects.git",
    repoDir: env.OTHER_REPO_DIR || "E:\\CodeProject\\mcp-server\\Other_Projects",
    gitBin: env.GIT_BIN || "git",
  };
}
