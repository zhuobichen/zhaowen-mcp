/**
 * 数据构建 / 刷新：把社区站数据与 Riot 官方游戏文件合并成 data/ 下的本地快照。
 *
 * 用法：
 *   npm run refresh         # 联网拉取、合并、写 data/，并归档当前补丁快照
 *   npm run report          # 不联网，只打印现有数据的校验报告
 *
 * 说明：本模块是唯一会联网的部分。MCP 工具运行时只读 data/ 下的文件；
 * 唯一例外是 refresh_data 工具，它调用本模块的 refreshData()。
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Augment,
  Availability,
  CnStats,
  Champion,
  Combo,
  ComboCard,
  Meta,
  PatchSnapshot,
  Rarity,
  SynergySet,
} from "./types.js";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
const SNAPSHOT_DIR = path.join(DATA_DIR, "patch-snapshots");
const ICON_BASE = "https://arammayhem.com";
const CDRAGON_ASSET_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";

export const SOURCES = {
  /** 社区站全量索引：符文中文说明、英雄梯队与胜率、羁绊、英雄×符文搭配 */
  mayhemSearchIndex: "https://arammayhem.com/search-index.json",
  /** 社区站符文强度榜：胜率/选取率/排名/强势英雄（只有进榜的符文才有） */
  mayhemAugmentTier: "https://arammayhem.com/zh-cn/tier-list/augment-overflow.json",
  /** 社区站符文列表页：每条符文带 live/retired 在池标记（HTML，需要解析） */
  mayhemAugmentsPage: "https://arammayhem.com/zh-cn/augments/",
  /** Riot 官方游戏文件导出：全体符文的官方中文名、品质、图标 */
  riotAugments:
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/cherry-augments.json",
  /** Riot 官方游戏文件导出：各模式（轮换池）的符文清单 */
  riotAugmentLists:
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/augment-lists.json",
  /** Riot 官方游戏文件导出：英雄的数字 id ↔ 英文 id 对照（本地客户端对局记录里只有数字 id） */
  riotChampionSummary:
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/champion-summary.json",
  /** 官方海斗符文定义（含文本 key）：223 条，字段 AugmentNameId / NameTra / DescriptionTra / AugmentTooltipTra */
  riotKiwiAugments: "https://raw.communitydragon.org/latest/game/maps/modespecificdata/kiwi.bin.json",
  /** 官方海斗（JADE 轮换池）符文定义：188 条 */
  riotKiwiJadeAugments:
    "https://raw.communitydragon.org/latest/game/maps/modespecificdata/kiwi_jade.bin.json",
  /** 官方中文字符串表（32MB）：key 全小写，符文的中文名/说明就在里面 */
  riotStringtable:
    "https://raw.communitydragon.org/latest/game/zh_cn/data/menu/en_us/lol.stringtable.json",
  /** 国服符文数据（aramgg 聚合的腾讯样本）：胜率/选取率/名次/强势英雄 */
  cnAugmentStats: "https://aramgg.com/data/augments-stats-raw.json",
  /** 国服英雄数据（aramgg 聚合的腾讯样本） */
  cnChampionStats: "https://aramgg.com/data/champions-stats.json",
  /** 社区站「英雄×符文」单件评价卡片：带 神级/强力/陷阱 等标签与中文攻略 */
  comboIndex: "https://arammayhem.com/zh-cn/combo-index-data.json",
  /** 云顶之弈官方数据（中文名：羁绊/棋子/装备），24MB，只把「内部标识→中文名」做成小表 */
  tftData: "https://raw.communitydragon.org/latest/cdragon/tft/zh_cn.json",
};

/**
 * 官方轮换池代号 → 中文模式名。
 * KIWI / KIWI_JADE 的具体含义官方没有公开文档，两者是海斗的两套符文池
 * （KIWI 223 项、KIWI_JADE 188 项，互有出入），这里统一标为海斗并在 meta.notes 里说明。
 */
const MODE_LABELS: Record<string, string> = {
  CHERRY: "斗魂竞技场",
  KIWI: "海克斯大乱斗",
  KIWI_JADE: "海克斯大乱斗",
};
/** 海斗相关的官方轮换池 */
const MAYHEM_LISTS = ["KIWI", "KIWI_JADE"];

const RARITY_FROM_OFFICIAL: Record<string, Rarity> = {
  kSilver: "silver",
  kGold: "gold",
  kPrismatic: "prismatic",
  kEventChoice: "event",
};

// ---------------------------------------------------------------- 工具函数

/** 名称归一化：全角/半角、大小写、空格与常见标点都不影响匹配 */
function normName(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　·・'"'"（）()【】\[\]，。、,.:：;；!！?？+\-_/\\]/g, "");
}

function sha1short(s: string): string {
  return createHash("sha1").update(s, "utf8").digest("hex").slice(0, 10);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // 社区站对默认 UA 不太友好，这里带上明确标识
      "user-agent": "aram-mayhem-mcp/1.0 (personal use; data snapshot)",
      accept: "text/html,application/json,*/*",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`拉取失败 ${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`返回内容不是合法 JSON（站点结构可能已变）: ${url}`);
  }
}

/** 符文列表页里解析出来的一行 */
interface PageRow {
  /** 页面上的英文名（小写），用作跨来源匹配的主键 */
  en: string;
  /** 页面上的中文名 */
  zh: string;
  availability: "live" | "retired";
  liveRank: number | null;
  allRank: number | null;
  winRate: string | null;
  pickRate: string | null;
  /** 行内列出的强势英雄（页面用的是英雄称号，展示时再换成常用名） */
  topChampions: string[];
  icon: string | null;
}

/**
 * 解析符文列表页。页面是服务端渲染的，每行形如
 *   <div ... data-name="坦克引擎 tank engine" data-rarity="gold" data-availability="live"
 *        data-live-rank="7" data-all-rank="7"> ... 胜率 59.53% / 选取率 40.91% ... <img src="/augments/xxx.webp" alt="坦克引擎">
 * 已下架的行的写法是 data-live-rank data-all-rank="8" hidden（live-rank 无取值），
 * 因此两个 rank 都做可选匹配。
 * 胜率/选取率用列上的 Tailwind class 定位；解析覆盖率不足时直接报错，
 * 避免页面改版后把残缺数据悄悄写进快照。
 */
function parseAugmentsPage(html: string): PageRow[] {
  const rows: PageRow[] = [];
  for (const chunk of html.split(/(?=data-name=")/).slice(1)) {
    const m =
      /^data-name="([^"]+)" data-rarity="([^"]*)" data-availability="([^"]*)" data-live-rank(?:="([^"]*)")? data-all-rank(?:="([^"]*)")?/.exec(
        chunk
      );
    if (!m) continue;
    const raw = m[1].trim();
    // 「中文名 english name」：英文名是从尾部连续出现的 ASCII 片段
    const enMatch = raw.match(/[A-Za-z][A-Za-z0-9'’.:\- ]*$/);
    const en = (enMatch?.[0] ?? "").trim();
    const zh = (enMatch ? raw.slice(0, enMatch.index) : raw).trim();
    const img = /<img src="([^"]+)"/.exec(chunk);
    const num = (s: string | undefined) => {
      const n = Number(s);
      return s && Number.isFinite(n) ? n : null;
    };
    const winRate =
      /class="text-right font-data[^"]*">([0-9.]+)%<\/div>/.exec(chunk)?.[1] ?? null;
    const pickRate =
      /class="hidden text-right font-data[^"]*">([0-9.]+)%<\/div>/.exec(chunk)?.[1] ?? null;
    const topChampions = [...chunk.matchAll(/champions\/icons\/[a-z0-9_]+\/64\.png" alt="([^"]*)"/gi)]
      .map((x) => x[1])
      .filter(Boolean);
    rows.push({
      en,
      zh,
      availability: m[3] === "retired" ? "retired" : "live",
      liveRank: num(m[4]),
      allRank: num(m[5]),
      winRate: winRate ? `${winRate}%` : null,
      pickRate: pickRate ? `${pickRate}%` : null,
      topChampions,
      icon: img ? img[1] : null,
    });
  }
  if (rows.length < 100) {
    throw new Error(
      `符文列表页解析结果异常（只解析出 ${rows.length} 行），页面结构可能已改版，请检查 parseAugmentsPage()`
    );
  }
  const withRate = rows.filter((r) => r.winRate).length;
  if (withRate < rows.length * 0.9) {
    throw new Error(
      `符文列表页胜率解析覆盖率过低（${withRate}/${rows.length}），页面结构可能已改版，请检查 parseAugmentsPage()`
    );
  }
  const dupes = rows.length - new Set(rows.map((r) => r.en || r.zh)).size;
  if (dupes > 0) console.warn(`⚠ 符文列表页出现 ${dupes} 行同名记录，已按首次出现为准`);
  return rows;
}

/**
 * 官方文本清洗：去掉富文本标签（<speed>、<keywordMajor>…）与 [br]，
 * 但**保留 `@xxx@` 占位符** —— 那是游戏内会替换成实际数值的量，抹掉反而是编数据。
 */
function cleanOfficialText(s: string): string {
  return s
    .replace(/\[\/?[a-z]+\/?\]/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]{1,40}>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function officialIconUrl(p: string | undefined | null): string | null {
  if (!p) return null;
  const rel = p.replace(/^\/lol-game-data\/assets\//i, "").toLowerCase();
  return CDRAGON_ASSET_BASE + rel;
}

function iconUrl(p: string | undefined | null): string | null {
  if (!p) return null;
  return /^https?:\/\//.test(p) ? p : ICON_BASE + p;
}

// ---------------------------------------------------------------- 原始数据类型（只覆盖用到的字段）

interface RawMayhemAugment {
  id: string;
  name: Record<string, string>;
  name_cn: string;
  rarity: string;
  description: Record<string, string>;
  icon: string;
}
interface RawMayhemChampion {
  id: string;
  championId: string;
  name: Record<string, string>;
  title: Record<string, string>;
  tier: string | null;
  winRate: string | null;
  icon: string;
}
interface RawMayhemSet {
  id: string;
  slug: string;
  name: Record<string, string>;
  description: Record<string, string>;
  icon: string;
  augments: string[];
}
interface RawMayhemCombo {
  slug: string;
  championId: string;
  augmentIds: string[];
  tier: string | null;
  desc: Record<string, string>;
}
interface RawMayhemIndex {
  patch: string;
  champions: RawMayhemChampion[];
  augments: RawMayhemAugment[];
  synergySets: RawMayhemSet[];
  combos: RawMayhemCombo[];
}
interface RawAugmentTier {
  href: string;
  icon: string;
  name: string;
  pickRate: string | null;
  rank: number | null;
  rarity: string;
  topChampions: Array<{ name: string }>;
  winRate: string | null;
}
interface RawRiotAugment {
  id: number;
  augmentNameId: string;
  nameTRA: string;
  simpleNameTRA: string;
  augmentSmallIconPath: string;
  rarity: string;
}
interface RawRiotList {
  modeName: string;
  augmentList: string[];
}
interface RawRiotChampionSummary {
  id: number;
  name: string;
  alias: string;
}
/** 官方 kiwi.bin.json / kiwi_jade.bin.json 里的符文定义（只取用到的字段） */
interface RawRiotAugmentDef {
  __type?: string;
  AugmentNameId: string;
  NameTra?: string;
  DescriptionTra?: string;
  AugmentTooltipTra?: string;
  AugmentPlatformId?: number;
  AugmentDisplayTags?: number[];
  AugmentSmallIconPath?: string;
}
/** 官方字符串表：{"entries": {key(小写): 文本}} */
interface RawStringTable {
  entries?: Record<string, string>;
}
/** aramgg 的原始行格式：[符文id, JSON字符串, 版本, 日期, 来源] */
type RawCnAugmentRow = [string, string, string?, string?, string?];
interface RawCnAugmentStats {
  win_rate?: string | null;
  pick_rate?: string | null;
  tier?: string | null;
  use_rank?: string | null;
  win_rank?: string | null;
  use_rank_delta?: string | null;
  win_rank_delta?: string | null;
  top_champion_ids?: string[] | null;
  source?: string;
  region?: string;
}
interface RawCnChampionStats {
  championId: string;
  tier?: number | string | null;
  winRate?: number | string | null;
  pickRate?: number | string | null;
  rank?: number | null;
  numGames?: number | null;
  version?: string;
  date?: string;
  source?: string;
}
interface RawTftData {
  /** 装备在顶层（所有赛季共用） */
  items?: Array<{ apiName?: string; name?: string }>;
  setData?: Array<{
    number?: number;
    traits?: Array<{ apiName?: string; name?: string }>;
    champions?: Array<{ apiName?: string; name?: string }>;
    items?: Array<{ apiName?: string; name?: string }>;
  }>;
}
interface RawComboIndex {
  typeLabels?: Record<string, string>;
  cards?: Array<{
    id: number;
    slug: string;
    championId: string;
    augmentId: string;
    tier?: string | null;
    types?: string[];
    description?: string | null;
    upvoteCount?: number;
  }>;
}

// ---------------------------------------------------------------- 主流程

export interface RefreshResult {
  patch: string;
  updatedAt: string;
  counts: Record<string, number>;
  meta: Meta;
  /** 是否在已有数据里发现了新的补丁号（提示归档了旧快照） */
  patchChangedFrom: string | null;
}

/**
 * 拉取三份数据源、合并、写盘。
 * @param opts.dryRun 只做合并与校验，不写任何文件
 */
export async function refreshData(opts: { dryRun?: boolean } = {}): Promise<RefreshResult> {
  const [
    index,
    tier,
    riotAugments,
    riotLists,
    championSummary,
    pageHtml,
    kiwiDefs,
    kiwiJadeDefs,
    cnAugRows,
    cnChampions,
    comboIndex,
  ] = await Promise.all([
    fetchJson<RawMayhemIndex>(SOURCES.mayhemSearchIndex),
    fetchJson<RawAugmentTier[]>(SOURCES.mayhemAugmentTier),
    fetchJson<RawRiotAugment[]>(SOURCES.riotAugments),
    fetchJson<RawRiotList[]>(SOURCES.riotAugmentLists),
    fetchJson<RawRiotChampionSummary[]>(SOURCES.riotChampionSummary),
    fetchText(SOURCES.mayhemAugmentsPage),
    fetchJson<Record<string, RawRiotAugmentDef>>(SOURCES.riotKiwiAugments),
    fetchJson<Record<string, RawRiotAugmentDef>>(SOURCES.riotKiwiJadeAugments),
    fetchJson<RawCnAugmentRow[]>(SOURCES.cnAugmentStats),
    fetchJson<RawCnChampionStats[]>(SOURCES.cnChampionStats),
    fetchJson<RawComboIndex>(SOURCES.comboIndex),
  ]);
  const pageRows = parseAugmentsPage(pageHtml);

  // 官方中文字符串表（32MB，最可能拉失败的一个源，失败时降级为「没有官方说明」并在 meta 里说明）
  let stringTable: RawStringTable | null = null;
  let stringTableError: string | null = null;
  try {
    stringTable = await fetchJson<RawStringTable>(SOURCES.riotStringtable);
  } catch (e: any) {
    stringTableError = e?.message ?? String(e);
  }
  /** 官方文本：字符串表的 key 全小写 */
  const strText = (key: string | undefined | null): string | null => {
    if (!key || !stringTable?.entries) return null;
    return stringTable.entries[key.toLowerCase()] ?? null;
  };

  // 官方符文定义：platformId / NameId → 中文名与说明
  const officialDefs = [...Object.values(kiwiDefs), ...Object.values(kiwiJadeDefs)].filter(
    (d) => d && d.__type === "AugmentData"
  );
  const defByPlatformId = new Map<number, RawRiotAugmentDef>();
  const defByNameId = new Map<string, RawRiotAugmentDef>();
  for (const d of officialDefs) {
    if (typeof d.AugmentPlatformId === "number") defByPlatformId.set(d.AugmentPlatformId, d);
    if (d.AugmentNameId) defByNameId.set(normName(d.AugmentNameId), d);
  }
  /** 官方文本（名字优先 NameTra，说明优先 DescriptionTra，退回 Tooltip） */
  const officialTextOf = (d: RawRiotAugmentDef | null) => {
    if (!d) return { name: null as string | null, desc: null as string | null };
    const name = strText(d.NameTra);
    const desc = strText(d.DescriptionTra) ?? strText(d.AugmentTooltipTra);
    return { name, desc: desc ? cleanOfficialText(desc) : null };
  };

  // 国服数据：符文按数字 id，英雄按数字 championId
  const cnByAugmentId = new Map<number, RawCnAugmentStats & { version: string | null; date: string | null }>();
  for (const row of cnAugRows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const id = Number(row[0]);
    if (!Number.isFinite(id)) continue;
    try {
      const stats = JSON.parse(row[1]) as RawCnAugmentStats;
      cnByAugmentId.set(id, { ...stats, version: row[2] ?? null, date: row[3] ?? null });
    } catch {
      /* 单行坏了就跳过，下面按覆盖数报告 */
    }
  }
  const cnByChampionId = new Map<number, RawCnChampionStats>();
  for (const c of cnChampions) {
    const id = Number(c?.championId);
    if (Number.isFinite(id)) cnByChampionId.set(id, c);
  }

  // 数字英雄 id（本地客户端对局记录用）→ 英文 id + 官方中文名
  const championIdMap: Record<string, { id: string; name: string }> = {};
  for (const c of championSummary) {
    if (!c || typeof c.id !== "number" || c.id <= 0) continue;
    championIdMap[String(c.id)] = { id: c.alias || String(c.id), name: c.name || c.alias || String(c.id) };
  }

  const validation: Meta["validation"] = {
    nameConflicts: [],
    rarityConflicts: [],
    officialOnly: [],
    communityOnly: [],
    missingDesc: [],
    missingStats: [],
    unresolvedSynergyAugments: [],
    invalidAliases: [],
    duplicateOfficialNames: [],
    officialDescMissing: [],
    unresolvedComboCards: [],
    dataSourceIssues: [],
  };
  if (stringTableError) {
    validation.dataSourceIssues.push(
      `官方字符串表未取到（${stringTableError}），本次没有官方中文说明，说明改用社区站文本`
    );
  }

  // 云顶官方数据（24MB，可选源：只用它做羁绊/棋子/装备的中文名；失败就退回显示内部标识）
  let tftNames: { traits: Record<string, string>; champions: Record<string, string>; items: Record<string, string> } = {
    traits: {},
    champions: {},
    items: {},
  };
  try {
    const tft = await fetchJson<RawTftData>(SOURCES.tftData);
    const put = (map: Record<string, string>, list?: Array<{ apiName?: string; name?: string }>) => {
      for (const it of list ?? []) if (it?.apiName && it.name) map[it.apiName] = it.name;
    };
    // 名额都取：羁绊/棋子按赛季、装备在顶层（全赛季共用），只存「内部标识→中文名」的瘦表
    for (const set of tft.setData ?? []) {
      put(tftNames.traits, set.traits);
      put(tftNames.champions, set.champions);
      put(tftNames.items, set.items);
    }
    put(tftNames.items, tft.items);
  } catch (e: any) {
    validation.dataSourceIssues.push(`云顶官方数据未取到（${e?.message ?? e}），云顶羁绊/棋子只能显示内部标识`);
  }


  // ---- 1. 官方数据：轮换池归属 + 按名称建索引
  const officialListsByAugment = new Map<string, Set<string>>();
  for (const l of riotLists) {
    for (const p of l.augmentList) {
      const short = p.split("/").pop() as string;
      if (!officialListsByAugment.has(short)) officialListsByAugment.set(short, new Set());
      officialListsByAugment.get(short)!.add(l.modeName);
    }
  }
  const officialByName = new Map<string, RawRiotAugment>();
  const officialById = new Map<string, RawRiotAugment>();
  for (const a of riotAugments) {
    officialByName.set(normName(a.nameTRA), a);
    officialById.set(normName(a.augmentNameId.replace(/^ARAM_/i, "")), a);
  }
  /** 轮换池清单按归一化名索引，兼容 ARAM_ 前缀与大小写差异 */
  const listsByNorm = new Map<string, Set<string>>();
  for (const [short, lists] of officialListsByAugment) {
    for (const key of [short, short.replace(/^ARAM_/i, "")]) {
      const k = normName(key);
      if (!listsByNorm.has(k)) listsByNorm.set(k, new Set());
      for (const m of lists) listsByNorm.get(k)!.add(m);
    }
  }
  const listsOf = (a: RawRiotAugment): Set<string> =>
    listsByNorm.get(normName(a.augmentNameId)) ??
    listsByNorm.get(normName(a.augmentNameId.replace(/^ARAM_/i, ""))) ??
    new Set<string>();

  // ---- 2. 强度榜：按中文名索引
  const tierByName = new Map<string, RawAugmentTier>();
  for (const t of tier) tierByName.set(normName(t.name), t);

  // ---- 3. 符文列表页：提供在池标记与两个排名
  const pageByNorm = new Map<string, PageRow>();
  for (const r of pageRows) {
    pageByNorm.set(normName(r.zh), r);
    if (r.en) pageByNorm.set(normName(r.en), r);
  }
  const pageOf = (...cands: Array<string | null | undefined>): PageRow | null => {
    for (const c of cands) {
      if (!c) continue;
      const hit = pageByNorm.get(normName(c));
      if (hit) return hit;
    }
    return null;
  };

  /** 国服数据（按数字符文 id 匹配） */
  const cnStatsOf = (platformId: number | null): CnStats | null => {
    if (platformId == null) return null;
    const r = cnByAugmentId.get(platformId);
    if (!r) return null;
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      winRate: num(r.win_rate),
      pickRate: num(r.pick_rate),
      tier: num(r.tier),
      useRank: num(r.use_rank),
      winRank: num(r.win_rank),
      useRankDelta: num(r.use_rank_delta),
      winRankDelta: num(r.win_rank_delta),
      topChampionIds: (r.top_champion_ids ?? []).map(Number).filter((n) => Number.isFinite(n)),
      version: r.version,
      date: r.date,
      source: r.source ?? "tencent",
    };
  };

  /**
   * 官方符文定义里没有名字，只有 platformId 与内部名。
   * 同一个符文在 cherry-augments.json 里可能有新旧两条（例如「物理转魔法」既有 ARAM_ADAPt#1205
   * 也有旧的 ADAPt#205，只有前者在 kiwi.bin.json 里有定义），所以这里按
   * platformId → 内部名 → 去掉 ARAM_ 前缀的名称 → 中文名 依次兜底匹配。
   */
  const defByTraName = new Map<string, RawRiotAugmentDef>();
  for (const c of riotAugments) {
    const d =
      defByPlatformId.get(c.id) ??
      defByNameId.get(normName(c.augmentNameId)) ??
      defByNameId.get(normName(String(c.augmentNameId).replace(/^ARAM_/i, "")));
    if (d && c.nameTRA && !defByTraName.has(normName(c.nameTRA))) defByTraName.set(normName(c.nameTRA), d);
  }
  const defOf = (official: RawRiotAugment | null): RawRiotAugmentDef | null => {
    if (!official) return null;
    return (
      defByPlatformId.get(official.id) ??
      defByNameId.get(normName(official.augmentNameId)) ??
      defByNameId.get(normName(String(official.augmentNameId).replace(/^ARAM_/i, ""))) ??
      defByTraName.get(normName(official.nameTRA)) ??
      null
    );
  };

  /**
   * 官方文件里同名不同 id 的符文（例如 ARAM_EarthAwakens 与 EarthAwakens 的中文名相同），
   * 匹配时只保留第一条，避免列表里出现重复条目。
   */
  const seenOfficialName = new Set<string>();

  // ---- 4. 合并：以社区站搜索索引为基准，挂上官方信息与在池状态
  const augments: Augment[] = [];
  const usedOfficial = new Set<RawRiotAugment>();
  for (const c of index.augments) {
    const enName = c.name?.en ?? null;
    const official =
      (enName ? officialById.get(normName(enName)) : undefined) ??
      officialById.get(normName(c.id)) ??
      officialByName.get(normName(c.name_cn)) ??
      null;
    let dupOfficialName: string | null = null;
    if (official) {
      const key = normName(official.nameTRA);
      if (seenOfficialName.has(key)) {
        dupOfficialName = official.nameTRA;
        validation.duplicateOfficialNames.push(`${official.nameTRA}（${official.augmentNameId}）`);
      } else {
        seenOfficialName.add(key);
        usedOfficial.add(official);
      }
    } else {
      validation.communityOnly.push(`${c.name_cn}（${c.id}）`);
    }
    const usableOfficial = dupOfficialName ? null : official;
    const page = pageOf(enName, c.name_cn, c.id, official?.nameTRA);

    const t = tierByName.get(normName(c.name_cn));
    const rarity = (c.rarity as Rarity) ?? "unknown";
    const officialRarity = usableOfficial?.rarity ?? null;
    const nameConflict =
      !!usableOfficial &&
      !!usableOfficial.nameTRA &&
      normName(usableOfficial.nameTRA) !== normName(c.name_cn);
    if (nameConflict) {
      validation.nameConflicts.push(
        `${c.name_cn}（社区站） vs ${usableOfficial!.nameTRA}（官方）· ${c.id}`
      );
    }
    if (
      officialRarity &&
      RARITY_FROM_OFFICIAL[officialRarity] &&
      RARITY_FROM_OFFICIAL[officialRarity] !== rarity
    ) {
      validation.rarityConflicts.push(
        `${c.name_cn}：社区站=${rarity} / 官方=${RARITY_FROM_OFFICIAL[officialRarity]}`
      );
    }

    // 官方轮换池归属：按官方内部名 / 社区站 slug / 中文名 / 英文名依次尝试归一化匹配
    const officialListSet = new Set<string>(usableOfficial ? listsOf(usableOfficial) : []);
    for (const cand of [c.id, c.name_cn, enName]) {
      const set = listsByNorm.get(normName(cand));
      if (set) for (const m of set) officialListSet.add(m);
    }

    // 官方文本：优先取游戏文件里的中文名与说明（这才是游戏内显示的内容）
    const def = defOf(usableOfficial);
    const officialText = officialTextOf(def);
    const descCommunity = c.description?.["zh-CN"] ?? null;
    // 官方定义里的 platformId 才是游戏内上报的符文 id（cherry 里可能有旧 id 的重复条目，
    // 例如「物理转魔法」同时存在 ARAM_ADAPt#1205 和旧的 ADAPt#205，国服数据是按 1205 登记的）
    const officialId = def?.AugmentPlatformId ?? usableOfficial?.id ?? null;
    if (def && !officialText.desc) validation.officialDescMissing.push(officialText.name || c.name_cn);

    augments.push({
      id: c.id,
      name: officialText.name || usableOfficial?.nameTRA || c.name_cn,
      nameCommunity: c.name_cn,
      nameOfficial: officialText.name || usableOfficial?.nameTRA || null,
      nameEn: enName,
      nameTw: c.name?.["zh-TW"] ?? null,
      rarity,
      officialRarity,
      desc: officialText.desc ?? descCommunity,
      descOfficial: officialText.desc,
      descCommunity,
      descEn: c.description?.en ?? null,
      icon: iconUrl(page?.icon ?? c.icon),
      officialIcon: officialIconUrl(def?.AugmentSmallIconPath ?? usableOfficial?.augmentSmallIconPath),
      modes: [...new Set([...officialListSet].map((m) => MODE_LABELS[m] ?? m))],
      officialLists: [...officialListSet],
      officialNameId: usableOfficial?.augmentNameId ?? null,
      officialId,
      // 名次/胜率优先用列表页（覆盖全部 201 行，含榜单 JSON 没给的前 4 名），
      // 榜单 JSON 补充选取率与更多强势英雄，并给出数据页链接。
      stats:
        t || page
          ? {
              rank: page?.allRank ?? t?.rank ?? null,
              liveRank: page?.liveRank ?? null,
              winRate: page?.winRate ?? t?.winRate ?? null,
              pickRate: page?.pickRate ?? t?.pickRate ?? null,
              topChampions:
                t?.topChampions?.length ? t.topChampions.map((x) => x.name) : page?.topChampions ?? [],
              url: t?.href ? ICON_BASE + t.href : null,
            }
          : null,
      cnStats: cnStatsOf(officialId),
      availability: page?.availability ?? "unknown",
      source: "community",
      nameConflict,
    });
  }

  // ---- 5. 官方海斗池里有、但社区站没收录的符文：保留（只有官方名，没有中文说明）
  const officialMayhemOnly = riotAugments.filter((a) => {
    if (usedOfficial.has(a)) return false;
    const lists = listsOf(a);
    return MAYHEM_LISTS.some((m) => lists.has(m));
  });
  for (const official of officialMayhemOnly) {
    const key = normName(official.nameTRA);
    if (seenOfficialName.has(key)) {
      validation.duplicateOfficialNames.push(`${official.nameTRA}（${official.augmentNameId}）`);
      continue;
    }
    seenOfficialName.add(key);
    const lists = listsOf(official);
    const page = pageOf(official.nameTRA, official.augmentNameId);
    const def = defOf(official);
    const officialText = officialTextOf(def);
    if (def && !officialText.desc) validation.officialDescMissing.push(officialText.name || official.nameTRA);
    validation.officialOnly.push(`${official.nameTRA}（${official.augmentNameId}）`);
    augments.push({
      id: official.augmentNameId.replace(/^ARAM_/i, "").toLowerCase(),
      name: officialText.name || page?.zh || official.nameTRA,
      nameCommunity: page?.zh || official.nameTRA,
      nameOfficial: officialText.name || official.nameTRA,
      nameEn: page?.en || null,
      nameTw: null,
      rarity: RARITY_FROM_OFFICIAL[official.rarity] ?? "unknown",
      officialRarity: official.rarity,
      desc: officialText.desc,
      descOfficial: officialText.desc,
      descCommunity: null,
      descEn: null,
      icon: iconUrl(page?.icon ?? null),
      officialIcon: officialIconUrl(def?.AugmentSmallIconPath ?? official.augmentSmallIconPath),
      modes: [...new Set([...lists].map((m) => MODE_LABELS[m] ?? m))],
      officialLists: [...lists],
      officialNameId: official.augmentNameId,
      officialId: official.id,
      stats: null,
      cnStats: cnStatsOf(official.id),
      availability: page?.availability ?? "unknown",
      source: "official",
      nameConflict: false,
    });
  }

  // ---- 5b. 只在列表页出现、两边索引都没有的符文（极少见，补一条以免漏掉在池符文）
  for (const r of pageRows) {
    const keyZh = normName(r.zh);
    const keyEn = r.en ? normName(r.en) : "";
    if (augments.some((a) => normName(a.name) === keyZh || normName(a.nameCommunity) === keyZh)) continue;
    if (keyEn && augments.some((a) => a.nameEn && normName(a.nameEn) === keyEn)) continue;
    if (!r.zh) continue;
    validation.officialOnly.push(`${r.zh}（仅列表页有）`);
    augments.push({
      id: keyEn || `page_${keyZh}`,
      name: r.zh,
      nameCommunity: r.zh,
      nameOfficial: null,
      nameEn: r.en || null,
      nameTw: null,
      rarity: "unknown",
      officialRarity: null,
      desc: null,
      descOfficial: null,
      descCommunity: null,
      descEn: null,
      icon: iconUrl(r.icon),
      officialIcon: null,
      modes: ["海克斯大乱斗"],
      officialLists: [],
      officialNameId: null,
      officialId: null,
      stats: null,
      cnStats: null,
      availability: r.availability,
      source: "official",
      nameConflict: false,
    });
  }

  for (const a of augments) {
    if (!a.desc) validation.missingDesc.push(a.name);
    if (!a.stats) validation.missingStats.push(a.name);
  }
  // 在池的排前面，其次按强度榜名次，最后按名字
  const availOrder: Record<Availability, number> = { live: 0, unknown: 1, retired: 2 };
  augments.sort((x, y) => {
    const ax = availOrder[x.availability] - availOrder[y.availability];
    if (ax) return ax;
    const rx = x.stats?.rank ?? 9999;
    const ry = y.stats?.rank ?? 9999;
    return rx - ry || x.name.localeCompare(y.name, "zh-Hans-CN");
  });

  const augmentById = new Map(augments.map((a) => [a.id, a]));

  // ---- 5. 英雄（含手动外号表）
  const aliasesRaw = existsSync(path.join(DATA_DIR, "aliases.json"))
    ? (JSON.parse(await readFile(path.join(DATA_DIR, "aliases.json"), "utf8")) as Record<string, string>)
    : {};
  const aliasById = new Map<string, string[]>();
  const championIds = new Set(index.champions.map((c) => c.id));
  for (const [nick, id] of Object.entries(aliasesRaw)) {
    if (nick.startsWith("_")) continue; // 注释字段
    if (!championIds.has(id)) {
      validation.invalidAliases.push(`${nick} → ${id}`);
      continue;
    }
    // 与外号重复的本名/称号不重复列出
    const champ = index.champions.find((c) => c.id === id)!;
    const known = [champ.title?.["zh-CN"], champ.name?.["zh-CN"], champ.id, champ.name?.en].map(normName);
    if (known.includes(normName(nick))) continue;
    if (!aliasById.has(id)) aliasById.set(id, []);
    aliasById.get(id)!.push(nick);
  }
  const champions: Champion[] = index.champions.map((c) => {
    // 国服数据：本地英雄 id → 数字 id → aramgg 行
    const numeric = Number(
      Object.entries(championIdMap).find(([, v]) => normName(v.id) === normName(c.id))?.[0] ?? NaN
    );
    const cn = Number.isFinite(numeric) ? cnByChampionId.get(numeric) : undefined;
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      id: c.id,
      name: c.title?.["zh-CN"] || c.name?.["zh-CN"] || c.id,
      epithet: c.name?.["zh-CN"] || "",
      nameEn: c.name?.en || c.id,
      epithetEn: c.title?.en || "",
      tier: c.tier ?? null,
      winRate: c.winRate ?? null,
      cnWinRate: num(cn?.winRate),
      cnPickRate: num(cn?.pickRate),
      cnTier: num(cn?.tier),
      cnRank: num(cn?.rank),
      icon: iconUrl(c.icon),
      aliases: aliasById.get(c.id) ?? [],
    };
  });

  // ---- 6b. 社区站「英雄×符文」单件评价卡片（带 神级/陷阱 标签与攻略文案）
  const typeLabels = comboIndex.typeLabels ?? {};
  const comboCards: ComboCard[] = [];
  for (const card of comboIndex.cards ?? []) {
    const champ = champions.find((x) => x.id === card.championId);
    const aug =
      augmentById.get(card.augmentId) ??
      augments.find((a) => a.nameEn && normName(a.nameEn) === normName(card.augmentId)) ??
      augments.find((a) => normName(a.name) === normName(card.augmentId)) ??
      null;
    if (!aug) {
      validation.unresolvedComboCards.push(`${card.augmentId}（${champ?.name ?? card.championId}）`);
      continue;
    }
    comboCards.push({
      id: card.id,
      slug: card.slug,
      championId: card.championId,
      championName: champ?.name ?? card.championId,
      augmentId: aug.id,
      augmentName: aug.name,
      tier: card.tier ?? null,
      types: (card.types ?? []).map((t) => typeLabels[t] ?? t),
      desc: card.description ?? null,
      upvoteCount: card.upvoteCount ?? 0,
    });
  }
  const cardsByChampion = new Map<string, ComboCard[]>();
  for (const c of comboCards) {
    if (!cardsByChampion.has(c.championId)) cardsByChampion.set(c.championId, []);
    cardsByChampion.get(c.championId)!.push(c);
  }

  // ---- 6. 羁绊（社区站给的是英文名，按英文名解析回符文 id）
  const idByEnName = new Map<string, string>();
  for (const c of index.augments) {
    if (c.name?.en) idByEnName.set(normName(c.name.en), c.id);
  }
  const synergySets: SynergySet[] = index.synergySets.map((s) => {
    const ids: string[] = [];
    const names: string[] = [];
    const unresolved: string[] = [];
    for (const en of s.augments ?? []) {
      const id = idByEnName.get(normName(en));
      if (id && augmentById.has(id)) {
        ids.push(id);
        names.push(augmentById.get(id)!.name);
      } else {
        unresolved.push(en);
        validation.unresolvedSynergyAugments.push(`${s.name?.["zh-CN"]}: ${en}`);
      }
    }
    return {
      id: s.id,
      slug: s.slug,
      name: s.name?.["zh-CN"] || s.slug,
      desc: s.description?.["zh-CN"] ?? null,
      icon: iconUrl(s.icon),
      augmentIds: ids,
      augmentNames: names,
      unresolved,
    };
  });

  // ---- 7. 英雄×符文搭配
  const combos: Combo[] = index.combos.map((c) => {
    const champ = champions.find((x) => x.id === c.championId);
    return {
      slug: c.slug,
      championId: c.championId,
      championName: champ?.name ?? c.championId,
      tier: c.tier ?? null,
      desc: c.desc?.["zh-CN"] ?? null,
      augmentIds: c.augmentIds ?? [],
      augmentNames: (c.augmentIds ?? []).map((i) => augmentById.get(i)?.name ?? i),
    };
  });

  // ---- 8. meta 与版本快照
  const updatedAt = new Date().toISOString();
  const meta: Meta = {
    patch: index.patch,
    updatedAt,
    sources: SOURCES,
    counts: {
      augments: augments.length,
      liveAugments: augments.filter((a) => a.availability === "live").length,
      retiredAugments: augments.filter((a) => a.availability === "retired").length,
      unknownAvailability: augments.filter((a) => a.availability === "unknown").length,
      augmentsWithStats: augments.filter((a) => a.stats).length,
      augmentsWithDesc: augments.filter((a) => a.desc).length,
      augmentsWithOfficialDesc: augments.filter((a) => a.descOfficial).length,
      augmentsWithCnStats: augments.filter((a) => a.cnStats).length,
      comboCards: comboCards.length,
      tftNames: Object.keys(tftNames.traits).length + Object.keys(tftNames.champions).length + Object.keys(tftNames.items).length,
      champions: champions.length,
      championIds: Object.keys(championIdMap).length,
      championsWithCnStats: champions.filter((c) => c.cnWinRate !== null).length,
      synergySets: synergySets.length,
      combos: combos.length,
      officialAugmentsTotal: riotAugments.length,
      pageRows: pageRows.length,
    },
    validation,
    notes: [
      "符文「效果说明」优先用官方游戏文件里的原文（含 @xxx@ 占位符 —— 那是游戏内会替换成实际数值的量，本工具不替它编数字）；官方文件里没有的才用社区站整理过的文本。",
      "符文「胜率/选取率/名次」有两套口径，都保留、不混算：社区站（全球口径，页面未标注样本量）与国服（aramgg 聚合的腾讯样本）。英雄胜率同理。",
      "「英雄×符文」单件评价带社区站标签：神级 / 强力 / 陷阱 / 娱乐 / 黑科技 / Bug，可用来避开陷阱组合。",
      "符文说明、胜率、羁绊、英雄搭配来自社区站 arammayhem.com 的公开静态数据，属第三方统计，非官方数值，仅供参考。",
      "在池状态（live/retired）取自社区站符文列表页的标记：live = 当前对局能选到，retired = 该站标注已移除，unknown = 只在官方游戏文件或搜索索引里出现、来源未标注状态。",
      "官方中文名/品质/图标来自 Riot 客户端游戏文件（经 CommunityDragon 导出）。两边名字冲突时以官方名为展示名，两种名字都能搜到。",
      "官方轮换池 KIWI / KIWI_JADE 均按海斗处理，两者差异没有官方文档说明；只出现在斗魂竞技场（CHERRY）池中的符文未收录。",
      "名次/胜率/选取率取自符文列表页；社区站另有榜单 JSON 但只覆盖第 5 名之后（前 4 名只出现在页面上），已以页面数据为准。页面未标注胜率的统计口径，仅供参考。",
      "只有官方数据、没有中文说明的符文，是官方游戏文件里有、社区站没有收录（多半是已轮换下架的老符文或其他模式残留），其说明无法从现有来源获得。",
    ],
  };

  const snapshot: PatchSnapshot = {
    patch: index.patch,
    updatedAt,
    augments: augments.map((a) => ({
      id: a.id,
      name: a.name,
      rarity: a.rarity,
      availability: a.availability,
      descHash: a.desc ? sha1short(a.desc) : null,
      rank: a.stats?.rank ?? null,
      winRate: a.stats?.winRate ?? null,
    })),
    champions: champions.map((c) => ({ id: c.id, tier: c.tier, winRate: c.winRate })),
    synergySets: synergySets.map((s) => ({ id: s.id, name: s.name, augmentIds: s.augmentIds })),
  };

  let patchChangedFrom: string | null = null;
  if (existsSync(path.join(DATA_DIR, "meta.json"))) {
    try {
      const prev = JSON.parse(await readFile(path.join(DATA_DIR, "meta.json"), "utf8")) as Meta;
      if (prev.patch && prev.patch !== index.patch) patchChangedFrom = prev.patch;
    } catch {
      /* 旧 meta 损坏时忽略 */
    }
  }

  if (!opts.dryRun) {
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    const write = async (name: string, data: unknown, pretty = false) =>
      writeFile(
        path.join(DATA_DIR, name),
        pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data),
        "utf8"
      );
    await write("augments.json", augments);
    await write("champions.json", champions);
    await write("champion-ids.json", championIdMap);
    await write("synergy-sets.json", synergySets);
    await write("combos.json", combos);
    await write("combo-cards.json", comboCards);
    await write("tft-names.json", tftNames);
    await write("meta.json", meta, true);
    await writeFile(
      path.join(SNAPSHOT_DIR, `${index.patch}.json`),
      JSON.stringify(snapshot),
      "utf8"
    );
  }

  return { patch: index.patch, updatedAt, counts: meta.counts, meta, patchChangedFrom };
}

// ---------------------------------------------------------------- CLI

function printReport(r: RefreshResult) {
  const { meta } = r;
  const v = meta.validation;
  const line = (t: string, xs: string[]) =>
    `  ${t.padEnd(26, " ")} ${xs.length ? xs.length + " 项" : "无"}`;
  console.log(`=== 海克斯大乱斗数据（补丁 ${r.patch}）===`);
  console.log(`更新时间: ${r.updatedAt}`);
  console.log(
    `符文 ${r.counts.augments}：在池 ${r.counts.liveAugments} / 已下架 ${r.counts.retiredAugments} / 状态未知 ${r.counts.unknownAvailability}`
  );
  console.log(
    `  有中文说明 ${r.counts.augmentsWithDesc}（其中官方原文 ${r.counts.augmentsWithOfficialDesc}）· 有社区站强度数据 ${r.counts.augmentsWithStats} · 有国服数据 ${r.counts.augmentsWithCnStats} · 列表页解析 ${r.counts.pageRows} 行`
  );
  console.log(`英雄 ${r.counts.champions}（有国服数据 ${r.counts.championsWithCnStats}）· 羁绊 ${r.counts.synergySets} · 英雄搭配 ${r.counts.combos} · 单件评价卡片 ${r.counts.comboCards}`);
  console.log(`官方符文库共 ${r.counts.officialAugmentsTotal} 条（含其他模式）`);
  console.log(`\n校验报告:`);
  console.log(line("官方/社区站名称不一致", v.nameConflicts));
  console.log(line("品质不一致", v.rarityConflicts));
  console.log(line("仅官方有（无中文说明）", v.officialOnly));
  console.log(line("缺中文说明", v.missingDesc));
  console.log(line("缺强度数据", v.missingStats));
  console.log(line("羁绊符文名未解析", v.unresolvedSynergyAugments));
  console.log(line("外号表无效条目", v.invalidAliases));
  console.log(line("官方同名去重", v.duplicateOfficialNames));
  console.log(line("官方定义缺说明", v.officialDescMissing));
  console.log(line("卡片符文未解析", v.unresolvedComboCards));
  if (v.dataSourceIssues.length)
    console.log(`\n数据源问题:\n  ${v.dataSourceIssues.join("\n  ")}`);
  if (v.nameConflicts.length) console.log(`\n名称不一致明细:\n  ${v.nameConflicts.join("\n  ")}`);
  if (v.rarityConflicts.length) console.log(`\n品质不一致明细:\n  ${v.rarityConflicts.join("\n  ")}`);
  if (v.unresolvedSynergyAugments.length)
    console.log(`\n羁绊未解析明细:\n  ${v.unresolvedSynergyAugments.join("\n  ")}`);
  if (v.invalidAliases.length) console.log(`\n外号表无效条目:\n  ${v.invalidAliases.join("\n  ")}`);
  if (r.patchChangedFrom) console.log(`\n⚠ 补丁从 ${r.patchChangedFrom} 变为 ${r.patch}，旧快照已保留在 data/patch-snapshots/`);
}

const invokedDirectly =
  process.argv[1] && /refresh\.(ts|js|mjs)$/.test(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  const reportOnly = process.argv.includes("--report-only");
  if (reportOnly) {
    const p = path.join(DATA_DIR, "meta.json");
    if (!existsSync(p)) {
      console.error("还没有 data/meta.json，请先运行 npm run refresh");
      process.exit(1);
    }
    const meta = JSON.parse(await readFile(p, "utf8")) as Meta;
    printReport({
      patch: meta.patch,
      updatedAt: meta.updatedAt,
      counts: meta.counts,
      meta,
      patchChangedFrom: null,
    });
  } else {
    refreshData()
      .then(printReport)
      .catch((e) => {
        console.error("刷新失败:", e?.message ?? e);
        process.exit(1);
      });
  }
}
