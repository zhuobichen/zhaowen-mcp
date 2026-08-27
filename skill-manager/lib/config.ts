/**
 * 配置加载：环境变量 + 默认值。
 * 路径含中文/空格，多个根目录用分号 `;` 分隔（Windows PATH 惯例）。
 */
export interface SkillManagerConfig {
  /** 扫描的 skills 根目录 */
  roots: string[];
  /** GitHub 仓库远程地址（clone/校验用） */
  repoUrl: string;
  /** GitHub 仓库工作副本目录 */
  repoDir: string;
  /** 本地 INDEX.md 路径 */
  indexPath: string;
  /** 命名前缀（命名规范 ylx_用途_名称） */
  namespace: string;
  gitBin: string;
  /** MCP 自身源目录（sync_self 用） */
  selfSrcDir: string;
  /** MCP 集合仓库远程地址（sync_self 用） */
  mcpRepoUrl: string;
  /** MCP 集合仓库工作副本（sync_self 用） */
  mcpRepoDir: string;
}

const DEFAULT_ROOTS = [
  "C:\\Users\\chenlizhuo\\.claude\\skills",
  "E:\\CodeProject\\.agents\\skills",
  "E:\\CodeProject\\.opencode\\skills",
  "E:\\CodeProject\\ClaudeRoom\\skills",
  "E:\\OpenClaw\\QClaw\\resources\\openclaw\\config\\skills",
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SkillManagerConfig {
  const roots = (env.SKILL_ROOT_DIRS || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    roots: roots.length ? roots : DEFAULT_ROOTS,
    repoUrl: env.SKILL_REPO_URL || "git@github.com:zhuobichen/zhaowen-skill.git",
    repoDir:
      env.SKILL_REPO_DIR ||
      "E:\\CodeProject\\其余工程\\浏览器自动化操作\\zhaowen-skill",
    indexPath:
      env.SKILL_INDEX_PATH ||
      "C:\\Users\\chenlizhuo\\.claude\\skills\\INDEX.md",
    namespace: env.SKILL_NAMESPACE || "ylx",
    gitBin: env.GIT_BIN || "git",
    selfSrcDir: env.SKILL_MANAGER_SRC || "E:\\CodeProject\\mcp-server\\skill-manager",
    mcpRepoUrl: env.MCP_REPO_URL || "git@github.com:zhuobichen/zhaowen-mcp.git",
    mcpRepoDir: env.MCP_REPO_DIR || "E:\\CodeProject\\mcp-server\\zhaowen-mcp",
  };
}
