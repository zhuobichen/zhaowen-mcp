/**
 * memory-push 配置：把本地零散文档资料推送到 ZhaoWen_KnowledgeBase 知识库仓库。
 */
export interface MemoryPushConfig {
  /** 知识库仓库远程地址 */
  repoUrl: string;
  /** 仓库工作副本目录 */
  repoDir: string;
  gitBin: string;
  /** 知识库 wiki 层相对根目录（概念卡片等 LLM 维护内容都在其下） */
  wikiRoot: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MemoryPushConfig {
  return {
    repoUrl: env.MEMORY_REPO_URL || "git@github.com:zhuobichen/ZhaoWen_KnowledgeBase.git",
    repoDir: env.MEMORY_REPO_DIR || "E:\\CodeProject\\ZhaoWen_KnowledgeBase",
    gitBin: env.GIT_BIN || "git",
    wikiRoot: env.MEMORY_WIKI_ROOT || "OUTPUT",
  };
}
