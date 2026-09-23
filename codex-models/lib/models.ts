/**
 * models.json 读写：列出 / 新增 / 删除 Codex 模型目录中的条目。
 * 每次写入前自动备份（models.json.bak.<时间戳>，最多保留 10 份）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, copyFileSync } from "fs";
import { join, dirname, basename } from "path";

export interface ModelEntry {
  slug: string;
  display_name?: string;
  context_window?: number;
  [k: string]: any;
}

export interface Catalog {
  models: ModelEntry[];
  [k: string]: any;
}

export function readCatalog(modelsFile: string): Catalog {
  if (!existsSync(modelsFile)) throw new Error(`模型目录不存在：${modelsFile}`);
  const raw = readFileSync(modelsFile, "utf-8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.models)) throw new Error("models.json 结构异常：缺少 models 数组");
  return data;
}

/** 备份 models.json（最多保留 10 份，多余的删最旧） */
export function backupModels(modelsFile: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const dir = dirname(modelsFile);
  const base = basename(modelsFile);
  const dst = join(dir, `${base}.bak.${ts}`);
  copyFileSync(modelsFile, dst);
  // 清理超量备份
  const baks = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.bak.`))
    .sort();
  while (baks.length > 10) {
    const old = baks.shift()!;
    try {
      unlinkSync(join(dir, old));
    } catch {
      /* ignore */
    }
  }
  return dst;
}

export function writeCatalog(modelsFile: string, cat: Catalog): void {
  writeFileSync(modelsFile, JSON.stringify(cat, null, 2), "utf-8");
}

/** 按 slug 精确查找 */
export function findBySlug(cat: Catalog, slug: string): ModelEntry | undefined {
  return cat.models.find((m) => m.slug === slug);
}

/** 关键词 → 模板 slug 的自动匹配规则（按顺序优先） */
const TEMPLATE_RULES: [RegExp, string][] = [
  [/^gpt-5\.6-sol/i, "gpt-5.6-sol"],
  [/^gpt-5\.6-terra/i, "gpt-5.6-terra"],
  [/^gpt-5\.6-luna/i, "gpt-5.6-luna"],
  [/gpt-5\.6/i, "gpt-5.6-sol"],
  [/gpt-5/i, "gpt-5.6-sol"],
  [/claude.*opus/i, "claude-opus-4-8"],
  [/claude.*haiku/i, "claude-haiku-4-5"],
  [/claude/i, "claude-sonnet-5"],
  [/gemini/i, "gemini-3.8-flash"],
  [/deepseek.*pro/i, "deepseek-v4-pro"],
  [/deepseek.*vision/i, "deepseek-v4-flash-vision-exp"],
  [/deepseek/i, "deepseek-v4-flash"],
  [/grok/i, "grok-4.6"],
  [/minimax/i, "MiniMax-M3"],
  [/composer/i, "composer-2.5"],
];

/** 根据 slug 自动挑选最相似的现有模型作为模板 */
export function autoTemplate(cat: Catalog, slug: string): ModelEntry | undefined {
  for (const [re, tpl] of TEMPLATE_RULES) {
    if (re.test(slug)) {
      const found = findBySlug(cat, tpl);
      if (found) return found;
    }
  }
  // 兜底：优先用当前常见的通用模型，否则第一个
  return findBySlug(cat, "gpt-5.6-sol") || cat.models[0];
}

export interface AddModelOptions {
  slug: string;
  /** 显式指定模板 slug；缺省自动匹配 */
  template?: string;
  displayName?: string;
  contextWindow?: number;
  description?: string;
  /** 其它需要覆盖的顶层字段 */
  overrides?: Record<string, any>;
}

export interface AddModelResult {
  added: ModelEntry;
  templateSlug: string;
  backupPath: string;
  replaced: boolean;
}

export function addModel(modelsFile: string, opts: AddModelOptions): AddModelResult {
  const cat = readCatalog(modelsFile);
  const slug = opts.slug.trim();
  if (!slug) throw new Error("slug 不能为空");

  let tpl: ModelEntry | undefined;
  if (opts.template) {
    tpl = findBySlug(cat, opts.template);
    if (!tpl) throw new Error(`未找到模板模型：${opts.template}`);
  } else {
    tpl = autoTemplate(cat, slug);
  }
  if (!tpl) throw new Error("模型目录为空，无法生成模板");

  // 深拷贝模板，覆盖字段
  const added: ModelEntry = JSON.parse(JSON.stringify(tpl));
  added.slug = slug;
  if (opts.displayName) added.display_name = opts.displayName;
  else added.display_name = slug;
  if (typeof opts.contextWindow === "number") {
    added.context_window = opts.contextWindow;
    if ("max_context_window" in added) added.max_context_window = opts.contextWindow;
  }
  if (opts.description) added.description = opts.description;
  if (opts.overrides) {
    for (const [k, v] of Object.entries(opts.overrides)) added[k] = v;
  }

  const backupPath = backupModels(modelsFile);
  const existingIdx = cat.models.findIndex((m) => m.slug === slug);
  const replaced = existingIdx >= 0;
  if (replaced) cat.models[existingIdx] = added;
  else cat.models.push(added);
  writeCatalog(modelsFile, cat);

  return { added, templateSlug: tpl.slug, backupPath, replaced };
}

export interface RemoveModelResult {
  removed: ModelEntry;
  backupPath: string;
}

export function removeModel(modelsFile: string, slug: string): RemoveModelResult {
  const cat = readCatalog(modelsFile);
  const idx = cat.models.findIndex((m) => m.slug === slug);
  if (idx < 0) throw new Error(`未找到模型：${slug}`);
  const backupPath = backupModels(modelsFile);
  const [removed] = cat.models.splice(idx, 1);
  writeCatalog(modelsFile, cat);
  return { removed, backupPath };
}
