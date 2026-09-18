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

/** 一页对局摘要（结构随版本变化，这里只声明我们关心的字段，其余原样保留） */
export interface SgpSummary {
  gameId?: number;
  gameCreation?: number;
  gameDuration?: number;
  queueId?: number;
  gameMode?: string;
  participants?: Array<{
    puuid?: string;
    participantId?: number;
    championId?: number;
    teamId?: number;
    stats?: Record<string, unknown>;
  }>;
  [k: string]: unknown;
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
  opts: { pageSize?: number; maxGames?: number; onPage?: (p: SgpPage) => void } = {}
): Promise<SgpSummary[]> {
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 100, 200));
  const maxGames = Math.max(1, opts.maxGames ?? 1000);
  const out: SgpSummary[] = [];
  for (let start = 0; start < maxGames; start += pageSize) {
    const page = await sgpGet<{ games?: { games?: SgpSummary[] } } | SgpSummary[]>(
      `/match-history-query/v1/products/lol/player/${encodeURIComponent(puuid)}/SUMMARY?startIndex=${start}&count=${pageSize}`,
      ctx
    );
    const games: SgpSummary[] = Array.isArray(page) ? page : (page?.games?.games ?? []);
    opts.onPage?.({ startIndex: start, count: games.length, games });
    if (!games.length) break; // 翻到底了
    out.push(...games);
    if (games.length < pageSize) break; // 最后一页不满，说明到底
  }
  return out;
}

/** SGP 摘要 → 本地归档用的对局形态（字段名按实测结构尽量兼容） */
export function sgpToGame(raw: SgpSummary, puuid: string): any {
  const parts = (raw.participants ?? []).map((p) => ({
    participantId: p.participantId ?? 0,
    championId: p.championId ?? 0,
    teamId: p.teamId ?? 0,
    puuid: p.puuid ?? null,
    stats: (p.stats ?? {}) as Record<string, unknown>,
  }));
  // 有些版本把「我」的信息放在顶层
  if (!parts.length && (raw.championId || raw.teamId)) {
    parts.push({
      participantId: 0,
      championId: Number(raw.championId ?? 0),
      teamId: Number(raw.teamId ?? 0),
      puuid,
      stats: {},
    });
  }
  return {
    gameId: raw.gameId,
    gameCreation: raw.gameCreation,
    gameDuration: raw.gameDuration,
    gameMode: raw.gameMode ?? "",
    queueId: raw.queueId ?? 0,
    participants: parts,
    participantIdentities: parts.map((p) => ({ participantId: p.participantId, player: { puuid: p.puuid } })),
  };
}
