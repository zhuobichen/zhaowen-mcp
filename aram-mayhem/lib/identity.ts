/**
 * 身份解析：把「我」「某个好友」解析成可查询的 puuid。
 *
 * 在线时走客户端（当前账号 + 好友列表），离线时退回：
 *   · 「我」→ data/profile.json 里固定下来的账号；
 *   · 「好友」→ 本地归档里出现过的账号（刷新时会记下查询目标的名字）。
 * 这样客户端没开时，依然能对归档数据出分析，而不是直接报「读不到」。
 */
import { archiveStats } from "./archive.js";
import { clientStatus, getSummoner } from "./lcu.js";
import { ensureProfile, loadProfile } from "./profile.js";

export interface Identity {
  puuid: string;
  name: string;
  /** 身份是怎么确定的，用于在输出里说明 */
  source: string;
}

/** 我自己是谁 */
export async function resolveMe(): Promise<Identity | null> {
  const status = await clientStatus();
  if (status.reachable) {
    try {
      const me = await getSummoner();
      if (me.puuid) {
        const name = me.displayName || me.gameName || "（未命名）";
        await ensureProfile(); // 顺手刷新固定信息
        return { puuid: me.puuid, name, source: "客户端当前登录账号" };
      }
    } catch {
      /* 落到下面用固定信息 */
    }
  }
  const p = loadProfile();
  if (p?.puuid) {
    return {
      puuid: p.puuid,
      name: p.summonerName,
      source: `本地固定的账号（${new Date(p.updatedAt).toLocaleString("zh-CN", { hour12: false })} 保存）`,
    };
  }
  return null;
}

export interface AccountMatch extends Identity {
  games: number;
}

/** 在「客户端好友列表 + 本地归档出现过的账号」里找某个名字 */
export async function resolveAccountByName(query: string): Promise<{
  matches: AccountMatch[];
  clientOnline: boolean;
  /** 找过但没有的地方（用于给用户解释） */
  note: string;
}> {
  const q = query.trim();
  if (!q) return { matches: [], clientOnline: false, note: "请提供名字" };

  const status = await clientStatus();
  const found = new Map<string, AccountMatch>();

  if (status.reachable) {
    try {
      const { findFriend } = await import("./friends.js");
      for (const f of await findFriend(q)) {
        if (f.puuid) found.set(f.puuid, { puuid: f.puuid, name: `${f.gameName}#${f.gameTag}`, source: "客户端好友列表", games: 0 });
      }
    } catch {
      /* 好友列表读不到就只靠归档 */
    }
  }

  // 归档里出现过的账号（离线时的唯一线索；在线时作为补充）
  for (const kind of ["lol", "tft"] as const) {
    const st = await archiveStats(kind);
    for (const a of st.accounts) {
      const nm = a.name ?? "";
      if (!nm) continue;
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      if (norm(nm).includes(norm(q))) {
        const cur = found.get(a.puuid);
        if (cur) cur.games = Math.max(cur.games, a.games);
        else
          found.set(a.puuid, {
            puuid: a.puuid,
            name: nm,
            source: `本地归档（${kind === "lol" ? "海斗/英雄联盟" : "云顶"}，${a.games} 局）`,
            games: a.games,
          });
      }
    }
  }

  return {
    matches: [...found.values()].sort((a, b) => b.games - a.games),
    clientOnline: status.reachable,
    note: status.reachable
      ? "已在客户端好友列表与本地归档里查找"
      : "客户端没开：只在本地归档里查找（归档里的账号 = 以前查过的账号）",
  };
}

/** 所有归档里出现过的账号（给「离线时能查谁」用） */
export async function archivedAccounts(): Promise<AccountMatch[]> {
  const out = new Map<string, AccountMatch>();
  for (const kind of ["lol", "tft"] as const) {
    const st = await archiveStats(kind);
    for (const a of st.accounts) {
      const cur = out.get(a.puuid);
      if (cur) cur.games += a.games;
      else out.set(a.puuid, { puuid: a.puuid, name: a.name ?? "(未记录名字)", source: kind, games: a.games });
    }
  }
  return [...out.values()].sort((a, b) => b.games - a.games);
}
