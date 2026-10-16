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
  /**
   * 【遗留 / 已弃用】早期设想的「<namespace>_用途_名称」命名规范。
   * **发布时的命名逻辑根本不读它**（见 lib/naming.ts 的 resolveTargetName —— 该参数是
   * 未使用参数，命名一律不加前缀）。留着只为兼容旧配置。
   */
  namespace: string;
  /**
   * 已知来源前缀列表。只用于**识别**已有名字带没带前缀（决定 README 归到哪个分区），
   * 不会给新名字补前缀。默认 `ylx,clz` 是历史遗留的两个来源。
   */
  namePrefixes: string[];
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
    // 已弃用、不参与命名；默认留空，免得 get_config 里显示一个像"规范"的前缀出来。
    namespace: env.SKILL_NAMESPACE || "",
    namePrefixes: (env.SKILL_NAME_PREFIXES || "ylx,clz")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    gitBin: env.GIT_BIN || "git",
    selfSrcDir: env.SKILL_MANAGER_SRC || "E:\\CodeProject\\mcp-server\\skill-manager",
    mcpRepoUrl: env.MCP_REPO_URL || "git@github.com:zhuobichen/zhaowen-mcp.git",
    mcpRepoDir: env.MCP_REPO_DIR || "E:\\CodeProject\\mcp-server\\zhaowen-mcp",
  };
}
