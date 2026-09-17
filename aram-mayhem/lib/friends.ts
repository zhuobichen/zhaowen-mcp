/**
 * 好友相关：读本地客户端的好友列表，并对某个好友做海斗统计。
 *
 * 说明与边界：
 *   · 只走本机 127.0.0.1 的客户端接口，只读；能读到的是**客户端当前缓存**的对局，不是历史总场次。
 *   · 好友数据来自 `lol-chat/v1/friends`（国服好友名在 gameName 字段，name 常为空串）。
 *   · 客户端对任意 puuid 的对局记录接口（/lol-match-history/v1/products/lol/{puuid}/matches）实测可用，
 *     读的是公开的对局数据，不需要对方同意，也不会动对方任何设置。
 */
import { analyzeMayhemGames } from "./analysis.js";
import { clientStatus, lcuGet, type LcuGameSummary, type LcuMatchList } from "./lcu.js";
import { normalize } from "./store.js";

export interface Friend {
  gameName: string;
  gameTag: string;
  puuid: string | null;
  summonerId: number | null;
  availability: string;
  /** 国服客户端的好友分组名 */
  groupName?: string;
}

function mapFriend(raw: any): Friend {
  return {
    gameName: String(raw?.gameName ?? raw?.name ?? "(未命名)"),
    gameTag: String(raw?.gameTag ?? ""),
    puuid: raw?.puuid ?? null,
    summonerId: typeof raw?.summonerId === "number" ? raw.summonerId : null,
    availability: String(raw?.availability ?? "unknown"),
    groupName: raw?.groupName ?? undefined,
  };
}

/** 好友列表（离线也在列表里） */
export async function listFriends(): Promise<Friend[]> {
  const raw = await lcuGet<any[]>("/lol-chat/v1/friends");
  return (raw ?? []).map(mapFriend).sort((a, b) => a.gameName.localeCompare(b.gameName, "zh-Hans-CN"));
}

/**
 * 按名字找人：支持「完整名」「名#tag」「部分名」「puuid」「summonerId」。
 * 命中多个时返回全部，由调用方让用户确认。
 */
export async function findFriend(query: string): Promise<Friend[]> {
  const friends = await listFriends();
  const q = normalize(query);
  if (!q) return [];
  const scored: Array<{ f: Friend; s: number }> = [];
  for (const f of friends) {
    const full = `${f.gameName}#${f.gameTag}`;
    const fields = [f.gameName, full, f.gameTag, f.puuid ?? "", String(f.summonerId ?? "")].map(normalize);
    let s: number | null = null;
    if (fields.includes(q)) s = 0;
    else if (normalize(full) === q) s = 1;
    else if (fields.some((x) => x.startsWith(q))) s = 2;
    else if (fields.some((x) => x.includes(q))) s = 3;
    if (s !== null) scored.push({ f, s });
  }
  return scored.sort((a, b) => a.s - b.s).map((x) => x.f);
}

function availabilityCn(a: string): string {
  const map: Record<string, string> = {
    offline: "离线",
    online: "在线",
    mobile: "手机在线",
    dnd: "游戏中/免打扰",
    away: "离开",
    chat: "在线可聊",
  };
  return map[a] ?? a;
}

export function friendLine(f: Friend): string {
  return `${f.gameName}#${f.gameTag} · ${availabilityCn(f.availability)}`;
}

/** 好友的对局记录（客户端缓存范围内的全部） */
export async function getFriendGames(puuid: string, limit = 200): Promise<{ games: LcuGameSummary[]; total: number }> {
  const list = await lcuGet<LcuMatchList>(
    `/lol-match-history/v1/products/lol/${encodeURIComponent(puuid)}/matches?begIndex=0&endIndex=${Math.max(1, limit)}`
  );
  const games = list.games?.games ?? [];
  return { games, total: list.games?.gameCount ?? games.length };
}

// ---------------------------------------------------------------- 工具实现

export async function listMyFriends(): Promise<string> {
  const status = await clientStatus();
  if (!status.reachable) {
    return `读不到好友列表：${status.error}\n（需要游戏客户端正在运行。）`;
  }
  const friends = await listFriends();
  if (!friends.length) return "客户端返回的好友列表是空的。";
  const online = friends.filter((f) => f.availability !== "offline");
  return [
    `好友列表（共 ${friends.length} 人，在线 ${online.length} 人）：`,
    "",
    ...friends.map((f) => `  · ${friendLine(f)}`),
    "",
    "想看某个好友的海斗统计：用 get_friend_stats 传名字（部分字也能匹配）。",
  ].join("\n");
}

export async function friendStats(args: { friend: string; limit?: number }): Promise<string> {
  const name = String(args.friend ?? "").trim();
  if (!name) return "请提供好友的名字（部分字也可以）。";
  const status = await clientStatus();
  if (!status.reachable) {
    return `读不到好友数据：${status.error}\n（需要游戏客户端正在运行。）`;
  }
  const matches = await findFriend(name);
  if (!matches.length) {
    const friends = await listFriends();
    return [
      `好友列表里没找到「${name}」。`,
      "",
      `当前好友：${friends.map((f) => `${f.gameName}#${f.gameTag}`).join("、") || "（空）"}`,
      "（只能查好友列表里的人；非好友在本地客户端里没有数据。）",
    ].join("\n");
  }
  if (matches.length > 1) {
    return [
      `「${name}」匹配到多个好友，请指明是哪个：`,
      ...matches.slice(0, 8).map((f) => `  · ${f.gameName}#${f.gameTag}`),
    ].join("\n");
  }
  const f = matches[0];
  if (!f.puuid) return `${f.gameName}#${f.gameTag} 没有 puuid，读不到对局记录。`;

  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
  const { games, total } = await getFriendGames(f.puuid, limit);
  if (!games.length) {
    return `客户端里没有 ${f.gameName}#${f.gameTag} 的对局记录（可能是缓存里没有，或该账号最近没打）。`;
  }
  const body = await analyzeMayhemGames(games, {
    ownerPuuid: f.puuid,
    ownerName: f.gameName,
    subject: `好友 ${f.gameName}#${f.gameTag}`,
    cachedTotal: total,
  });
  return [
    `（数据来自本机客户端缓存的对局记录；只能读好友列表里的人，读不到的是客户端没有的数据）`,
    "",
    body,
  ].join("\n");
}
