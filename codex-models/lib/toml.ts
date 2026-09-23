/**
 * config.toml 轻量读写：只处理顶层的 model / model_provider / model_catalog_json。
 * 用精确的行级替换（不做完整 TOML 解析），避免破坏文件其它内容。
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";

const MODEL_RE = /^model\s*=\s*"([^"]*)"/m;
const PROVIDER_RE = /^model_provider\s*=\s*"([^"]*)"/m;
const CATALOG_RE = /^model_catalog_json\s*=\s*"([^"]*)"/m;

export interface ConfigSummary {
  model?: string;
  modelProvider?: string;
  catalogFile?: string;
  files: string;
}

export function readConfigSummary(configFile: string): ConfigSummary {
  if (!existsSync(configFile)) throw new Error(`配置文件不存在：${configFile}`);
  const s = readFileSync(configFile, "utf-8");
  return {
    model: s.match(MODEL_RE)?.[1],
    modelProvider: s.match(PROVIDER_RE)?.[1],
    catalogFile: s.match(CATALOG_RE)?.[1],
    files: configFile,
  };
}

export interface SetModelResult {
  previous?: string;
  current: string;
  backupPath: string;
}

/** 切换当前模型（改顶层 model = "..."）；写入前备份 config.toml */
export function setModel(configFile: string, slug: string): SetModelResult {
  if (!existsSync(configFile)) throw new Error(`配置文件不存在：${configFile}`);
  const s = readFileSync(configFile, "utf-8");
  if (!MODEL_RE.test(s)) {
    throw new Error('config.toml 中未找到顶层 `model = "..."` 行，拒绝修改');
  }
  const previous = s.match(MODEL_RE)?.[1];
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupPath = `${configFile}.bak.${ts}`;
  copyFileSync(configFile, backupPath);

  const updated = s.replace(MODEL_RE, `model = "${slug}"`);
  writeFileSync(configFile, updated, "utf-8");
  return { previous, current: slug, backupPath };
}
