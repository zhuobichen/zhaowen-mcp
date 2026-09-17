/**
 * 本地数据加载与检索。
 *
 * 运行时只读 data/ 目录（由 lib/refresh.ts 生成的快照），不联网。
 * 全部数据一次性读进内存并建索引，单次查询很快。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Augment,
  Champion,
  CnStats,
  Combo,
  ComboCard,
  Meta,
  PatchSnapshot,
  SynergySet,
} from "./types.js";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
const SNAPSHOT_DIR = path.join(DATA_DIR, "patch-snapshots");

/** 名称归一化：全角半角、大小写、空格与常见标点都不影响匹配 */
export function normalize(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　·・'"'"（）()【】\[\]，。、,.:：;；!！?？+\-_/\\]/g, "");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export interface Data {
  meta: Meta;
  augments: Augment[];
  champions: Champion[];
  synergySets: SynergySet[];
  combos: Combo[];
  /** 社区站的「英雄×符文」单件评价卡片（带 神级/陷阱 等标签） */
  comboCards: ComboCard[];
  /** 云顶之弈官方中文名：羁绊/棋子/装备的内部标识 → 中文名（只含最近几个赛季） */
  tftNames: { traits: Record<string, string>; champions: Record<string, string>; items: Record<string, string> };
  /** 数字英雄 id → 英文 id / 官方中文名（本地客户端对局记录里只有数字 id） */
  championIds: Record<string, { id: string; name: string }>;
  /** 已归档的补丁号（升序） */
  patches: string[];
  augmentById: Map<string, Augment>;
  championById: Map<string, Champion>;
  combosByChampion: Map<string, Combo[]>;
  cardsByChampion: Map<string, ComboCard[]>;
}

let cached: Data | null = null;

export function loadData(): Data {
  if (cached) return cached;
  const required = ["meta.json", "augments.json", "champions.json", "synergy-sets.json", "combos.json"];
  const missing = required.filter((f) => !existsSync(path.join(DATA_DIR, f)));
  if (missing.length) {
    throw new Error(
      `缺少数据文件（${missing.join(", ")}）。请在 ${path.dirname(DATA_DIR)} 下运行 npm run refresh 生成。`
    );
  }
  const meta = readJson<Meta>(path.join(DATA_DIR, "meta.json"));
  const augments = readJson<Augment[]>(path.join(DATA_DIR, "augments.json"));
  const champions = readJson<Champion[]>(path.join(DATA_DIR, "champions.json"));
  const synergySets = readJson<SynergySet[]>(path.join(DATA_DIR, "synergy-sets.json"));
  const combos = readJson<Combo[]>(path.join(DATA_DIR, "combos.json"));
  const comboCards = existsSync(path.join(DATA_DIR, "combo-cards.json"))
    ? readJson<ComboCard[]>(path.join(DATA_DIR, "combo-cards.json"))
    : [];
  const tftNames = existsSync(path.join(DATA_DIR, "tft-names.json"))
    ? readJson<Data["tftNames"]>(path.join(DATA_DIR, "tft-names.json"))
    : { traits: {}, champions: {}, items: {} };
  // 老快照可能没有这个文件，缺了就退回空表（本地客户端功能会提示需要 refresh）
  const championIds = existsSync(path.join(DATA_DIR, "champion-ids.json"))
    ? readJson<Record<string, { id: string; name: string }>>(path.join(DATA_DIR, "champion-ids.json"))
    : {};

  const patches = existsSync(SNAPSHOT_DIR)
    ? readdirSync(SNAPSHOT_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    : [];

  const combosByChampion = new Map<string, Combo[]>();
  for (const c of combos) {
    if (!combosByChampion.has(c.championId)) combosByChampion.set(c.championId, []);
    combosByChampion.get(c.championId)!.push(c);
  }
  const cardsByChampion = new Map<string, ComboCard[]>();
  for (const c of comboCards) {
    if (!cardsByChampion.has(c.championId)) cardsByChampion.set(c.championId, []);
    cardsByChampion.get(c.championId)!.push(c);
  }

  cached = {
    meta,
    augments,
    champions,
    synergySets,
    combos,
    comboCards,
    tftNames,
    championIds,
    patches,
    augmentById: new Map(augments.map((a) => [a.id, a])),
    championById: new Map(champions.map((c) => [c.id, c])),
    combosByChampion,
    cardsByChampion,
  };
  return cached;
}

export function loadSnapshot(patch: string): PatchSnapshot | null {
  const f = path.join(SNAPSHOT_DIR, `${patch}.json`);
  return existsSync(f) ? readJson<PatchSnapshot>(f) : null;
}

// ---------------------------------------------------------------- 匹配

export interface AugmentMatch {
  augment: Augment;
  /** 命中原因，用于向用户解释匹配结果 */
  how: "完全同名" | "名称包含" | "别名/英文名" | "说明命中";
}

/** 一个符文的所有可搜名称 */
function augmentNames(a: Augment): string[] {
  return [a.name, a.nameCommunity, a.nameOfficial, a.nameEn, a.nameTw, a.id].filter(
    (x): x is string => !!x
  );
}

/**
 * 按关键词找符文：同名 > 名称包含 > 英文名/别名 > 说明命中。
 * 结果已按「在池优先、强度榜名次」排序。
 */
export function searchAugments(query: string, opts: { limit?: number } = {}): AugmentMatch[] {
  const { augments } = loadData();
  const q = normalize(query);
  const limit = opts.limit ?? 30;
  if (!q) return [];
  const exact: AugmentMatch[] = [];
  const partial: AugmentMatch[] = [];
  const descHit: AugmentMatch[] = [];
  for (const a of augments) {
    const names = augmentNames(a);
    const norm = names.map(normalize);
    if (norm.some((n) => n === q)) exact.push({ augment: a, how: "完全同名" });
    else if (norm.some((n) => n.includes(q))) partial.push({ augment: a, how: "名称包含" });
    else if (a.nameEn && normalize(a.nameEn).includes(q)) partial.push({ augment: a, how: "别名/英文名" });
    else if (a.desc && normalize(a.desc).includes(q)) descHit.push({ augment: a, how: "说明命中" });
  }
  return [...exact, ...partial, ...descHit].slice(0, limit);
}

/** 找英雄：常用名/称号/英文名/id/手动外号都能命中 */
export function findChampions(query: string): Champion[] {
  const { champions } = loadData();
  const q = normalize(query);
  if (!q) return [];
  const score = (c: Champion): number | null => {
    const fields = [c.name, c.epithet, c.nameEn, c.id, c.epithetEn, ...c.aliases];
    const norm = fields.map(normalize);
    if (norm.includes(q)) return 0;
    if (c.aliases.some((x) => normalize(x) === q)) return 1;
    if (norm.some((n) => n.startsWith(q))) return 2;
    if (norm.some((n) => n.includes(q))) return 3;
    return null;
  };
  return champions
    .map((c) => ({ c, s: score(c) }))
    .filter((x): x is { c: Champion; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || (b.c.winRate ?? "").localeCompare(a.c.winRate ?? ""))
    .map((x) => x.c);
}

/** 该英雄是否出现在符文的强势英雄列表里（社区站用的是英雄称号，如「迅捷斥候」） */
export function championNamesFor(c: Champion): string[] {
  return [c.epithet, c.name, c.nameEn].filter(Boolean);
}

// ---------------------------------------------------------------- 文案

export const RARITY_CN: Record<string, string> = {
  silver: "银色",
  gold: "金色",
  prismatic: "棱彩",
  event: "事件",
  unknown: "未知品质",
};

export function rarityCn(a: Augment): string {
  return RARITY_CN[a.rarity] ?? a.rarity;
}

export function availabilityCn(a: Augment): string {
  if (a.availability === "live") return "在池";
  if (a.availability === "retired") return "已下架";
  return "状态未知";
}

/** 一行式摘要，用于列表 */
export function augmentLine(a: Augment, idx?: number): string {
  const rank = a.stats?.rank ? `#${a.stats.rank}` : "未进榜";
  const wr = a.stats?.winRate ? ` 胜率 ${a.stats.winRate}` : "";
  const cn = a.cnStats?.winRate != null ? ` 国服胜率 ${pct(a.cnStats.winRate)}` : "";
  const state = a.availability === "live" ? "" : `（${availabilityCn(a)}）`;
  return `${idx !== undefined ? `${idx}. ` : ""}${a.name}${state} · ${rarityCn(a)} · ${rank}${wr}${cn}`;
}

/** 0.5595 → 55.95% */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "无";
  return `${(v * 100).toFixed(digits)}%`;
}

/** 国服数据一行摘要 */
export function cnStatsLine(cn: CnStats | null): string | null {
  if (!cn) return null;
  const parts: string[] = [];
  if (cn.winRate != null) parts.push(`胜率 ${pct(cn.winRate)}`);
  if (cn.pickRate != null) parts.push(`选取率 ${pct(cn.pickRate)}`);
  if (cn.useRank != null) {
    const d = cn.useRankDelta ? `（较上周 ${cn.useRankDelta > 0 ? "+" : ""}${cn.useRankDelta}）` : "";
    parts.push(`使用率第 ${cn.useRank} 名${d}`);
  }
  if (cn.winRank != null) parts.push(`胜率第 ${cn.winRank} 名`);
  if (cn.tier != null) parts.push(`档位 ${cn.tier}`);
  const tail = cn.date ? ` · ${cn.version ?? ""} ${cn.date}` : "";
  return `${parts.join(" · ")}${tail}（来源：aramgg 聚合的国服腾讯样本）`;
}

/**
 * 多行详情。
 * 说明文字优先用官方游戏文件原文（游戏内显示的就是这段），并标明 @xxx@ 是占位符；
 * 官方没有时用社区站整理过的文本。
 */
export function augmentDetail(a: Augment, opts: { withDesc?: boolean } = {}): string {
  const lines: string[] = [`【${a.name}】${rarityCn(a)} · ${availabilityCn(a)}`];
  if (a.nameConflict && a.nameOfficial) lines.push(`  官方名/社区站名：${a.nameOfficial} / ${a.nameCommunity}`);
  if (a.nameEn) lines.push(`  英文名：${a.nameEn}`);
  if (a.modes.length) lines.push(`  模式：${a.modes.join("、")}${a.officialLists.length ? `（官方池 ${a.officialLists.join("/")}）` : ""}`);

  if (opts.withDesc !== false) {
    const official = a.descOfficial ? cleanDesc(a.descOfficial) : null;
    if (official) {
      lines.push(`  说明（游戏内原文）：${official}`);
      if (/@[^@\s]+@/.test(official)) {
        lines.push("    （@xxx@ 是游戏内按实际数值替换的占位符，本工具不替它填数字）");
      }
    }
    const community = a.descCommunity ? cleanDesc(a.descCommunity) : null;
    if (community && community !== official) {
      lines.push(`  社区站整理：${community}`);
    }
    if (!official && !community) {
      lines.push("  说明：无（官方文件里没有该符文的文本，社区站也没收录）");
    }
  }

  if (a.stats) {
    const parts: string[] = [];
    if (a.stats.rank) parts.push(`综合第 ${a.stats.rank} 名`);
    if (a.stats.liveRank) parts.push(`在池第 ${a.stats.liveRank} 名`);
    if (a.stats.winRate) parts.push(`胜率 ${a.stats.winRate}`);
    if (a.stats.pickRate) parts.push(`选取率 ${a.stats.pickRate}`);
    lines.push(`  强度（社区站·全球）：${parts.join(" · ") || "无"}`);
    if (a.stats.topChampions.length)
      lines.push(`  强势英雄：${a.stats.topChampions.map(championDisplayName).join("、")}`);
    if (a.stats.url) lines.push(`  数据页：${a.stats.url}`);
  } else {
    lines.push("  强度（社区站·全球）：未进强度榜（榜单只覆盖进榜符文，不代表弱）");
  }
  const cn = cnStatsLine(a.cnStats);
  if (cn) lines.push(`  强度（国服）：${cn}`);
  return lines.join("\n");
}

/** 单件评价卡片一行：类型标签 + 档位 + 攻略 */
export function comboCardLine(card: ComboCard, withChampion = false): string {
  const tags = card.types.length ? `【${card.types.join("/")}】` : "";
  const tier = card.tier ? `${card.tier} 档 ` : "";
  const who = withChampion ? `${card.championName} ` : "";
  return `  · ${who}${tags}${tier}${card.augmentName}：${card.desc ?? "（无攻略文案）"}`;
}

/**
 * 说明里带 [stat:xx] / <lifeSteal> / [br/] 之类的标记，展示时清掉。
 * 标记本身不含需要保留的信息（都是配色/换行/数值高亮），清掉后中文仍可读。
 */
export function cleanDesc(s: string): string {
  return s
    .replace(/\[\/?[a-z]+(?::[a-z_]+)?\/?\]/gi, (m) => (/br|hr/i.test(m) ? " " : ""))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]{1,40}>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 社区站的「强势英雄」用的是英雄称号（如 迅捷斥候），这里换成常用名（提莫） */
let epithetMap: Map<string, string> | null = null;
export function championDisplayName(rawName: string): string {
  if (!epithetMap) {
    epithetMap = new Map();
    for (const c of loadData().champions) {
      epithetMap.set(normalize(c.epithet), c.name);
      epithetMap.set(normalize(c.name), c.name);
      epithetMap.set(normalize(c.nameEn), c.name);
    }
  }
  return epithetMap.get(normalize(rawName)) ?? rawName;
}
