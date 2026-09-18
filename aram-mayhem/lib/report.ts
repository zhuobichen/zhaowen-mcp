/**
 * 个人海斗战绩报告（单文件 HTML，离线，内联 SVG 图表）。
 *
 * 用法：
 *   npx tsx lib/report.ts            # 输出到 reports/海斗战绩报告-<账号>-<日期>.html
 *   npx tsx lib/report.ts --out x.html
 *   npx tsx lib/report.ts --games 198
 *
 * 数据来源：本机客户端的对局记录（puuid 路径，最多最近 200 场）。
 * 边界会在报告页脚如实写明：不是生涯总场次、单个符文样本小、LCU 只读。
 *
 * 配色取自项目内置的可视化基线（已用校验脚本跑过 CVD/对比度检查）：
 *   分类色 浅色 #2a78d6 / #eb6834，深色 #3987e5 / #d95926
 *   背离色 蓝 #2a78d6 ↔ 红 #e34948（浅）/ #3987e5 ↔ #e66767（深），中位灰
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLolGames } from "./games.js";
import { resolveMe } from "./identity.js";
import { augmentIdsOf, isMayhemGame, myParticipantId } from "./lcu.js";
import { REPORT_CSS, reflowFigures } from "./report-style.js";
import { loadData } from "./store.js";
import { parsePatch } from "./sgp.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface Row {
  t: number;
  multi?: { double: number; triple: number; quadra: number; penta: number };
  win: boolean;
  champ: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  gold: number;
  durationMin: number;
  augments: number[];
}

interface Bucket {
  name: string;
  games: number;
  wins: number;
  winRate: number;
}

const pctNum = (w: number, g: number) => (g ? (w / g) * 100 : 0);
const fmtPct = (v: number, d = 1) => `${v.toFixed(d)}%`;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// ---------------------------------------------------------------- 数据

async function collect(gamesLimit: number, who?: { puuid: string; name: string }) {
  const d = loadData();
  const me = who ?? (await resolveMe());
  if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status，或打开客户端。");
  const name = me.name;
  const res = await loadLolGames(me.puuid, gamesLimit, name);
  const all = res.games;
  const total = res.archivedTotal;
  const dataNote = res.note;
  const pidOf = (g: any) => myParticipantId(g, { puuid: me.puuid, name: name.split("#")[0] });

  const rows: Row[] = all
    .filter(isMayhemGame)
    .map((g) => {
      const pid = pidOf(g);
      const p = (g.participants ?? []).find((x: any) => x.participantId === pid) ?? (g.participants ?? [])[0];
      const s: any = p?.stats ?? {};
      const multi = {
        double: Number(s.doubleKills ?? 0),
        triple: Number(s.tripleKills ?? 0),
        quadra: Number(s.quadraKills ?? 0),
        penta: Number(s.pentaKills ?? 0),
      };
      const cid = d.championIds[String(p?.championId)];
      return {
        t: g.gameCreation,
        win: s.win === true,
        champ: cid ? d.championById.get(cid.id)?.name ?? cid.name : `英雄#${p?.championId}`,
        kills: s.kills ?? 0,
        deaths: s.deaths ?? 0,
        assists: s.assists ?? 0,
        damage: s.totalDamageDealtToChampions ?? 0,
        gold: s.goldEarned ?? 0,
        durationMin: Math.round((g.gameDuration ?? 0) / 60),
        augments: augmentIdsOf(g, pid),
        multi,
      };
    })
    .sort((a, b) => a.t - b.t); // 从早到晚

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const avg = (f: (r: Row) => number) => (n ? rows.reduce((s, r) => s + f(r), 0) / n : 0);

  // 连胜 / 连败
  let longestWin = 0,
    longestLoss = 0,
    cw = 0,
    cl = 0;
  for (const r of rows) {
    if (r.win) {
      cw++;
      cl = 0;
    } else {
      cl++;
      cw = 0;
    }
    longestWin = Math.max(longestWin, cw);
    longestLoss = Math.max(longestLoss, cl);
  }

  // 滚动 20 把胜率（前 20 把用累计）
  const WINDOW = 20;
  const rolling = rows.map((_, i) => {
    const from = Math.max(0, i - WINDOW + 1);
    const slice = rows.slice(from, i + 1);
    const w = slice.filter((r) => r.win).length;
    return { i: i + 1, t: rows[i].t, wr: pctNum(w, slice.length) };
  });

  const bucket = (key: (r: Row) => string, min: number): Bucket[] => {
    const m = new Map<string, { g: number; w: number }>();
    for (const r of rows) {
      const k = key(r);
      const c = m.get(k) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      m.set(k, c);
    }
    return [...m.entries()]
      .filter(([, v]) => v.g >= min)
      .map(([k, v]) => ({ name: k, games: v.g, wins: v.w, winRate: pctNum(v.w, v.g) }));
  };

  const champions = bucket((r) => r.champ, 5).sort((a, b) => b.games - a.games);

  const augStat = new Map<number, { g: number; w: number }>();
  for (const r of rows) {
    for (const id of r.augments) {
      const c = augStat.get(id) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      augStat.set(id, c);
    }
  }
  // 「其他人」基线：把同批对局里别人的行单独统计（剔掉我自己），
  // 于是能看到「我打不好的符文是不是大家都打不好」——比拿全服统计比更干净。
  let others = new Map<number, { games: number; winRate: number }>();
  try {
    const { othersAugmentRates } = await import("./empirical.js");
    others = await othersAugmentRates(me.puuid, { minGames: 30 });
  } catch {
    /* 归档为空就拿不到，图层会少一列参照，不编数字 */
  }

  const augments = [...augStat.entries()]
    .filter(([, v]) => v.g >= 8)
    .map(([id, v]) => {
      const a = d.augments.find((x) => x.officialId === id);
      const versionWr = a?.stats?.winRate ? Number(String(a.stats.winRate).replace("%", "")) : null;
      return {
        name: a?.name ?? `未知#${id}`,
        games: v.g,
        wins: v.w,
        winRate: pctNum(v.w, v.g),
        versionWr,
        versionRank: a?.stats?.rank ?? null,
        /** 同批对局里其他人拿同一个符文的胜率（%），样本不足时为 null */
        othersWr: others.get(id)?.winRate ?? null,
        othersGames: others.get(id)?.games ?? null,
        rarity: a?.rarity ?? "unknown",
        availability: a?.availability ?? "unknown",
      };
    })
    .sort((a, b) => b.games - a.games);

  const champCounts = new Map<string, number>();
  for (const r of rows) champCounts.set(r.champ, (champCounts.get(r.champ) ?? 0) + 1);

  // 按月汇总（看整体走势是被哪几个月拖下来的）
  const monthMap = new Map<string, { g: number; w: number }>();
  for (const r of rows) {
    const k = new Date(r.t).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit" });
    const c = monthMap.get(k) ?? { g: 0, w: 0 };
    c.g++;
    if (r.win) c.w++;
    monthMap.set(k, c);
  }
  const months = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, v]) => ({ label, games: v.g, wins: v.w, winRate: pctNum(v.w, v.g) }));

  // 周趋势（自然周，周一起算）：柱=场次、线=胜率，一眼看出「打得多的那几周赢不赢」
  const weekMap = new Map<number, { g: number; w: number }>();
  for (const r of rows) {
    const dd = new Date(r.t);
    dd.setHours(0, 0, 0, 0);
    dd.setDate(dd.getDate() - ((dd.getDay() + 6) % 7)); // 周一
    const key = dd.getTime();
    const c = weekMap.get(key) ?? { g: 0, w: 0 };
    c.g++;
    if (r.win) c.w++;
    weekMap.set(key, c);
  }
  const weekly = [...weekMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, games: v.g, wins: v.w, winRate: pctNum(v.w, v.g) }));

  // 按补丁聚合（gameVersion 前两段；LCU 来源的局没有这个字段，归到「版本未知」）
  // 注意游戏写的是客户端版本（16.18），玩家说的是赛季号（26.18），差 10
  const patchMap = new Map<string, { g: number; w: number }>();
  let noPatch = 0;
  for (const g of all.filter(isMayhemGame)) {
    if (!g.gameCreation) continue;
    const pat = parsePatch((g as any).gameVersion);
    if (!pat) {
      noPatch++;
      continue;
    }
    const c = patchMap.get(pat) ?? { g: 0, w: 0 };
    c.g++;
    // 这一局我赢没赢：从 participants 里找自己
    const pid = pidOf(g);
    const p = (g.participants ?? []).find((x: any) => x.participantId === pid) ?? (g.participants ?? [])[0];
    if ((p?.stats as any)?.win === true) c.w++;
    patchMap.set(pat, c);
  }
  const verKey = (v: string) => {
    const [a, b] = v.split(".").map(Number);
    return a * 1000 + b;
  };
  const patches = [...patchMap.entries()]
    .sort((a, b) => verKey(a[0]) - verKey(b[0]))
    .map(([v, c]) => ({
      patch: v,
      playerPatch: `${Number(v.split(".")[0]) + 10}.${v.split(".")[1]}`,
      games: c.g,
      wins: c.w,
      winRate: pctNum(c.w, c.g),
    }));

  // 连败段（≥4 连败），在走势图上标出来
  const streaks: Array<{ startIdx: number; endIdx: number; len: number }> = [];
  let cur = 0;
  let start = 0;
  rows.forEach((r, i) => {
    if (!r.win) {
      if (cur === 0) start = i;
      cur++;
    } else {
      if (cur >= 4) streaks.push({ startIdx: start + 1, endIdx: i, len: cur });
      cur = 0;
    }
  });
  if (cur >= 4) streaks.push({ startIdx: start + 1, endIdx: rows.length, len: cur });

  // 英雄 × 符文 交叉（≥4 把）：哪些搭配真的赢
  const pairMap = new Map<string, { champ: string; aug: string; g: number; w: number }>();
  for (const r of rows) {
    for (const id of r.augments) {
      const a = d.augments.find((x) => x.officialId === id);
      if (!a) continue;
      const key = `${r.champ}||${a.id}`;
      const c = pairMap.get(key) ?? { champ: r.champ, aug: a.name, g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      pairMap.set(key, c);
    }
  }
  // 出装（≥8 次）
  let buildItems: Array<{ name: string; price: number; games: number; wins: number; winRate: number }> = [];
  try {
    const { analyzeBuilds } = await import("./builds.js");
    buildItems = (await analyzeBuilds({ games: 2000, minGames: 8, puuid: me.puuid, name })).items;
  } catch {
    /* 拿不到就略过 */
  }

  // 队友（同队 ≥3 局）
  let teammates: Array<{ name: string; games: number; winRate: number; lastSeen: number }> = [];
  let opponents: Array<{ name: string; games: number; winRate: number; lastSeen: number }> = [];
  try {
    const { analyzeSocial } = await import("./social.js");
    // 必须把报告对象传下去：不传的话这几个子分析会去查「当前登录账号」，
    // 于是好友的报告里会混进你自己的队友/对位数据。
    const soc = await analyzeSocial({ games: 2000, puuid: me.puuid, name });
    teammates = soc.teammates.filter((m) => m.games >= 3).map((m) => ({
      name: m.name,
      games: m.games,
      winRate: m.winRate,
      lastSeen: m.lastSeen,
    }));
    opponents = soc.opponents.map((o) => ({ name: o.name, games: o.games, winRate: o.winRate, lastSeen: o.lastSeen }));
  } catch {
    /* 拿不到就略过这一节 */
  }

  const pairs = [...pairMap.values()]
    .filter((p) => p.g >= 4)
    .map((p) => ({ ...p, winRate: pctNum(p.w, p.g) }))
    .sort((a, b) => b.g - a.g || b.winRate - a.winRate);

  // 对位（对面英雄视角）
  let matchups: {
    baseWinRate: number;
    worst: Array<{ champion: string; games: number; winRate: number; delta: number; championWinRate: number | null; residual: number | null }>;
    best: Array<{ champion: string; games: number; winRate: number; delta: number; championWinRate: number | null; residual: number | null }>;
  } = { baseWinRate: 0, worst: [], best: [] };
  try {
    const { analyzeMatchups } = await import("./matchups.js");
    const mu = await analyzeMatchups({ games: 2000, minGames: 12, puuid: me.puuid, name });
    const slim = (v: any) => ({
      champion: v.champion,
      games: v.games,
      winRate: v.winRate,
      delta: v.delta,
      championWinRate: v.championWinRate,
      residual: v.residual,
    });
    matchups = {
      baseWinRate: mu.baseWinRate,
      worst: mu.versusAll.slice(0, 8).map(slim),
      best: [...mu.versusAll]
        .sort((a, b) => (b.residual ?? b.delta) - (a.residual ?? a.delta) || b.games - a.games)
        .slice(0, 8)
        .map(slim),
    };
  } catch {
    /* 拿不到就略过这一节 */
  }

  return {
    name,
    cachedTotal: total,
    dataNote,
    rows,
    rolling,
    champions,
    augments,
    months,
    weekly,
    patches,
    noPatch,
    streaks,
    pairs,
    teammates,
    opponents,
    buildItems,
    matchups,
    overview: {
      games: n,
      wins,
      winRate: pctNum(wins, n),
      from: rows[0]?.t ?? null,
      to: rows[n - 1]?.t ?? null,
      kda: (avg((r) => r.kills) + avg((r) => r.assists)) / Math.max(avg((r) => r.deaths), 0.1),
      kills: avg((r) => r.kills),
      deaths: avg((r) => r.deaths),
      assists: avg((r) => r.assists),
      damage: avg((r) => r.damage),
      gold: avg((r) => r.gold),
      duration: avg((r) => r.durationMin),
      longestWin,
      longestLoss,
      last20: (() => {
        const s = rows.slice(-20);
        return { games: s.length, wins: s.filter((r) => r.win).length };
      })(),
      championCount: champCounts.size,
      oneGameChampions: [...champCounts.values()].filter((c) => c === 1).length,
      avgAugments: n ? rows.reduce((s, r) => s + r.augments.length, 0) / n : 0,
      double: rows.reduce((s, r) => s + (r.multi?.double ?? 0), 0),
      triple: rows.reduce((s, r) => s + (r.multi?.triple ?? 0), 0),
      quadra: rows.reduce((s, r) => s + (r.multi?.quadra ?? 0), 0),
      penta: rows.reduce((s, r) => s + (r.multi?.penta ?? 0), 0),
    },
  };
}


/**
 * 演示数据：客户端没开、归档也空的时候，用来自查排版与图表（页脚会标明是演示数据）。
 * 生成的数据刻意包含：连续 8 个月、几段连败、若干「版本强但打不出效果」的符文。
 */
function demoData() {
  const d = loadData();
  const augs = d.augments.filter((a) => a.stats?.rank && a.availability === "live").slice(0, 40);
  const champs = d.champions.slice(0, 24);
  const rows: Row[] = [];
  let t = Date.UTC(2026, 0, 20);
  let streak = 0;
  for (let i = 0; i < 260; i++) {
    t += (2 + (i % 5)) * 3600 * 1000;
    // 造几段低谷：第 90~100、170~182 把
    const bad = (i >= 90 && i <= 100) || (i >= 170 && i <= 182);
    const win = bad ? Math.random() < 0.2 : Math.random() < 0.55;
    streak = win ? 0 : streak + 1;
    const champ = champs[i % champs.length];
    const uses = [augs[i % augs.length], augs[(i * 7) % augs.length], augs[(i * 13) % augs.length]]
      .filter(Boolean)
      .map((a) => a.officialId as number);
    rows.push({
      t,
      win,
      champ: champ.name,
      kills: Math.round(8 + Math.random() * 10),
      deaths: Math.round(6 + Math.random() * 8),
      assists: Math.round(15 + Math.random() * 20),
      damage: Math.round(28000 + Math.random() * 30000),
      gold: Math.round(12000 + Math.random() * 9000),
      durationMin: Math.round(13 + Math.random() * 10),
      augments: uses,
      streak: streak,
    } as Row);
  }
  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const avg = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
  const bucket = (key: (r: Row) => string, min: number): Bucket[] => {
    const m = new Map<string, { g: number; w: number }>();
    for (const r of rows) {
      const k = key(r);
      const c = m.get(k) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      m.set(k, c);
    }
    return [...m.entries()].filter(([, v]) => v.g >= min).map(([k, v]) => ({ name: k, games: v.g, wins: v.w, winRate: pctNum(v.w, v.g) }));
  };
  const rolling = rows.map((_, i) => {
    const slice = rows.slice(Math.max(0, i - 19), i + 1);
    return { i: i + 1, t: rows[i].t, wr: pctNum(slice.filter((r) => r.win).length, slice.length) };
  });
  const streaks: Array<{ startIdx: number; endIdx: number; len: number }> = [];
  let cur = 0;
  let start = 0;
  rows.forEach((r, i) => {
    if (!r.win) {
      if (cur === 0) start = i;
      cur++;
    } else {
      if (cur >= 4) streaks.push({ startIdx: start + 1, endIdx: i, len: cur });
      cur = 0;
    }
  });
  if (cur >= 4) streaks.push({ startIdx: start + 1, endIdx: rows.length, len: cur });
  const monthMap = new Map<string, { g: number; w: number }>();
  for (const r of rows) {
    const k = new Date(r.t).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit" });
    const c = monthMap.get(k) ?? { g: 0, w: 0 };
    c.g++;
    if (r.win) c.w++;
    monthMap.set(k, c);
  }
  const months = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, v]) => ({ label, games: v.g, wins: v.w, winRate: pctNum(v.w, v.g) }));
  const augStat = new Map<number, { g: number; w: number }>();
  const pairMap = new Map<string, { champ: string; aug: string; g: number; w: number }>();
  for (const r of rows) {
    for (const id of r.augments) {
      const c = augStat.get(id) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      augStat.set(id, c);
      const a = d.augments.find((x) => x.officialId === id);
      if (a) {
        const key = `${r.champ}||${a.id}`;
        const pc = pairMap.get(key) ?? { champ: r.champ, aug: a.name, g: 0, w: 0 };
        pc.g++;
        if (r.win) pc.w++;
        pairMap.set(key, pc);
      }
    }
  }
  const augments = [...augStat.entries()]
    .filter(([, v]) => v.g >= 8)
    .map(([id, v]) => {
      const a = d.augments.find((x) => x.officialId === id);
      return {
        name: a?.name ?? `未知#${id}`,
        games: v.g,
        wins: v.w,
        winRate: pctNum(v.w, v.g),
        versionWr: a?.stats?.winRate ? Number(String(a.stats.winRate).replace("%", "")) : null,
        versionRank: a?.stats?.rank ?? null,
        othersWr: null as number | null,
        othersGames: null as number | null,
        rarity: a?.rarity ?? "unknown",
        availability: a?.availability ?? "unknown",
      };
    })
    .sort((a, b) => b.games - a.games);
  const champCounts = new Map<string, number>();
  for (const r of rows) champCounts.set(r.champ, (champCounts.get(r.champ) ?? 0) + 1);
  let lw = 0,
    ll = 0,
    cw = 0,
    cl = 0;
  for (const r of rows) {
    if (r.win) {
      cw++;
      cl = 0;
    } else {
      cl++;
      cw = 0;
    }
    lw = Math.max(lw, cw);
    ll = Math.max(ll, cl);
  }
  const last20 = rows.slice(-20);
  // 演示周趋势：按 7 天切块（真实数据是按自然周聚合的）
  const weeklyDemo = Array.from({ length: Math.ceil(rows.length / 7) }, (_, i) => {
    const chunk = rows.slice(i * 7, i * 7 + 7);
    const w = chunk.filter((r) => r.win).length;
    return { t: chunk[0].t, games: chunk.length, wins: w, winRate: pctNum(w, chunk.length) };
  }).filter((x) => x.games > 0);
  return {
    name: "（演示数据）",
    cachedTotal: n,
    dataNote: "⚠ 这是 --demo 生成的演示数据，不是真实战绩",
    rows,
    rolling,
    champions: bucket((r) => r.champ, 5).sort((a, b) => b.games - a.games),
    augments,
    months,
    weekly: weeklyDemo,
    // 演示补丁（真实数据来自对局记录的 gameVersion）
    patches: [
      { patch: "16.1", playerPatch: "26.1", games: 40, wins: 24, winRate: 60 },
      { patch: "16.2", playerPatch: "26.2", games: 55, wins: 28, winRate: 50.9 },
      { patch: "16.3", playerPatch: "26.3", games: 48, wins: 22, winRate: 45.8 },
    ],
    noPatch: 0,
    streaks,
    // 演示队友（真实数据来自 social.js）
    opponents: [
      { name: "示例对手A", games: 9, winRate: 55, lastSeen: rows[rows.length - 1].t },
    ],
    buildItems: [
      { name: "示例装备A", price: 3000, games: 60, wins: 36, winRate: 60 },
      { name: "示例装备B", price: 2800, games: 45, wins: 20, winRate: 44 },
    ],
    teammates: [
      { name: "示例队友A", games: 42, winRate: 62, lastSeen: rows[rows.length - 1].t },
      { name: "示例队友B", games: 27, winRate: 55, lastSeen: rows[rows.length - 2].t },
      { name: "示例队友C", games: 15, winRate: 40, lastSeen: rows[rows.length - 3].t },
    ],
    // 演示对位（真实数据来自 matchups.js）
    matchups: {
      baseWinRate: pctNum(wins, n),
      worst: [
        { champion: "示例强敌A", games: 20, winRate: 30, delta: -22, championWinRate: 52, residual: -22 },
        { champion: "示例强敌B", games: 16, winRate: 38, delta: -14, championWinRate: 55, residual: -17 },
      ],
      best: [
        { champion: "示例弱旅A", games: 18, winRate: 78, delta: 26, championWinRate: 49, residual: 29 },
        { champion: "示例弱旅B", games: 14, winRate: 71, delta: 19, championWinRate: 50, residual: 21 },
      ],
    },
    pairs: [...pairMap.values()].filter((p) => p.g >= 4).map((p) => ({ ...p, winRate: pctNum(p.w, p.g) })).sort((a, b) => b.g - a.g),
    overview: {
      games: n,
      wins,
      winRate: pctNum(wins, n),
      from: rows[0].t,
      to: rows[n - 1].t,
      kda: (avg((r) => r.kills) + avg((r) => r.assists)) / Math.max(avg((r) => r.deaths), 0.1),
      kills: avg((r) => r.kills),
      deaths: avg((r) => r.deaths),
      assists: avg((r) => r.assists),
      damage: avg((r) => r.damage),
      gold: avg((r) => r.gold),
      duration: avg((r) => r.durationMin),
      longestWin: lw,
      longestLoss: ll,
      last20: { games: last20.length, wins: last20.filter((r) => r.win).length },
      championCount: champCounts.size,
      oneGameChampions: [...champCounts.values()].filter((c) => c === 1).length,
      avgAugments: rows.reduce((s, r) => s + r.augments.length, 0) / n,
      double: 42,
      triple: 11,
      quadra: 3,
      penta: 1,
    },
  };
}

// ---------------------------------------------------------------- SVG 构件

const W = 900;

/** 滚动胜率折线（单序列，带 50% 基线；连败段用淡红带标出） */
function lineChart(
  rolling: Array<{ i: number; t: number; wr: number }>,
  streaks: Array<{ startIdx: number; endIdx: number; len: number }> = []
): string {
  const H = 240,
    padL = 44,
    padR = 16,
    padT = 16,
    padB = 28;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const x = (i: number) => padL + (plotW * (i - 1)) / Math.max(1, rolling.length - 1);
  const y = (wr: number) => padT + plotH * (1 - wr / 100);
  const pts = rolling.map((p) => `${x(p.i).toFixed(1)},${y(p.wr).toFixed(1)}`).join(" ");
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`
    )
    .join("");
  const ticks = [1, Math.round(rolling.length / 2), rolling.length]
    .map(
      (i) =>
        `<text class="axis-label" x="${x(i)}" y="${H - 8}" text-anchor="middle">第 ${i} 把</text>`
    )
    .join("");
  const crosshair = `<line class="crosshair" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}" style="display:none"/>`;
  const dots = rolling
    .map(
      (p) =>
        `<circle class="hoverdot" cx="${x(p.i).toFixed(1)}" cy="${y(p.wr).toFixed(1)}" r="9" fill="transparent"` +
        ` data-tip="第 ${p.i} 把 · ${new Date(p.t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short" })}|滚动 20 把胜率 ${p.wr.toFixed(0)}%"/>`
    )
    .join("");
  // 连败段：淡红纵向带；只给最长的 3 段加标注（否则顶部标签会挤在一起）
  const labelTop = new Set(
    [...streaks].sort((a, b) => b.len - a.len).slice(0, 3).map((s) => `${s.startIdx}-${s.endIdx}`)
  );
  const bands = streaks
    .map((s) => {
      const x1 = x(s.startIdx);
      const x2 = x(s.endIdx);
      const band =
        `<rect class="streak-band" x="${x1.toFixed(1)}" y="${padT}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${plotH}"/>`;
      const label = labelTop.has(`${s.startIdx}-${s.endIdx}`)
        ? `<text class="streak-label" x="${((x1 + x2) / 2).toFixed(1)}" y="${padT - 4}" text-anchor="middle">${s.len} 连败</text>`
        : "";
      return band + label;
    })
    .join("");

  return `
<figure class="chart">
  <figcaption>战绩走势（滚动 20 把胜率；虚线为 50% 基准，红色带为 4 连败以上的低谷）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="滚动胜率折线图" data-plot="line" data-w="${W}" data-h="${H}" data-padl="${padL}" data-padr="${padR}" data-padt="${padT}" data-padb="${padB}">
    ${grid}
    ${bands}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(50)}" y2="${y(50)}"/>
    <polyline class="series-line" points="${pts}"/>
    ${crosshair}
    ${dots}
    ${ticks}
  </svg>
</figure>`;
}

/** 按月柱状图（单序列，50% 基准线） */
function monthlyChart(months: Array<{ label: string; games: number; wins: number; winRate: number }>): string {
  const H = 200,
    padL = 44,
    padR = 16,
    padT = 18,
    padB = 34;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const slot = plotW / Math.max(1, months.length);
  const barW = Math.min(46, slot * 0.56);
  const y = (v: number) => padT + plotH * (1 - v / 100);
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`
    )
    .join("");
  const bars = months
    .map((m, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = Math.max(2, (plotH * Math.min(100, m.winRate)) / 100);
      const color = m.winRate >= 50 ? "var(--pos)" : "var(--neg)";
      return (
        `<rect class="bar" x="${(cx - barW / 2).toFixed(1)}" y="${(y(m.winRate)).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}"` +
        ` data-tip="${m.label}|${m.wins}/${m.games} 胜 · 胜率 ${fmtPct(m.winRate, 1)}"/>` +
        `<text class="row-value" x="${cx.toFixed(1)}" y="${(y(m.winRate) - 5).toFixed(1)}" text-anchor="middle">${m.winRate.toFixed(0)}%</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle">${m.label.replace(/^\d+年/, "").replace("月", "月")}</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>按月胜率（柱高=该月胜率，虚线为 50% 基准；柱上数字为该月胜率）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="按月胜率柱状图">
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(50)}" y2="${y(50)}"/>
    ${bars}
  </svg>
</figure>`;
}

/** 英雄×符文搭配（≥4 把）：横向条形，按你的胜率着色 */
function pairRows(pairs: Array<{ champ: string; aug: string; g: number; w: number; winRate: number }>): string {
  const top = pairs.slice(0, 14);
  const rowH = 26,
    labelW = 210,
    valueW = 64;
  const barW = W - labelW - valueW;
  const H = top.length * rowH + 26;
  const x50 = labelW + barW / 2;
  const body = top
    .map((p, i) => {
      const y = 20 + i * rowH;
      const w = Math.max(2, (barW * Math.min(100, p.winRate)) / 100);
      const color = p.winRate >= 50 ? "var(--pos)" : "var(--neg)";
      return (
        `<text class="row-label" x="0" y="${y + 12}" style="font-size:12px">${esc(p.champ)} × ${esc(p.aug)}</text>` +
        `<text class="row-sub" x="${labelW - 8}" y="${y + 12}" text-anchor="end">${p.g} 把</text>` +
        `<rect class="bar" x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="12" rx="4" fill="${color}"` +
        ` data-tip="${esc(p.champ)} × ${esc(p.aug)}|${p.g} 把 ${p.w} 胜 · 胜率 ${fmtPct(p.winRate, 1)}"/>` +
        `<text class="row-value" x="${W - 4}" y="${y + 13}" text-anchor="end">${fmtPct(p.winRate, 0)}</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>英雄×符文 搭配胜率（≥4 把；竖线为 50% 基准）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="英雄与符文搭配胜率图">
    <line class="baseline" x1="${x50}" x2="${x50}" y1="14" y2="${H - 4}"/>
    ${body}
  </svg>
</figure>`;
}

/** 英雄：条形 + 50% 参考线（背离着色：高于基准蓝、低于基准红） */
function championBars(rows: Bucket[]): string {
  const rowH = 26,
    labelW = 108,
    valueW = 56,
    barW = W - labelW - valueW;
  const H = rows.length * rowH + 34;
  const x50 = labelW + (barW * 50) / 100;
  const scale = [0, 50, 100]
    .map(
      (v) =>
        `<text class="axis-label" x="${labelW + (barW * v) / 100}" y="12" text-anchor="middle">${v}%</text>`
    )
    .join("");
  const body = rows
    .map((r, i) => {
      const y = 24 + i * rowH;
      const w = Math.max(2, (barW * Math.min(100, r.winRate)) / 100);
      const color = r.winRate >= 50 ? "var(--pos)" : "var(--neg)";
      return `
      <text class="row-label" x="0" y="${y + 12}">${esc(r.name)}</text>
      <text class="row-sub" x="${labelW - 8}" y="${y + 12}" text-anchor="end">${r.games} 把</text>
      <rect class="bar" x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="12" rx="4" fill="${color}"
            data-tip="${esc(r.name)}|${r.games} 把 ${r.wins} 胜 · 胜率 ${fmtPct(r.winRate, 0)}"/>
      <text class="row-value" x="${W - 4}" y="${y + 13}" text-anchor="end">${fmtPct(r.winRate, 0)}</text>`;
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>英雄胜率（≥5 把；竖线为 50% 基准，蓝色高于基准、红色低于基准）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="英雄胜率条形图">
    ${scale}
    <line class="baseline" x1="${x50}" x2="${x50}" y1="16" y2="${H - 8}"/>
    ${body}
  </svg>
</figure>`;
}

/** 符文：条形=你的胜率，刻度=版本胜率（同一 % 轴） */
function augmentBullets(
  rows: Array<{ name: string; games: number; wins: number; winRate: number; versionWr: number | null; versionRank: number | null }>
): string {
  const rowH = 30,
    labelW = 150,
    valueW = 64,
    barW = W - labelW - valueW;
  const H = rows.length * rowH + 30;
  const body = rows
    .map((r, i) => {
      const y = 20 + i * rowH;
      const w = Math.max(2, (barW * Math.min(100, r.winRate)) / 100);
      const above = r.versionWr == null ? true : r.winRate >= r.versionWr;
      const color = above ? "var(--pos)" : "var(--neg)";
      const tickX = r.versionWr == null ? null : labelW + (barW * r.versionWr) / 100;
      const tick = tickX
        ? `<line class="tick" x1="${tickX.toFixed(1)}" x2="${tickX.toFixed(1)}" y1="${y - 3}" y2="${y + 19}"
             data-tip="${esc(r.name)}|版本胜率 ${fmtPct(r.versionWr!, 1)}${r.versionRank ? ` · 第 ${r.versionRank} 名` : ""}"/>`
        : "";
      return `
      <text class="row-label" x="0" y="${y + 14}">${esc(r.name)}</text>
      <text class="row-sub" x="${labelW - 10}" y="${y + 14}" text-anchor="end">${r.games} 把</text>
      <rect class="bar" x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="14" rx="4" fill="${color}"
            data-tip="${esc(r.name)}|你拿了 ${r.games} 把，赢 ${r.wins} 把 · 胜率 ${fmtPct(r.winRate, 1)}${r.versionWr != null ? `（版本 ${fmtPct(r.versionWr, 1)}）` : ""}"/>
      ${tick}
      <text class="row-value" x="${W - 4}" y="${y + 15}" text-anchor="end">${fmtPct(r.winRate, 0)}</text>`;
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>符文使用效果（≥8 把；条形=你的胜率，竖刻度=版本胜率。按版本名次看，蓝条高于刻度=你打出了效果）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="符文胜率对比图">
    ${body}
  </svg>
</figure>`;
}

/** 时段表现：0-5 / 6-11 / 12-17 / 18-23 四个时段的胜率（帮你看出「几点打最稳」） */
function hourChart(rows: Array<{ t: number; win: boolean }>): string {
  const buckets = [
    { label: "凌晨 0-5", from: 0 },
    { label: "上午 6-11", from: 6 },
    { label: "下午 12-17", from: 12 },
    { label: "晚上 18-23", from: 18 },
  ].map((b) => {
    const s = rows.filter((r) => {
      const h = new Date(r.t).getHours();
      return h >= b.from && h < b.from + 6;
    });
    const w = s.filter((r) => r.win).length;
    return { label: b.label, games: s.length, wins: w, winRate: s.length ? (w / s.length) * 100 : 0 };
  });

  const H = 200,
    padL = 44,
    padR = 16,
    padT = 18,
    padB = 34;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const slot = plotW / buckets.length;
  const barW = Math.min(72, slot * 0.5);
  const y = (v: number) => padT + plotH * (1 - v / 100);
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`
    )
    .join("");
  const bars = buckets
    .map((b, i) => {
      const cx = padL + slot * i + slot / 2;
      if (!b.games) {
        return `<text class="axis-label" x="${cx.toFixed(1)}" y="${(padT + plotH / 2).toFixed(1)}" text-anchor="middle">无对局</text>`;
      }
      const h = Math.max(2, (plotH * Math.min(100, b.winRate)) / 100);
      const color = b.winRate >= 50 ? "var(--pos)" : "var(--neg)";
      return (
        `<rect class="bar" x="${(cx - barW / 2).toFixed(1)}" y="${y(b.winRate).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}"` +
        ` data-tip="${b.label}|${b.wins}/${b.games} 胜 · 胜率 ${fmtPct(b.winRate, 1)}"/>` +
        `<text class="row-value" x="${cx.toFixed(1)}" y="${(y(b.winRate) - 5).toFixed(1)}" text-anchor="middle">${fmtPct(b.winRate, 0)}</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${(y(b.winRate) + 22).toFixed(1)}" text-anchor="middle">${b.games} 把</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle">${b.label}</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>时段表现（按你本机时间；柱高=该时段胜率，虚线为 50% 基准）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="时段胜率柱状图">
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(50)}" y2="${y(50)}"/>
    ${bars}
  </svg>
</figure>`;
}

/**
 * 符文四象限散点：x=版本胜率，y=你的胜率。
 * 斜线上方=你打得比版本平均好；右下方（版本强、你偏低）= 该考虑换掉的符文。
 */
function augmentScatter(
  pts: Array<{ name: string; games: number; winRate: number; versionWr: number }>
): string {
  const H = 380,
    padL = 56,
    padR = 24,
    padT = 28,
    padB = 46;
  const W2 = W;
  const plotW = W2 - padL - padR,
    plotH = H - padT - padB;
  // 坐标范围取数据与 45%~65% 的并集，保证斜线与多数点都在框内
  const xs = pts.map((p) => p.versionWr);
  const ys = pts.map((p) => p.winRate);
  const xMin = Math.floor(Math.min(45, ...xs) / 5) * 5;
  const xMax = Math.ceil(Math.max(60, ...xs) / 5) * 5;
  const yMin = Math.floor(Math.min(20, ...ys) / 5) * 5;
  const yMax = Math.ceil(Math.max(90, ...ys) / 5) * 5;
  const X = (v: number) => padL + (plotW * (v - xMin)) / (xMax - xMin);
  const Y = (v: number) => padT + plotH * (1 - (v - yMin) / (yMax - yMin));
  const r = (g: number) => Math.min(16, 4 + Math.sqrt(g) * 2.4);

  const grid: string[] = [];
  for (let v = xMin; v <= xMax; v += 5) {
    grid.push(
      `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${padT}" y2="${padT + plotH}"/>` +
        `<text class="axis-label" x="${X(v)}" y="${H - 24}" text-anchor="middle">${v}%</text>`
    );
  }
  for (let v = yMin; v <= yMax; v += 10) {
    grid.push(
      `<line class="grid" x1="${padL}" x2="${W2 - padR}" y1="${Y(v)}" y2="${Y(v)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`
    );
  }
  // 45° 参照线：y = x（在绘图范围内取两端）
  const dFrom = Math.max(xMin, yMin);
  const dTo = Math.min(xMax, yMax);
  const diagonal =
    `<line class="baseline" x1="${X(dFrom)}" y1="${Y(dFrom)}" x2="${X(dTo)}" y2="${Y(dTo)}"/>` +
    `<text class="axis-label" x="${X(dTo) - 6}" y="${Y(dTo) + 16}" text-anchor="end">你和版本一样（y=x）</text>`;

  // 只标注「场次最多」与「偏离斜线最多」的点：50 个点全标会糊成一团
  const labelSet = new Set<string>();
  [...pts].sort((a, b) => b.games - a.games).slice(0, 4).forEach((p) => labelSet.add(p.name));
  [...pts]
    .sort((a, b) => b.winRate - b.versionWr - (a.winRate - a.versionWr))
    .slice(0, 3)
    .forEach((p) => labelSet.add(p.name));
  [...pts]
    .sort((a, b) => a.winRate - a.versionWr - (b.winRate - b.versionWr))
    .slice(0, 4)
    .forEach((p) => labelSet.add(p.name));

  const dots = pts
    .map((p, i) => {
      const above = p.winRate >= p.versionWr;
      const color = above ? "var(--pos)" : "var(--neg)";
      const dot =
        `<circle class="bar" cx="${X(p.versionWr).toFixed(1)}" cy="${Y(p.winRate).toFixed(1)}" r="${r(p.games).toFixed(1)}"` +
        ` fill="${color}" fill-opacity="0.72" stroke="var(--surface-1)" stroke-width="2"` +
        ` data-tip="${esc(p.name)}|你 ${fmtPct(p.winRate, 0)} vs 版本 ${fmtPct(p.versionWr, 1)} · ${p.games} 把"/>`;
      if (!labelSet.has(p.name)) return dot;
      // 相邻标签错开高度，减少重叠
      const dy = r(p.games) + 4 + (i % 2) * 11;
      return (
        dot +
        `<text class="axis-label" x="${X(p.versionWr).toFixed(1)}" y="${(Y(p.winRate) - dy).toFixed(1)}" text-anchor="middle" style="font-size:10.5px;font-weight:600">${esc(p.name)}</text>`
      );
    })
    .join("");

  return `
<figure class="chart">
  <figcaption>符文四象限：横轴=版本胜率，纵轴=你的胜率，圆点大小=你的场次；斜线右下方（版本强、你偏低）是该换掉的</figcaption>
  <svg viewBox="0 0 ${W2} ${H}" role="img" aria-label="符文版本胜率与个人胜率散点图">
    ${grid.join("")}
    ${diagonal}
    <text class="axis-label" x="${X(xMax) - 4}" y="${padT + 12}" text-anchor="end">版本强·我也强</text>
    <text class="axis-label" x="${X(xMin) + 4}" y="${padT + 12}">版本一般·我打得好</text>
    <text class="axis-label" x="${X(xMax) - 4}" y="${padT + plotH - 6}" text-anchor="end">版本强·我打不出 ← 该换</text>
    <text class="axis-label" x="${X(xMin) + 4}" y="${padT + plotH - 6}">都偏低</text>
    <text class="axis-label" x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle">版本胜率 →</text>
    ${dots}
  </svg>
</figure>`;
}


/** 常一起打的人：条形=同队局数（相对最长者），颜色=共同胜率是否过半 */
function teammateBars(mates: Array<{ name: string; games: number; winRate: number; lastSeen: number }>): string {
  const top = mates.slice(0, 12);
  const rowH = 26,
    labelW = 168,
    valueW = 150;
  const barW = W - labelW - valueW;
  const H = top.length * rowH + 22;
  const maxGames = Math.max(1, ...top.map((m) => m.games));
  const body = top
    .map((m, i) => {
      const y = 16 + i * rowH;
      const w = Math.max(2, (barW * m.games) / maxGames);
      const color = m.winRate >= 50 ? "var(--pos)" : "var(--neg)";
      const last = new Date(m.lastSeen).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
      return (
        `<text class="row-label" x="0" y="${y + 12}">${esc(m.name)}</text>` +
        `<rect class="bar" x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="13" rx="4" fill="${color}"` +
        ` data-tip="${esc(m.name)}|同队 ${m.games} 局 · 共同胜率 ${m.winRate.toFixed(0)}% · 最近 ${last}"/>` +
        `<text class="row-value" x="${W - 4}" y="${y + 13}" text-anchor="end">${m.games} 局 · ${m.winRate.toFixed(0)}%</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>常一起打的人（条形=同队局数；颜色=共同胜率是否过半，蓝≥50%、红&lt;50%）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="同队玩家共同胜率图">
    ${body}
  </svg>
</figure>`;
}


/** 出装：条形=出现局数（相对最长者），颜色=该装备的胜率是否过半 */
function itemBars(items: Array<{ name: string; price: number; games: number; wins: number; winRate: number }>): string {
  const top = items.slice(0, 12);
  const rowH = 26,
    labelW = 190,
    valueW = 160;
  const barW = W - labelW - valueW;
  const H = top.length * rowH + 22;
  const maxGames = Math.max(1, ...top.map((it) => it.games));
  const body = top
    .map((it, i) => {
      const y = 16 + i * rowH;
      const w = Math.max(2, (barW * it.games) / maxGames);
      const color = it.winRate >= 50 ? "var(--pos)" : "var(--neg)";
      return (
        `<text class="row-label" x="0" y="${y + 12}">${esc(it.name)}</text>` +
        `<rect class="bar" x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="13" rx="4" fill="${color}"` +
        ` data-tip="${esc(it.name)}|${it.price} 金 · 出现 ${it.games} 把 · 胜率 ${it.winRate.toFixed(0)}%"/>` +
        `<text class="row-value" x="${W - 4}" y="${y + 13}" text-anchor="end">${it.games} 把 · ${it.winRate.toFixed(0)}%</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>出装与胜率（条形=出现局数；颜色=该装备在你局里的胜率，蓝≥50%、红&lt;50%）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="出装胜率图">
    ${body}
  </svg>
</figure>`;
}

/**
 * 按补丁看：柱=该补丁胜率（50% 基准、背离着色），柱下标注局数，样本少的用空心顶。
 * 补丁是平衡性调整的单位，比「按月」更贴近「游戏变了没」这个问题。
 */
function patchChart(
  patches: Array<{ patch: string; playerPatch: string; games: number; wins: number; winRate: number }>,
  noPatch: number
): string {
  const H = 210,
    padL = 44,
    padR = 16,
    padT = 26,
    padB = 46;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const slot = plotW / Math.max(1, patches.length);
  const barW = Math.min(48, slot * 0.6);
  const y = (v: number) => padT + plotH * (1 - v / 100);
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`
    )
    .join("");
  const bars = patches
    .map((p, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = Math.max(2, (plotH * p.winRate) / 100);
      const color = p.winRate >= 50 ? "var(--pos)" : "var(--neg)";
      const thin = p.games < 15;
      return (
        `<rect class="bar" x="${(cx - barW / 2).toFixed(1)}" y="${(y(p.winRate)).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4"` +
        ` fill="${color}"${thin ? ' fill-opacity="0.45"' : ""}` +
        ` data-tip="${p.patch}（${p.playerPatch}）|${p.wins}/${p.games} 胜 · 胜率 ${fmtPct(p.winRate, 1)}${thin ? "（样本少）" : ""}"/>` +
        `<text class="row-value" x="${cx.toFixed(1)}" y="${(y(p.winRate) - 5).toFixed(1)}" text-anchor="middle">${p.winRate.toFixed(0)}%</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 30}" text-anchor="middle">${p.patch}</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 18}" text-anchor="middle">${p.playerPatch}</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.games} 局</text>`
      );
    })
    .join("");
  const note =
    noPatch > 0
      ? `<p style="font-size:12px;color:var(--muted);margin:8px 0 0">另有 ${noPatch} 局没有版本号（本地客户端的历史摘要不带 gameVersion），未计入本图。</p>`
      : "";
  return `
<figure class="chart">
  <figcaption>按补丁的胜率（上行=对局记录里的客户端版本，下行=玩家习惯的赛季号，两者差 10；半透明柱=该补丁不足 15 局）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="按补丁胜率">
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(50)}" y2="${y(50)}"/>
    ${bars}
  </svg>
  ${note}
</figure>`;
}

/**
 * 周趋势：上下两块共享横轴的小倍数图 —— 上块柱子=该周场次（浅色，看投入），
 * 下块折线=该周胜率（0~100%，虚线 50% 基准，看质量）。
 * 两块分开画而不是双 Y 轴，是为了不让人把柱高和胜率看成同一把尺子。
 * 周场次 <5 的点画成空心，提示样本少。
 */
function weeklyChart(weeks: Array<{ t: number; games: number; wins: number; winRate: number }>): string {
  const H = 300,
    padL = 46,
    padR = 18,
    padT = 16,
    padB = 30,
    gap = 26;
  const volH = 74; // 上块高度
  const rateT = padT + volH + gap;
  const rateH = H - rateT - padB;
  const plotW = W - padL - padR;
  const slot = plotW / Math.max(1, weeks.length);
  const barW = Math.max(3, Math.min(30, slot * 0.62));
  const maxGames = Math.max(1, ...weeks.map((w) => w.games));
  const yRate = (v: number) => rateT + rateH * (1 - v / 100);
  const cxOf = (i: number) => padL + slot * i + slot / 2;

  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${yRate(v)}" y2="${yRate(v)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${yRate(v) + 4}" text-anchor="end">${v}%</text>`
    )
    .join("");

  const bars = weeks
    .map((w, i) => {
      const h = Math.max(2, (volH * w.games) / maxGames);
      const x = cxOf(i) - barW / 2;
      const y = padT + volH - h;
      return (
        `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"` +
        ` fill="var(--baseline)" data-tip="${fmtWeek(w.t)}|${w.wins}/${w.games} 胜 · 胜率 ${fmtPct(w.winRate, 1)}"/>`
      );
    })
    .join("");

  const pts = weeks.map((w, i) => ({ x: cxOf(i), y: yRate(w.winRate), w }));
  const line =
    pts.length > 1
      ? `<polyline class="series-line" points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>`
      : "";
  const dots = pts
    .map((p) => {
      const thin = p.w.games < 5;
      return (
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2"` +
        (thin ? ` fill="var(--surface-1)" stroke="var(--accent)" stroke-width="1.6"` : ` fill="var(--accent)"`) +
        ` data-tip="${fmtWeek(p.w.t)}|${p.w.games} 局 · 胜率 ${fmtPct(p.w.winRate, 1)}${thin ? "（样本少）" : ""}"/>`
      );
    })
    .join("");

  // 横轴：周数多时隔几个标一次，避免重叠
  const every = Math.ceil(weeks.length / 12);
  const xLabels = weeks
    .map((w, i) =>
      i % every === 0
        ? `<text class="axis-label" x="${cxOf(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${fmtWeek(w.t)}</text>`
        : ""
    )
    .join("");

  return `
<figure class="chart">
  <figcaption>逐周场次（上，柱=该周局数）与周胜率（下，折线；虚线为 50% 基准，空心点=该周不足 5 局）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="周场次与周胜率">
    <text class="axis-label" x="${padL}" y="${padT - 4}">场次（最高 ${maxGames} 局）</text>
    ${bars}
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${yRate(50)}" y2="${yRate(50)}"/>
    ${line}
    ${dots}
    ${xLabels}
  </svg>
</figure>`;
}

/** 周一日期 → 短标签（如 09/14） */
function fmtWeek(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/**
 * 对位：背离条形图（diverging）。
 * 中轴 = 0，向右（蓝）表示扣掉该英雄自身强度后你还打得更好，向左（红）表示你额外打不过。
 * 用残差而不是原始胜率，是因为「敌方英雄本身强」本来就会拉低所有人的胜率，不减掉会误判成你的克星。
 */
function matchupChart(
  rows: Array<{ champion: string; games: number; winRate: number; delta: number; championWinRate: number | null; residual: number | null }>,
  baseWinRate: number
): string {
  const data = [...rows].sort((a, b) => (a.residual ?? a.delta) - (b.residual ?? b.delta));
  const rowH = 26,
    labelW = 156,
    valueW = 148;
  const trackW = W - labelW - valueW;
  const H = data.length * rowH + 40;
  const maxAbs = Math.max(5, ...data.map((d) => Math.abs(d.residual ?? d.delta)));
  const cx = labelW + trackW / 2;
  const scale = (trackW / 2 - 10) / maxAbs;

  const bars = data
    .map((d, i) => {
      const y = 26 + i * rowH;
      const v = d.residual ?? d.delta;
      const len = Math.max(2, Math.abs(v) * scale);
      const color = v >= 0 ? "var(--pos)" : "var(--neg)";
      const x = v >= 0 ? cx : cx - len;
      const tip =
        `对面有 ${d.champion}|${d.games} 把 · 你 ${d.winRate.toFixed(0)}%` +
        (d.championWinRate != null
          ? ` · 它本身 ${d.championWinRate.toFixed(0)}% · 残差 ${v >= 0 ? "+" : ""}${v.toFixed(1)}`
          : "");
      return (
        `<text class="row-label" x="0" y="${y + 13}">${esc(d.champion)}</text>` +
        `<rect class="bar" x="${x.toFixed(1)}" y="${y + 4}" width="${len.toFixed(1)}" height="13" rx="4" fill="${color}"` +
        ` data-tip="${esc(tip)}"/>` +
        `<text class="row-value" x="${W - 2}" y="${y + 14}" text-anchor="end">${v >= 0 ? "+" : ""}${v.toFixed(1)} 分 · ${d.games} 把</text>`
      );
    })
    .join("");

  return `
<figure class="chart">
  <figcaption>对位残差（中轴 0；右蓝=你打得比该英雄自身的强度更好，左红=额外打不过）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="英雄对位残差背离图">
    <text class="axis-label" x="${labelW}" y="14">← 额外打不过</text>
    <text class="axis-label" x="${W - valueW}" y="14" text-anchor="end">额外打得过 →</text>
    <line class="baseline" x1="${cx}" y1="22" x2="${cx}" y2="${H - 12}"/>
    ${bars}
  </svg>
</figure>`;
}

// ---------------------------------------------------------------- 文案

function findings(data: Awaited<ReturnType<typeof collect>>): string[] {
  const { overview: o, augments, champions } = data;
  const out: string[] = [];

  const gap = o.winRate - 50;
  out.push(
    `**中位线是 50%。** 海斗每局必有 5 胜 5 负，所以 ${o.games} 把里的 ${o.wins} 胜（${fmtPct(o.winRate)}）意味着你${gap >= 0 ? "正好站在中位线之上" : "比中位线低 " + Math.abs(gap).toFixed(1) + " 个百分点"}。`
  );

  const strong = augments
    .filter((a) => a.versionRank != null && a.versionRank <= 30 && a.versionWr != null && a.winRate < a.versionWr - 8 && a.games >= 8)
    .slice(0, 5);
  if (strong.length) {
    out.push(
      `**版本强势符文，你打不出效果。** 这些符文版本胜率都在 55% 以上，你的胜率却明显低于它：` +
        strong.map((a) => `${a.name}（你 ${fmtPct(a.winRate, 0)} vs 版本 ${fmtPct(a.versionWr!, 1)}，${a.games} 把）`).join("；") +
        "。符文不背这个锅 —— 这类符文奖励节奏判断，而你的画像是「看到人就上」。"
    );
  }

  const best = augments.filter((a) => a.games >= 8 && a.winRate >= 65).sort((a, b) => b.winRate - a.winRate).slice(0, 6);
  if (best.length) {
    out.push(
      `**你的真命符文：** ` + best.map((a) => `${a.name}（${a.games} 把 ${fmtPct(a.winRate, 0)}）`).join("、") + "。"
    );
  }

  // 「我 vs 同批对局里的其他人」：剔掉自己之后同一符文的胜率差
  // 本地符文库里查不到名字的（未知#xxxx）不写进结论 —— 说不出名字的符文没法指导打法
  const withOthers = augments.filter((a) => a.othersWr != null && a.games >= 8 && !a.name.startsWith("未知"));
  const below = withOthers
    .map((a) => ({ ...a, gap: (a.winRate as number) - (a.othersWr as number) }))
    .filter((a) => a.gap <= -8)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 4);
  const above = withOthers
    .map((a) => ({ ...a, gap: (a.winRate as number) - (a.othersWr as number) }))
    .filter((a) => a.gap >= 10)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 4);
  if (below.length) {
    out.push(
      `**这些符文是你自己的问题，不是符文的问题。** 同一批对局里，别人拿它们的胜率是：` +
        below
          .map((a) => `${a.name}（你 ${fmtPct(a.winRate, 0)} vs 其他人 ${fmtPct(a.othersWr as number, 0)}，${a.games} 把）`)
          .join("；") +
        "。大家在同一批对局、同一个版本、同一个队列里，差出来的这部分只能归到用法上。"
    );
  }
  if (above.length) {
    out.push(
      `**这几件你用得比旁人好：** ` +
        above.map((a) => `${a.name}（+${a.gap.toFixed(0)} 个百分点）`).join("、") +
        " —— 说明你的打法和它们契合，优先拿。"
    );
  }

  const byWr = champions.filter((c) => c.games >= 5).sort((a, b) => b.winRate - a.winRate);
  const good = byWr.slice(0, 3),
    bad = byWr.slice(-3).reverse();
  if (good.length && bad.length) {
    out.push(
      `**英雄两极：** 顺手的是 ${good.map((c) => `${c.name} ${fmtPct(c.winRate, 0)}（${c.games} 把）`).join("、")}；` +
        `该躲的是 ${bad.map((c) => `${c.name} ${fmtPct(c.winRate, 0)}（${c.games} 把）`).join("、")}。`
    );
  }
  if (o.oneGameChampions > 8) {
    out.push(`**广撒网：** 共玩过 ${o.championCount} 个英雄，其中 ${o.oneGameChampions} 个只玩过 1 把 —— 你更像在玩「抽卡」，不是玩某个英雄。`);
  }

  const r20 = o.last20;
  out.push(
    `**节奏：** 最长连胜 ${o.longestWin}、最长连败 ${o.longestLoss}；最近 20 把 ${r20.wins}/${r20.games}（${fmtPct(pctNum(r20.wins, r20.games), 0)}），` +
      `整体 ${fmtPct(o.winRate, 1)} —— 顺风能滚，逆风也容易一路到底。`
  );
  out.push(
    `**打得很凶：** 场均 ${o.kills.toFixed(1)}/${o.deaths.toFixed(1)}/${o.assists.toFixed(1)}（KDA ${o.kda.toFixed(2)}），伤害 ${Math.round(o.damage / 1000)}k，时长 ${o.duration.toFixed(0)} 分，场均 ${o.avgAugments.toFixed(1)} 个符文（满配 4~5 个，死得多就选得少）。`
  );
  return out;
}

function advice(data: Awaited<ReturnType<typeof collect>>): string[] {
  const { augments, champions } = data;
  const out: string[] = [];
  const strongTrap = augments
    .filter((a) => a.versionRank != null && a.versionRank <= 40 && a.versionWr != null && a.winRate < a.versionWr - 8 && a.games >= 8)
    .slice(0, 4);
  if (strongTrap.length) {
    out.push(
      `降级这 ${strongTrap.length} 个符文：` + strongTrap.map((a) => a.name).join("、") + " —— 版本强但你不适配，纯浪费选择机会。"
    );
  }
  const best = augments.filter((a) => a.games >= 8 && a.winRate >= 65).sort((a, b) => b.winRate - a.winRate).slice(0, 4);
  if (best.length) out.push(`优先锁定：` + best.map((a) => a.name).join("、") + "。");
  const good = champions.filter((c) => c.games >= 5 && c.winRate >= 60).sort((a, b) => b.winRate - a.winRate).slice(0, 4);
  if (good.length) out.push(`英雄选择上多拿：` + good.map((c) => c.name).join("、") + "。");
  return out;
}

// ---------------------------------------------------------------- HTML

function render(data: Awaited<ReturnType<typeof collect>>): string {
  const o = data.overview;
  const fmtDate = (t: number | null) =>
    t ? new Date(t).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";
  const statTiles = [
    ["胜率", fmtPct(o.winRate), `${o.wins} 胜 ${o.games - o.wins} 负`],
    ["KDA", o.kda.toFixed(2), `${o.kills.toFixed(1)} / ${o.deaths.toFixed(1)} / ${o.assists.toFixed(1)}`],
    ["场均伤害", `${Math.round(o.damage / 1000)}k`, `场均金币 ${Math.round(o.gold / 1000)}k`],
    ["场均时长", `${o.duration.toFixed(0)} 分`, `场均符文 ${o.avgAugments.toFixed(1)} 个`],
    ["最长连胜 / 连败", `${o.longestWin} / ${o.longestLoss}`, "波动幅度"],
    ["英雄池", `${o.championCount} 个`, `其中 ${o.oneGameChampions} 个只玩过 1 把`],
    [
      "五杀 / 四杀",
      `${o.penta} / ${o.quadra}`,
      `双杀 ${o.double} · 三杀 ${o.triple}`,
    ],
  ]
    .map(
      ([label, value, sub]) =>
        `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`
    )
    .join("");

  const mdToHtml = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const findingHtml = findings(data).map((f) => `<li>${mdToHtml(f)}</li>`).join("");
  const adviceHtml = advice(data).map((a) => `<li>${mdToHtml(a)}</li>`).join("");

  const recent = data.rows.slice(-20).reverse();
  const recentRows = recent
    .map(
      (r) =>
        `<tr><td>${new Date(r.t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "short" })}</td>` +
        `<td>${esc(r.champ)}</td><td class="${r.win ? "win" : "lose"}">${r.win ? "胜" : "负"}</td>` +
        `<td class="num">${r.kills}/${r.deaths}/${r.assists}</td><td class="num">${Math.round(r.damage / 1000)}k</td>` +
        `<td class="num">${r.durationMin} 分</td><td class="num">${r.augments.length}</td></tr>`
    )
    .join("");

  const champTable = data.champions
    .map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.games}</td><td class="num">${c.wins}</td><td class="num">${fmtPct(c.winRate, 1)}</td></tr>`)
    .join("");
  const hasOthers = data.augments.some((a) => a.othersWr != null);
  const augTable = data.augments
    .map((a) => {
      // 和「其他人」的差：正数说明同一批对局里你比旁人打得好
      const gap =
        a.othersWr != null ? Number(a.winRate) - a.othersWr : null;
      return (
        `<tr><td>${esc(a.name)}</td><td class="num">${a.games}</td><td class="num">${a.wins}</td><td class="num">${fmtPct(a.winRate, 1)}</td>` +
        (hasOthers
          ? `<td class="num">${a.othersWr != null ? fmtPct(a.othersWr, 1) : "—"}</td>` +
            `<td class="num">${gap != null ? (gap >= 0 ? "+" : "") + gap.toFixed(1) : "—"}</td>`
          : "") +
        `<td class="num">${a.versionWr != null ? fmtPct(a.versionWr, 1) : "—"}</td><td class="num">${a.versionRank ?? "—"}</td></tr>`
      );
    })
    .join("");

  const generated = new Date().toLocaleString("zh-CN", { hour12: false });

  const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海斗战绩报告 · ${esc(data.name)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <h1>海克斯大乱斗 · 战绩报告</h1>
      <div class="meta">${esc(data.name)} · ${fmtDate(o.from)} ~ ${fmtDate(o.to)} · ${o.games} 把海斗 · 生成于 ${generated}</div>
    </div>
    <div style="text-align:right">
      <div class="hero-num">${fmtPct(o.winRate, 1)}<small>胜率</small></div>
      <div class="meta">${o.wins} 胜 ${o.games - o.wins} 负 · 中位线 50%</div>
    </div>
  </header>

  <div class="tiles">${statTiles}</div>

  <section>
    <h2>走势与分布</h2>
    ${lineChart(data.rolling, data.streaks)}
    ${data.weekly.length > 1 ? weeklyChart(data.weekly) : ""}
    ${data.patches.length > 1 ? patchChart(data.patches, data.noPatch) : ""}
    ${monthlyChart(data.months)}
    ${hourChart(data.rows)}
    ${championBars(data.champions)}
    <details>
      <summary>英雄数据表（≥5 把）</summary>
      <table><caption>英雄胜率明细</caption>
        <thead><tr><th>英雄</th><th class="num">场次</th><th class="num">胜</th><th class="num">胜率</th></tr></thead>
        <tbody>${champTable}</tbody>
      </table>
    </details>
  </section>

  <section>
    <h2>符文：你 vs 版本</h2>
    <div class="legend">
      <span><i class="swatch" style="background:var(--pos)"></i>你的胜率高于版本</span>
      <span><i class="swatch" style="background:var(--neg)"></i>你的胜率低于版本</span>
      <span><i class="swatch" style="background:var(--text-primary)"></i>版本胜率刻度</span>
    </div>
    ${augmentScatter(
      data.augments
        .filter((a) => a.versionWr != null && a.games >= 5)
        .map((a) => ({ name: a.name, games: a.games, winRate: a.winRate, versionWr: a.versionWr as number }))
    )}
    ${augmentBullets(data.augments.slice(0, 14))}
    <details>
      <summary>符文数据表（≥8 把）</summary>
      <table><caption>符文胜率明细（「其他人」= 同批对局里剔掉我之后、拿过同一个符文的人的胜率；版本胜率来自社区站强度榜）</caption>
        <thead><tr><th>符文</th><th class="num">场次</th><th class="num">胜</th><th class="num">你的胜率</th>${hasOthers ? '<th class="num">其他人</th><th class="num">差值</th>' : ""}<th class="num">版本胜率</th><th class="num">版本名次</th></tr></thead>
        <tbody>${augTable}</tbody>
      </table>
    </details>
  </section>

  ${
    data.teammates.length
      ? `<section>
    <h2>常一起打的人</h2>
    ${teammateBars(data.teammates)}
    ${
      data.opponents.length
        ? `<p style="font-size:12.5px;color:var(--text-secondary);margin:10px 0 0">对手维度：共遇到 ${data.opponents.length} 个不同对手，重复最多 ${Math.max(...data.opponents.map((o) => o.games))} 次 —— 海斗匹配池大、随机性高，没有稳定的“老对手”，所以不单独成图。</p>`
        : ""
    }
  </section>`
      : ""
  }

  <section>
    <h2>英雄 × 符文：哪些搭配真的赢</h2>
    ${data.pairs.length ? pairRows(data.pairs) : "<p style='color:var(--text-secondary);font-size:13px'>样本不足 4 把的搭配没有统计意义，暂时没有可展示的组合。</p>"}
    ${
      data.pairs.length
        ? `<details><summary>搭配数据表（≥4 把）</summary>
      <table><caption>英雄×符文搭配明细，按场次排序</caption>
        <thead><tr><th>英雄</th><th>符文</th><th class="num">场次</th><th class="num">胜</th><th class="num">胜率</th></tr></thead>
        <tbody>${data.pairs
          .slice(0, 40)
          .map(
            (p) =>
              `<tr><td>${esc(p.champ)}</td><td>${esc(p.aug)}</td><td class="num">${p.g}</td><td class="num">${p.w}</td><td class="num">${fmtPct(p.winRate, 1)}</td></tr>`
          )
          .join("")}</tbody>
      </table></details>`
        : ""
    }
  </section>

  ${
    data.buildItems.length
      ? `<section>
    <h2>出装</h2>
    ${itemBars(data.buildItems)}
  </section>`
      : ""
  }

  ${
    data.matchups.worst.length || data.matchups.best.length
      ? `<section>
    <h2>对位：你怕谁、谁怕你</h2>
    ${matchupChart([...data.matchups.worst, ...data.matchups.best], data.matchups.baseWinRate)}
    <ul class="findings" style="margin-top:14px">
      ${
        data.matchups.worst.length
          ? `<li><strong>真正打不过的：</strong>${data.matchups.worst
              .slice(0, 3)
              .map((v) => `${esc(v.champion)}（${v.games} 把 ${fmtPct(v.winRate, 0)}，它本身 ${v.championWinRate != null ? fmtPct(v.championWinRate, 0) : "—"}）`)
              .join("、")} —— 这几个是你扣掉英雄强度之后仍然明显吃亏的，遇到时优先改出装（先堆抗性/位移而不是继续纯输出）。</li>`
          : ""
      }
      ${
        data.matchups.best.length
          ? `<li><strong>对面出这些你就稳：</strong>${data.matchups.best
              .slice(0, 3)
              .map((v) => `${esc(v.champion)}（${v.games} 把 ${fmtPct(v.winRate, 0)}）`)
              .join("、")}。</li>`
          : ""
      }
      <li><strong>怎么读：</strong>残差 = 你对它的胜率 − 它自己的胜率。敌方英雄本身强也会拉低你的胜率，直接看原始胜率会把「它强」误当成「你打不过」，所以这里减掉了。样本 ≥12 次才上榜。</li>
    </ul>
  </section>`
      : ""
  }

  <section>
    <h2>锐评</h2>
    <ul class="findings">${findingHtml}</ul>
  </section>

  <section>
    <h2>可以立刻做的三件事</h2>
    <ul class="findings">${adviceHtml}</ul>
  </section>

  <section>
    <h2>最近 20 把</h2>
    <table>
      <thead><tr><th>时间</th><th>英雄</th><th>结果</th><th class="num">K/D/A</th><th class="num">伤害</th><th class="num">时长</th><th class="num">符文</th></tr></thead>
      <tbody>${recentRows}</tbody>
    </table>
  </section>

  <footer>
    <div style="margin-bottom:6px"><button class="toggle" id="themeBtn">切换深色 / 浅色</button></div>
    <strong>数据来源与边界</strong>
    <ul>
      <li>数据来自本机游戏客户端（puuid 查询路径，接口上限最近 200 场）<strong>以及本地归档</strong>：归档随每次查询自动累积，所以本页可能比 200 场更全 —— 但仍然<strong>不是生涯总场次</strong>。</li>
      <li>本次数据：${esc(data.dataNote)}。</li>
      <li>本页统计海斗 ${o.games} 把（模式标识 KIWI / KIWI_JADE / JADE）。</li>
      <li>版本胜率/名次来自社区站 arammayhem.com（第三方统计，全球口径）；符文与英雄的中文名以官方游戏文件为准。</li>
      <li>单个符文 8~30 把的样本，胜率波动 ±10% 属正常噪声；本报告的结论依据「同类符文指向一致」而非单点数据。</li>
      <li>读取方式为本地只读（127.0.0.1 客户端接口），数据不出本机。</li>
    </ul>
  </footer>
</div>
<div id="tip"><div class="t1"></div><div class="t2"></div></div>
<script>
(function () {
  var tip = document.getElementById('tip');
  function show(html1, html2, x, y) {
    tip.querySelector('.t1').innerHTML = html1;
    tip.querySelector('.t2').innerHTML = html2 || '';
    tip.style.display = 'block';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8);
    var top = Math.max(8, y - h - 14);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hide() { tip.style.display = 'none'; }

  document.addEventListener('mousemove', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-tip]') : null;
    if (el) {
      var parts = (el.getAttribute('data-tip') || '').split('|');
      show(parts[0] || '', parts[1] || '', ev.clientX, ev.clientY);
      return;
    }
    // 折线图十字准星
    var svg = ev.target.closest ? ev.target.closest('svg[data-plot="line"]') : null;
    if (!svg) { hide(); return; }
    var r = svg.getBoundingClientRect();
    var vb = svg.viewBox.baseVal;
    var padL = +svg.dataset.padl, padR = +svg.dataset.padr;
    var plotW = vb.width - padL - padR;
    var vx = ((ev.clientX - r.left) / r.width) * vb.width;
    var pts = svg.querySelectorAll('.hoverdot');
    if (!pts.length) return;
    var best = null, bestD = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var cx = +pts[i].getAttribute('cx');
      var dd = Math.abs(cx - vx);
      if (dd < bestD) { bestD = dd; best = pts[i]; }
    }
    if (!best) return;
    var line = svg.querySelector('.crosshair');
    if (line) {
      var cx2 = best.getAttribute('cx');
      line.setAttribute('x1', cx2); line.setAttribute('x2', cx2);
      line.style.display = '';
    }
    var parts = (best.getAttribute('data-tip') || '').split('|');
    show(parts[0] || '', parts[1] || '', ev.clientX, ev.clientY);
  });
  document.addEventListener('mouseleave', hide);

  var btn = document.getElementById('themeBtn');
  btn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var isDark = cur === 'dark' || (!cur && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });
})();
</script>
</body>
</html>`;
  return reflowFigures(html);
}

// ---------------------------------------------------------------- CLI

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const gamesLimit = Number(argOf("--games") ?? 200);
  const demo = argv.includes("--demo");
  // --friend <名字>：出别人的报告（用本机登录态查 TA 的历史；只读）
  let who: { puuid: string; name: string } | undefined;
  const friendArg = argOf("--friend");
  if (friendArg) {
    const { resolveAccountByName } = await import("./identity.js");
    const r = await resolveAccountByName(friendArg);
    if (!r.matches.length) {
      console.log(`没找到「${friendArg}」——${r.note}`);
      return;
    }
    if (r.matches.length > 1) {
      console.log(`「${friendArg}」匹配到多个账号：${r.matches.map((m) => m.name).join("、")}`);
      return;
    }
    who = { puuid: r.matches[0].puuid, name: r.matches[0].name };
    console.log(`生成对象：${who.name}`);
  }
  const data = demo ? demoData() : await collect(Number.isFinite(gamesLimit) ? gamesLimit : 200, who);
  if (!demo && !data.rows.length) {
    console.log(
      [
        "没有可用的对局数据。",
        `原因：${data.dataNote}`,
        "办法：① 打开游戏客户端后重跑；② 先跑 npm run archive:sync 把对局并入本地归档；③ 用 --demo 只看排版。",
      ].join("\n")
    );
    return;
  }
  const html = render(data);

  const safeName = data.name.replace(/[\\/:*?"<>|]/g, "_");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const out =
    argOf("--out") ?? path.join(ROOT, "reports", `海斗战绩报告-${safeName}-${stamp}.html`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, html, "utf8");
  console.log(`已生成报告：${out}`);
  console.log(`账号 ${data.name} · 海斗 ${data.overview.games} 把 · 胜率 ${fmtPct(data.overview.winRate)}`);
}

main().catch((e) => {
  console.error("生成失败:", e?.message ?? e);
  process.exit(1);
});
