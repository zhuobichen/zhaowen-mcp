/**
 * 好友相关：读本地客户端的好友列表，并对某个好友做海斗统计。
 *
 * 说明与边界：
 *   · 只走本机 127.0.0.1 的客户端接口，只读；最多能拿到**最近 200 场**（接口上限），不是历史总场次。
 *   · 好友数据来自 `lol-chat/v1/friends`（国服好友名在 gameName 字段，name 常为空串）。
 *   · 客户端对任意 puuid 的对局记录接口（/lol-match-history/v1/products/lol/{puuid}/matches）实测可用，
 *     读的是公开的对局数据，不需要对方同意，也不会动对方任何设置。
 */
import { analyzeMayhemGames } from "./analysis.js";
import { loadLolGames } from "./games.js";
import { clientStatus, getMatchHistory, lcuGet, type LcuGameSummary } from "./lcu.js";
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

/** 好友的对局记录（走 puuid 路径，最多最近 200 场） */
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

  const { resolveAccountByName, archivedAccounts } = await import("./identity.js");
  const r = await resolveAccountByName(name);
  if (!r.matches.length) {
    const archived = await archivedAccounts();
    const status = await clientStatus();
    const friends = status.reachable ? await listFriends() : [];
    return [
      `没找到「${name}」——${r.note}。`,
      "",
      friends.length ? `当前好友：${friends.map((f) => `${f.gameName}#${f.gameTag}`).join("、")}` : "",
      archived.length
        ? `本地归档里能查的账号：${archived.slice(0, 8).map((a) => `${a.name}（${a.games} 局）`).join("、")}`
        : "本地归档里还没有任何账号（在线查过一次就会被记下来）。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (r.matches.length > 1) {
    return [
      `「${name}」匹配到多个账号，请指明是哪个：`,
      ...r.matches.slice(0, 8).map((m) => `  · ${m.name}（${m.source}）`),
    ].join("\n");
  }
  const f = r.matches[0];

  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
  const res = await loadLolGames(f.puuid, limit, f.name);
  if (!res.games.length) {
    return `没有 ${f.name} 的对局记录（${res.note}）。`;
  }
  const body = await analyzeMayhemGames(res.games, {
    ownerPuuid: f.puuid,
    ownerName: f.name.split("#")[0],
    subject: `好友 ${f.name}`,
    cachedTotal: res.archivedTotal,
    dataNote:
      "说明：好友的对局记录取决于本机客户端当前缓存了多少（实测会变，同一好友不同时刻可能是 20~200 把不等），" +
      "不是对方的历史总场次；样本量小时胜率没有统计意义。",
  });
  return [
    `（数据来自本机客户端缓存的对局记录；只能读好友列表里的人，读不到的是客户端没有的数据）`,
    "",
    body,
  ].join("\n");
}
