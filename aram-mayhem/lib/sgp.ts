/**
 * 腾讯 SGP（Service Gateway Proxy）—— 国服的**后端对局记录接口**。
 *
 * 为什么重要：本地客户端（LCU）只给滑动窗口（海斗 200 局、云顶 20 局，翻页参数还被忽略），
 * 而 SGP 的 match-history-query 是**真正按 startIndex 分页**的后端接口，
 * 社区实现（LeagueAkari）用它把对局翻到 1000 场。队列白名单里包含 2400（海克斯大乱斗）。
 *
 * 鉴权：用本机客户端自己的 entitlements token（只读，不碰账号密码）：
 *   accessToken ← LCU GET /entitlements/v1/token
 *   大区       ← LCU GET /lol-rso-auth/v1/authorization 的 currentPlatformId
 *   服务器地址 ← 下表（来源：LeagueAkari-Config 的 config/sgp/league-servers.json，
 *                该文件的 tencentServerMatchHistoryInteroperability 标明了国服 10 个大区支持战绩互通）
 *
 * 风险与边界（如实写在这里）：这是只读、低频、只查自己账号的查询；但仍然属于
 * 「第三方工具访问腾讯服务」，条款面见 README「掌盟」一节的风险说明。
 */
import { lcuGet } from "./lcu.js";

/** 国服 SGP 战绩服务地址（只列可用的大区；PBE/PREPBE 是测试服，也对齐了官方配置） */
export const CN_SGP_HOSTS: Record<string, string> = {
  HN1: "https://hn1-k8s-sgp.lol.qq.com:21019",
  HN10: "https://hn10-k8s-sgp.lol.qq.com:21019",
  TJ100: "https://tj100-sgp.lol.qq.com:21019",
  TJ101: "https://tj101-sgp.lol.qq.com:21019",
  NJ100: "https://nj100-sgp.lol.qq.com:21019",
  GZ100: "https://gz100-sgp.lol.qq.com:21019",
  CQ100: "https://cq100-sgp.lol.qq.com:21019",
  BGP2: "https://bgp2-k8s-sgp.lol.qq.com:21019",
  PBE: "https://pbe-sgp.lol.qq.com:21019",
  PREPBE: "https://prepbe-sgp.lol.qq.com:21019",
};

export interface SgpContext {
  accessToken: string;
  platformId: string;
  host: string;
  puuid: string | null;
  summonerName: string | null;
}

/** 从本机客户端取 SGP 需要的凭据与大区（不写任何文件、不改客户端） */
export async function getSgpContext(): Promise<SgpContext> {
  const token = await lcuGet<{ accessToken?: string }>("/entitlements/v1/token");
  if (!token?.accessToken) throw new Error("客户端没有返回 entitlements token（可能未登录）");

  let platformId = "";
  try {
    const auth = await lcuGet<any>("/lol-rso-auth/v1/authorization");
    platformId = String(auth?.currentPlatformId ?? auth?.platformId ?? "");
  } catch {
    /* 换下面兜底 */
  }
  if (!platformId) {
    const env = await lcuGet<any>("/lol-summoner/v1/current-summoner").catch(() => null);
    const region = String(env?.platformId ?? env?.region ?? "");
    platformId = region.replace(/^TENCENT_/i, "").toUpperCase();
  }
  const key = platformId.replace(/^TENCENT_/i, "").toUpperCase();
  const host = CN_SGP_HOSTS[key];
  if (!host) {
    throw new Error(
      `不认识的大区「${platformId}」。已知国服 SGP 大区：${Object.keys(CN_SGP_HOSTS).join("、")}`
    );
  }
  const me = await lcuGet<any>("/lol-summoner/v1/current-summoner").catch(() => null);
  return {
    accessToken: token.accessToken,
    platformId: key,
    host,
    puuid: me?.puuid ?? null,
    summonerName: me?.displayName || me?.gameName || null,
  };
}

/** SGP 通用 GET（自带 Bearer 鉴权） */
export async function sgpGet<T = any>(path: string, ctx: SgpContext): Promise<T> {
  const res = await fetch(ctx.host + path, {
    headers: {
      authorization: `Bearer ${ctx.accessToken}`,
      accept: "application/json",
      "user-agent": "aram-mayhem-mcp/1.0 (personal, read-only)",
    },
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SGP ${res.status}：${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`SGP 返回不是 JSON：${text.slice(0, 160)}`);
  }
}

/**
 * SGP 每条形如 `{ metadata: {...}, json: {真正的对局数据} }`（实测 2026-09-18）。
 * metadata：tags（如 ["normal","q_2400"]，q_2400 即海斗）、participants（puuid 数组）、match_id、timestamp
 * json：gameId / gameCreation / gameDuration / queueId / gameMode / participants[10]（字段平铺）…
 */
export interface SgpSummary {
  metadata?: {
    product?: string;
    tags?: string[];
    participants?: string[];
    timestamp?: string;
    match_id?: string;
    data_version?: string;
    info_type?: string;
    private?: boolean;
  };
  json?: any;
  [k: string]: unknown;
}

/** 取出真正对局数据（有的版本把它放成 JSON 字符串） */
export function unwrapSgp(item: SgpSummary): any {
  const j = (item as any).json;
  if (!j) return null;
  return typeof j === "string" ? JSON.parse(j) : j;
}

/** 从 metadata.tags 里取队列号（如 q_2400） */
export function queueIdFromTags(item: SgpSummary): number | null {
  for (const t of item.metadata?.tags ?? []) {
    const m = /^q_(\d+)$/.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}

export interface SgpPage {
  startIndex: number;
  count: number;
  games: SgpSummary[];
}

/**
 * 按 startIndex 翻页拉取对局（真的分页，不是滑动窗口）。
 * @param pageSize 每页条数（社区实现常用 20/100）
 * @param maxGames 最多拉多少条（防御性上限，默认 1000）
 */
export async function fetchSgpHistory(
  ctx: SgpContext,
  puuid: string,
  opts: { pageSize?: number; maxGames?: number; product?: "lol" | "tft"; onPage?: (p: SgpPage) => void } = {}
): Promise<SgpSummary[]> {
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 100, 200));
  const maxGames = Math.max(1, opts.maxGames ?? 1000);
  const out: SgpSummary[] = [];
  for (let start = 0; start < maxGames; start += pageSize) {
    const page = await sgpGet<any>(
      `/match-history-query/v1/products/${opts.product ?? "lol"}/player/${encodeURIComponent(puuid)}/SUMMARY?startIndex=${start}&count=${pageSize}`,
      ctx
    );
    // 实测结构：{ games: [ {metadata, json}, ... ] }（也兼容直接给数组的写法）
    const games: SgpSummary[] = Array.isArray(page) ? page : (page?.games ?? []);
    opts.onPage?.({ startIndex: start, count: games.length, games });
    if (!games.length) break; // 翻到底了
    out.push(...games);
    if (games.length < pageSize) break; // 最后一页不满，说明到底
  }
  return out;
}

/**
 * SGP 记录 → 本地归档用的对局形态。
 * 要点：SGP 的 participant 字段是**平铺**的（kills/win/playerAugment1… 不在 stats 子对象里），
 * 这里包一层 `stats`，让上层分析代码（读 p.stats.*）不用区分来源。
 * 另外 SGP 给的是**全部 10 个参与者**（LCU 只给自己的那一行），所以队友/对手分析要靠它。
 */
const SGP_STAT_KEYS = [
  "win",
  "kills",
  "deaths",
  "assists",
  "goldEarned",
  "totalDamageDealtToChampions",
  "totalDamageTaken",
  "totalHeal",
  "visionScore",
  "champLevel",
  "playerAugment1",
  "playerAugment2",
  "playerAugment3",
  "playerAugment4",
  "playerAugment5",
  "playerAugment6",
  "playerSubteamId",
];

export function sgpToGame(item: SgpSummary, puuid: string): any {
  const j = unwrapSgp(item) ?? {};
  const queueId = j.queueId ?? queueIdFromTags(item) ?? 0;
  const parts = (j.participants ?? []).map((p: any, idx: number) => {
    const stats: Record<string, unknown> = {};
    for (const k of SGP_STAT_KEYS) if (p[k] !== undefined) stats[k] = p[k];
    return {
      participantId: p.participantId ?? idx,
      championId: p.championId ?? 0,
      teamId: p.teamId ?? 0,
      puuid: p.puuid ?? null,
      summonerName: p.riotIdGameName ?? p.summonerName ?? null,
      stats,
    };
  });
  return {
    gameId: j.gameId,
    gameCreation: j.gameCreation,
    gameDuration: j.gameDuration,
    gameMode: j.gameMode ?? "",
    queueId,
    participants: parts,
    participantIdentities: parts.map((p: any) => ({
      participantId: p.participantId,
      player: { puuid: p.puuid, summonerName: p.summonerName },
    })),
  };
}


/** SGP 云顶记录 → 归档形态（participants 里带 placement/level/traits/units） */
export function sgpTftToGame(item: SgpSummary, puuid: string): any {
  const j = unwrapSgp(item) ?? {};
  const parts = (j.participants ?? []).map((p: any, idx: number) => ({
    participantId: p.participantId ?? idx,
    puuid: p.puuid ?? null,
    placement: p.placement,
    level: p.level,
    gold_left: p.gold_left,
    last_round: p.last_round,
    players_eliminated: p.players_eliminated,
    total_damage_to_players: p.total_damage_to_players,
    traits: (p.traits ?? []).map((t: any) => ({ name: t.name, num_units: t.num_units, style: t.style })),
    units: (p.units ?? []).map((u: any) => ({
      character_id: u.character_id,
      tier: u.tier,
      rarity: u.rarity,
      itemNames: u.itemNames,
    })),
  }));
  return {
    gameId: j.gameId,
    gameCreation: j.gameCreation ?? Number(j.game_datetime ?? 0),
    gameDuration: Math.round(j.game_length ?? 0),
    gameMode: "TFT",
    queueId: j.queueId ?? 0,
    participants: parts,
    participantIdentities: parts.map((p: any) => ({ participantId: p.participantId, player: { puuid: p.puuid } })),
  };
}
