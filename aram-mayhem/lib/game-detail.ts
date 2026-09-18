/**
 * 单局详情（复盘用）。
 *
 * 前面那些工具全是聚合统计 —— 能回答「我亚索打得怎么样」，但回答不了
 * 「9 月 17 号那把亚索到底发生了什么」。这个模块补上这一环：
 * 给一局对局，把 10 个人摊开，再把这一局放回你自己的历史里做对照。
 *
 * 找哪一局：最近第 N 把 / 按日期 / 按英雄名 / 直接给 gameId。
 *
 * 只读；数据来自归档 ∪ 实时取数。符文只有 SGP 来源的记录才有（LCU 摘要格式没有）。
 */
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export interface DetailPlayer {
  name: string;
  champion: string;
  teamId: number;
  win: boolean | null;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  gold: number;
  cs: number;
  items: string[];
  augments: string[];
  /** 全场伤害排名（1 = 最高） */
  damageRank: number | null;
  isMe: boolean;
}

export interface GameDetail {
  gameId: number;
  when: number;
  queueId: number;
  durationMin: number;
  patch: string | null;
  /** 能不能看到全部 10 人（LCU 来源只有自己那一行） */
  fullRoster: boolean;
  myTeamId: number | null;
  me: DetailPlayer | null;
  myTeam: DetailPlayer[];
  enemyTeam: DetailPlayer[];
  /** 两队合计伤害 */
  teamDamage: { mine: number; theirs: number } | null;
  /** 我的符文在归档里的实证胜率，用来对照「这局拿的符文强不强」 */
  augmentContext: Array<{ name: string; games: number | null; winRate: number | null }>;
  note: string;
}

function patchOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,4}\.\d{1,2})(?:\.|$)/.exec(v.trim());
  return m ? m[1] : null;
}

export async function gameDetail(
  opts: { which?: string; index?: number; who?: string; puuid?: string; name?: string } = {}
): Promise<GameDetail> {
  const d = loadData();
  let puuid: string;
  let name: string;
  if (opts.puuid) {
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

  const res = await loadLolGames(puuid, 2000, name);
  // 时间倒序（最近的在最前）便于按 index 取
  const games = res.games
    .filter(isMayhemGame)
    .slice()
    .sort((a: any, b: any) => (b.gameCreation ?? 0) - (a.gameCreation ?? 0));

  if (!games.length) throw new Error("没有可用的海斗对局（归档为空且这次也没读到）。");

  // 选局：gameId / 日期 / 英雄名 / 最近第 N 把
  let target: any = null;
  const which = opts.which?.trim();
  if (which) {
    if (/^\d{6,}$/.test(which)) {
      target = games.find((g: any) => String(g.gameId) === which) ?? null;
      if (!target) throw new Error(`归档里没有 gameId=${which} 这局。`);
    } else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(which)) {
      const [y, m, dd] = which.split(/[-/]/).map(Number);
      const matches = games.filter((g: any) => {
        const t = new Date(g.gameCreation ?? 0);
        return t.getFullYear() === y && t.getMonth() + 1 === m && t.getDate() === dd;
      });
      if (!matches.length) throw new Error(`归档里没有 ${which} 的海斗对局。`);
      if (matches.length > 1) {
        // 一天多把：列出让调用方挑
        const list = matches
          .map((g: any, i: number) => {
            const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
            const cid = d.championIds[String(p?.championId)];
            const cn = cid ? d.championById.get(cid.id)?.name ?? cid.name : `英雄#${p?.championId}`;
            const s: any = p?.stats ?? {};
            return `  ${i + 1}. ${new Date(g.gameCreation).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })} ${cn} ${s.win ? "胜" : "负"}`;
          })
          .join("\n");
        throw new Error(`${which} 有 ${matches.length} 把海斗，用 gameId 指定其中一把：\n${list}`);
      }
      target = matches[0];
    } else {
      // 按英雄名（部分匹配）
      const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();
      const matches = games.filter((g: any) => {
        const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
        const cid = d.championIds[String(p?.championId)];
        const cn = cid ? d.championById.get(cid.id)?.name ?? cid.name : "";
        return norm(cn).includes(norm(which));
      });
      if (!matches.length) throw new Error(`最近的归档里没有你玩「${which}」的海斗对局。`);
      const list = matches
        .slice(0, 8)
        .map((g: any) => {
          const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
          const s: any = p?.stats ?? {};
          return `  · ${new Date(g.gameCreation).toLocaleString("zh-CN", { hour12: false })} ${s.win ? "胜" : "负"}（gameId ${g.gameId}）`;
        })
        .join("\n");
      if (matches.length > 1) {
        throw new Error(`你玩过 ${matches.length} 把「${which}」，最近的几把：\n${list}\n用 gameId 或日期指定具体哪一把。`);
      }
      target = matches[0];
    }
  } else {
    // 越界要报错，不能静默夹到边界 —— 那会让人以为「第 999 把」存在，
    // 实际拿到的是最老的一局，看半天不知道错在哪。
    const idx = opts.index ?? 1;
    if (!Number.isFinite(idx) || idx < 1 || idx > games.length) {
      throw new Error(
        `没有第 ${idx} 把 —— 当前归档里有 ${games.length} 把海斗（index 从 1 开始，1 = 最近一把）。`
      );
    }
    target = games[Math.floor(idx) - 1];
  }

  const parts: any[] = target.participants ?? [];
  const fullRoster = parts.length >= 4;
  const mePart = parts.find((p: any) => p.puuid === puuid) ?? null;
  const myTeamId = mePart ? Number(mePart.teamId ?? 0) : null;

  const dmgOf = (s: any) => Number(s?.totalDamageDealtToChampions ?? 0);
  const allDamages = parts.map((p) => dmgOf(p.stats)).sort((a, b) => b - a);

  const toPlayer = (p: any): DetailPlayer => {
    const s: any = p.stats ?? {};
    const cid = d.championIds[String(p.championId)];
    const myDmg = dmgOf(s);
    return {
      name: p.summonerName ?? p.name ?? "（未知）",
      champion: cid ? d.championById.get(cid.id)?.name ?? cid.name : p.championId ? `英雄#${p.championId}` : "—",
      teamId: Number(p.teamId ?? 0),
      win: s.win === undefined ? null : s.win === true,
      kills: Number(s.kills ?? 0),
      deaths: Number(s.deaths ?? 0),
      assists: Number(s.assists ?? 0),
      damage: myDmg,
      gold: Number(s.goldEarned ?? 0),
      cs: Number(s.totalMinionsKilled ?? 0),
      items: [0, 1, 2, 3, 4, 5]
        .map((i) => Number(s[`item${i}`] ?? 0))
        .filter(Boolean)
        .map((id) => d.items[String(id)]?.name ?? `#${id}`),
      augments: [1, 2, 3, 4, 5, 6]
        .map((i) => Number(s[`playerAugment${i}`] ?? 0))
        .filter(Boolean)
        .map((id) => d.augments.find((a) => a.officialId === id)?.name ?? `未知符文#${id}`),
      damageRank: allDamages.indexOf(myDmg) + 1 || null,
      isMe: p.puuid === puuid,
    };
  };

  const players = parts.map(toPlayer);
  const myTeam = myTeamId == null ? [] : players.filter((p) => p.teamId === myTeamId);
  const enemyTeam = myTeamId == null ? [] : players.filter((p) => p.teamId !== myTeamId);
  const sum = (list: DetailPlayer[]) => list.reduce((s2, p) => s2 + p.damage, 0);

  const me = players.find((p) => p.isMe) ?? null;

  // 我的符文在归档里的实证表现（对照「这局拿的符文强不强」）
  let augmentContext: GameDetail["augmentContext"] = [];
  if (me?.augments.length) {
    try {
      const { empiricalAugments } = await import("./empirical.js");
      const e = await empiricalAugments({ minGames: 100 });
      const byName = new Map(e.augments.map((a) => [a.name, a]));
      augmentContext = me.augments.map((n) => {
        const hit = byName.get(n);
        return { name: n, games: hit?.games ?? null, winRate: hit?.winRate ?? null };
      });
    } catch {
      /* 归档为空就不给对照，不留空话 */
    }
  }

  return {
    gameId: Number(target.gameId),
    when: Number(target.gameCreation ?? 0),
    queueId: Number(target.queueId ?? 0),
    durationMin: Math.round(Number(target.gameDuration ?? 0) / 60),
    patch: patchOf((target as any).gameVersion),
    fullRoster,
    myTeamId,
    me,
    myTeam,
    enemyTeam,
    teamDamage: fullRoster ? { mine: sum(myTeam), theirs: sum(enemyTeam) } : null,
    augmentContext,
    note: fullRoster
      ? `这局记录了全部 ${parts.length} 个参与者。`
      : `⚠ 这局来自本地客户端的摘要格式，只记录了你自己的那一行（${parts.length} 行），看不到其他 9 人。` +
        "想要完整 10 人，需要在有 SGP 长历史的情况下重新同步这一局。",
  };
}

/** 文本输出 */
export async function gameDetailText(
  opts: { which?: string; index?: number; who?: string } = {}
): Promise<string> {
  let r: GameDetail;
  try {
    r = await gameDetail(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const fmt = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false });
  const out: string[] = [];
  out.push(`=== 单局详情 · gameId ${r.gameId} ===`);
  out.push(
    `${fmt(r.when)} · ${r.durationMin} 分` + (r.patch ? ` · 客户端版本 ${r.patch}` : " · 版本未知")
  );
  out.push(r.note);
  out.push("");

  const fmtPlayer = (p: DetailPlayer) =>
    `  ${p.isMe ? "→ " : "  "}${p.champion.padEnd(10, "　")} ` +
    `${String(p.kills).padStart(2)}/${String(p.deaths).padStart(2)}/${String(p.assists).padStart(2)} · ` +
    `伤害 ${Math.round(p.damage / 1000).toString().padStart(3)}k · 金币 ${Math.round(p.gold / 1000).toString().padStart(2)}k · ` +
    `补刀 ${String(p.cs).padStart(3)}`;

  if (r.fullRoster) {
    out.push(`我方（${r.myTeam.filter((p) => p.win).length ? "胜" : "负"}）：`);
    for (const p of [...r.myTeam].sort((a, b) => b.damage - a.damage)) out.push(fmtPlayer(p));
    out.push("", "对方：");
    for (const p of [...r.enemyTeam].sort((a, b) => b.damage - a.damage)) out.push(fmtPlayer(p));
    if (r.teamDamage) {
      const { mine, theirs } = r.teamDamage;
      out.push(
        "",
        `两队总伤害：我方 ${Math.round(mine / 1000)}k vs 对方 ${Math.round(theirs / 1000)}k` +
          `（${mine >= theirs ? "我方高" : "对方高"} ${Math.abs(Math.round((mine - theirs) / 1000))}k）`
      );
    }
  } else {
    for (const p of r.myTeam.length ? r.myTeam : r.enemyTeam.length ? r.enemyTeam : []) out.push(fmtPlayer(p));
  }

  if (r.me) {
    out.push(
      "",
      `我这局：${r.me.champion} · ${r.me.kills}/${r.me.deaths}/${r.me.assists} · ` +
        `伤害 ${Math.round(r.me.damage / 1000)}k（全场第 ${r.me.damageRank} 名）· ` +
        (r.me.items.length ? `装备 ${r.me.items.join(" + ")}` : "没有读到装备")
    );
    if (r.me.augments.length) {
      out.push("  这局拿到的符文：");
      for (const a of r.augmentContext) {
        out.push(
          `    · ${a.name}` +
            (a.games != null && a.winRate != null
              ? `（本机实证：${a.games} 次 ${a.winRate.toFixed(1)}%）`
              : "（归档里样本不足，无实证）")
        );
      }
    }
  }
  return out.join("\n");
}
