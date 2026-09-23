/**
 * codex-models 配置：Codex 目录、配置文件路径、one-hub API 凭据。
 */
import { homedir } from "os";
import { join } from "path";
import { readFileSync } from "fs";

export interface CodexModelsConfig {
  /** ~/.codex */
  codexDir: string;
  /** ~/.codex/models.json（模型目录） */
  modelsFile: string;
  /** ~/.codex/config.toml（当前模型选择） */
  configFile: string;
  /** one-hub API 基址（用于拉取可用模型列表） */
  apiUrl: string;
  /** one-hub API key */
  apiKey: string;
}

/** 从 ~/.claude.json 的 code-review env 读 one-hub 凭据（避免硬编码）；环境变量优先 */
function resolveOnehub(env: NodeJS.ProcessEnv): { apiUrl: string; apiKey: string } {
  const strip = (u: string) => u.replace(/\/$/, "");
  if (env.ONEHUB_API_KEY) {
    return { apiKey: env.ONEHUB_API_KEY, apiUrl: strip(env.ONEHUB_API_URL || "https://one-hub.hycx-gd.cn/v1") };
  }
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf-8"));
    const e = cfg.mcpServers?.["code-review"]?.env || {};
    return {
      apiKey: e.REVIEW_API_KEY || e.VISION_API_KEY || "",
      apiUrl: strip(e.REVIEW_API_URL || e.VISION_API_URL || "https://one-hub.hycx-gd.cn/v1"),
    };
  } catch {
    return { apiKey: "", apiUrl: "https://one-hub.hycx-gd.cn/v1" };
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CodexModelsConfig {
  const codexDir = env.CODEX_DIR || join(homedir(), ".codex");
  const oh = resolveOnehub(env);
  return {
    codexDir,
    modelsFile: join(codexDir, "models.json"),
    configFile: join(codexDir, "config.toml"),
    apiUrl: oh.apiUrl,
    apiKey: oh.apiKey,
  };
}
