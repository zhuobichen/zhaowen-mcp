/**
 * 队友 / 对手分析。
 *
 * 数据来源：SGP 的对局记录带**全部 10 个参与者**（含 puuid 与显示名），
 * 所以可以统计「和谁一起打、胜率如何」「遇到过谁、对他们胜率如何」。
 * 本地客户端（LCU）只给自己的那一行，那类对局没有队友数据 —— 这里会如实标注覆盖率。
 *
 * 只读，不涉及任何写操作。
 */
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";

export interface CoPlayer {
  puuid: string;
  name: string;
  /** 一起打（同队）的局数 */
  games: number;
  /** 其中赢的局数 */
  wins: number;
  winRate: number;
  /** 最近一次同队时间 */
  lastSeen: number;
  /** 同队时用的英雄（出现最多的几个） */
  champions?: string[];
}

export interface SocialReport {
  name: string;
  games: number;
  /** 有完整 10 人数据的局数（只有自己那行的对局无法统计队友） */
  gamesWithFullRoster: number;
  teammates: CoPlayer[];
  opponents: CoPlayer[];
  note: string;
}

function rank(entries: CoPlayer[], minGames: number, sortBy: "games" | "winRate"): CoPlayer[] {
  const filtered = entries.filter((e) => e.games >= minGames);
  return sortBy === "games"
    ? filtered.sort((a, b) => b.games - a.games || b.winRate - a.winRate)
    : filtered.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

export async function analyzeSocial(
  opts: { who?: string; games?: number; minGames?: number; puuid?: string; name?: string } = {}
): Promise<SocialReport> {
  // 查谁：默认自己；给了名字就先解析成 puuid
  let puuid: string | null = null;
  let name = "";
  if (opts.puuid) {
    // 调用方（例如报告）已经解析好了身份，直接用 —— 避免按名字再解析一次解析错人
    puuid = opts.puuid;
    name = opts.name ?? "";
  } else if (opts.who) {
    const r = await resolveAccountByName(opts.who);
    if (!r.matches.length) throw new Error(`没找到「${opts.who}」——${r.note}`);
    puuid = r.matches[0].puuid;
    name = r.matches[0].name;
  } else {
    const me = await resolveMe();
    if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");
    puuid = me.puuid;
    name = me.name;
  }

  const res = await loadLolGames(puuid, opts.games ?? 2000, name);
  const all = res.games.filter(isMayhemGame);

  const mates = new Map<string, CoPlayer>();
  const opps = new Map<string, CoPlayer>();
  let fullRoster = 0;

  for (const g of all) {
    const parts = g.participants ?? [];
    if (parts.length < 2) continue; // LCU 那种只有自己一行的，统计不了
    fullRoster++;
    const mePart = parts.find((p: any) => p.puuid === puuid);
    if (!mePart) continue;
    const myTeam = mePart.teamId;
    const win = mePart.stats?.win === true;
    for (const p of parts) {
      if (!p.puuid || p.puuid === puuid) continue;
      const target = p.teamId === myTeam ? mates : opps;
      const cur =
        target.get(p.puuid) ??
        ({ puuid: p.puuid, name: p.summonerName ?? p.name ?? "（未知名字）", games: 0, wins: 0, winRate: 0, lastSeen: 0 } as CoPlayer);
      cur.games++;
      if (win) cur.wins++;
      cur.lastSeen = Math.max(cur.lastSeen, g.gameCreation ?? 0);
      if (!cur.name || cur.name === "（未知名字）") cur.name = p.summonerName ?? p.name ?? cur.name;
      target.set(p.puuid, cur);
    }
  }
  for (const map of [mates, opps]) {
    for (const v of map.values()) v.winRate = v.games ? (v.wins / v.games) * 100 : 0;
  }

  return {
    name,
    games: all.length,
    gamesWithFullRoster: fullRoster,
    teammates: rank([...mates.values()], opts.minGames ?? 1, "games"),
    opponents: rank([...opps.values()], opts.minGames ?? 1, "games"),
    note:
      `${all.length} 把海斗里，${fullRoster} 把有完整 10 人数据可分析队友/对手` +
      (fullRoster < all.length ? `（其余 ${all.length - fullRoster} 把来自本地客户端，只记录了自己那一行）` : ""),
  };
}

/** 给人看的文本报告 */
export async function socialText(opts: { who?: string; games?: number; minGames?: number } = {}): Promise<string> {
  let r: SocialReport;
  try {
    r = await analyzeSocial(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const fmtDate = (t: number) => (t ? new Date(t).toLocaleDateString("zh-CN") : "—");
  const out: string[] = [];
  out.push(`${r.name} · 队友与对手分析`);
  out.push(r.note);
  out.push("");

  const minGames = opts.minGames ?? 3;
  const mates = r.teammates.filter((m) => m.games >= minGames);
  out.push(`最常一起打的人（同队 ≥${minGames} 局，共 ${mates.length} 人）：`);
  for (const m of mates.slice(0, 12)) {
    out.push(
      `  · ${m.name}：同队 ${m.games} 局 · 共同胜率 ${m.winRate.toFixed(0)}%（${m.wins} 胜）· 最近 ${fmtDate(m.lastSeen)}`
    );
  }
  if (!mates.length) out.push("  （没有同队 ≥3 局的玩家）");

  const good = rank(mates.map((x) => ({ ...x })), Math.max(5, minGames), "winRate").slice(0, 5);
  if (good.length) {
    out.push("", `和这些人一起打最稳（≥5 局，按共同胜率）：`);
    for (const m of good) out.push(`  · ${m.name}：${m.games} 局 ${m.winRate.toFixed(0)}%`);
  }

  // 对手：海斗匹配随机性高，往往没有稳定对手 —— 如实说明，不硬凑样本
  const opps = r.opponents;
  const maxOpp = opps.length ? opps[0].games : 0;
  out.push("", `对手情况：共遇到 ${opps.length} 个不同对手，重复最多 ${maxOpp} 次`);
  if (maxOpp >= minGames) {
    out.push(`  反复遇到的（≥${minGames} 次）：`);
    for (const o of opps.filter((x) => x.games >= minGames).slice(0, 10)) {
      out.push(`    · ${o.name}：${o.games} 次 · 你对他们所在队的胜率 ${o.winRate.toFixed(0)}%`);
    }
  } else {
    out.push("  没有重复 ≥3 次的对手 —— 海斗匹配池很大，随机性强，这个维度没有可分析的稳定对手。");
    out.push(`  （遇到过的人里次数最多的：${opps.slice(0, 5).map((o) => `${o.name} ${o.games} 次`).join("、")}）`);
  }

  out.push("", "说明：同队/对手关系取自每局的 10 人名单（SGP 提供）；样本 <3 次的不列出。");
  return out.join("\n");
}
