/**
 * 实证统计：用**本机归档里的真实对局**算符文胜率，而不是照抄社区站。
 *
 * 为什么值得单独做：归档里每一局都带全部 10 个参与者的符文（`playerAugment1..6`），
 * 所以样本是「两万行真实玩家对局」，比只看自己的几百把厚得多，也不受社区站口径影响。
 *
 * 必须说明的三点偏差（不做修正，只如实标注）：
 *   1) 不是随机抽样：样本来自本机几个账号以及他们排到过的所有人，不代表全服；
 *   2) 符文是**玩家自己选的**，胜率里含「谁会选它」的选择偏差 —— 强符文强者拿，胜率就偏高；
 *   3) 符文是随对局进程分几次选的，凑不到想要的组合是常态，所以组合样本天然比单体少。
 *
 * 只读本地归档，不联网。
 */
import { archivedGamesFor } from "./archive.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export interface EmpiricalAugment {
  id: number;
  name: string;
  rarity: string;
  availability: string;
  /** 在归档里出现过的局数 */
  games: number;
  wins: number;
  winRate: number;
  /** 相对全部符文的整体胜率（百分点），正=比平均强 */
  delta: number;
  /** 社区站版本的胜率（%），用来对照 —— 两套口径，不混算 */
  communityWinRate: number | null;
}

export interface EmpiricalPair {
  a: string;
  b: string;
  games: number;
  wins: number;
  winRate: number;
  /** 相对整体胜率的差值（百分点） */
  delta: number;
  /** 两件符文各自单独出现时的胜率（%），用来看「一起拿」是不是比分开更好 */
  soloA: number;
  soloB: number;
  /** 组合胜率 − 两件单拿胜率的均值（百分点） */
  synergy: number;
}

export interface SynergyCheck {
  name: string;
  /** 需要哪几件（中文名） */
  augments: string[];
  /** 归档里凑齐过的局数 */
  games: number;
  wins: number;
  winRate: number;
  delta: number;
  /** 凑齐时能比过没凑齐时强多少（百分点） */
  note: string;
}

export interface EmpiricalReport {
  games: number;
  rows: number;
  baseWinRate: number;
  note: string;
  /** 每行拿到几件符文 → 行数（只有羁绊验证会填） */
  augCountDist?: Array<[number, number]>;
  augCountNote?: string;
}

interface Tally {
  games: number;
  wins: number;
}

/**
 * 把归档里所有「带符文的海斗参与者行」扫一遍，交给回调聚合。
 *
 * `excludePuuid` 用来剔掉某个人自己的行 —— 于是剩下的就是「**其他人**拿同一个符文时打得如何」，
 * 这才是「我打得差」该对比的基线（跟全服统计比会被口径差异污染）。
 */
async function scan<T>(
  init: () => T,
  visit: (t: T, augments: number[], win: boolean) => void,
  excludePuuid?: string | null
): Promise<{ acc: T; games: number; rows: number }> {
  const games = (await archivedGamesFor("lol")).filter(isMayhemGame);
  const acc = init();
  let rows = 0;
  for (const g of games) {
    for (const p of g.participants ?? []) {
      if (excludePuuid && p.puuid === excludePuuid) continue;
      const s: any = p.stats ?? {};
      const ids: number[] = [];
      for (let i = 1; i <= 6; i++) {
        const v = Number(s[`playerAugment${i}`] ?? 0);
        if (v) ids.push(v);
      }
      if (!ids.length || s.win === undefined) continue;
      rows++;
      visit(acc, [...new Set(ids)], s.win === true);
    }
  }
  return { acc, games: games.length, rows };
}

/**
 * 「其他人」的符文胜率表：id → 胜率（%）。
 *
 * 用途是把个人的符文表现和**同局的其他人**比，而不是和全服统计比 ——
 * 大家排在同一批对局里，版本、队列、分段都一致，差出来的才是你自己的问题。
 */
export async function othersAugmentRates(
  myPuuid: string,
  opts: { minGames?: number } = {}
): Promise<Map<number, { games: number; winRate: number }>> {
  const { acc } = await scan(
    () => new Map<number, Tally>(),
    (m, ids, win) => {
      for (const id of ids) {
        const c = m.get(id) ?? { games: 0, wins: 0 };
        c.games++;
        if (win) c.wins++;
        m.set(id, c);
      }
    },
    myPuuid
  );
  const min = opts.minGames ?? 30;
  const out = new Map<number, { games: number; winRate: number }>();
  for (const [id, t] of acc) {
    if (t.games < min) continue;
    out.set(id, { games: t.games, winRate: rate(t) });
  }
  return out;
}

function rate(t: Tally): number {
  return t.games ? (t.wins / t.games) * 100 : 0;
}

/** 符文实证胜率榜（全归档样本） */
export async function empiricalAugments(
  opts: { minGames?: number; order?: "winRate" | "games" } = {}
): Promise<{ report: EmpiricalReport; augments: EmpiricalAugment[] }> {
  const d = loadData();
  const { acc, games, rows } = await scan(
    () => ({ singles: new Map<number, Tally>(), all: { games: 0, wins: 0 } }),
    (acc, ids, win) => {
      acc.all.games++;
      if (win) acc.all.wins++;
      for (const id of ids) {
        const c = acc.singles.get(id) ?? { games: 0, wins: 0 };
        c.games++;
        if (win) c.wins++;
        acc.singles.set(id, c);
      }
    }
  );

  const base = rate(acc.all);
  const minGames = opts.minGames ?? 100;
  const augments: EmpiricalAugment[] = [...acc.singles.entries()]
    .map(([id, t]) => {
      const a = d.augments.find((x) => x.officialId === id);
      const wr = rate(t);
      const comm = a?.stats?.winRate ? parseFloat(String(a.stats.winRate)) : NaN;
      return {
        id,
        name: a?.name ?? `未知符文#${id}`,
        rarity: a?.rarity ?? "unknown",
        availability: a?.availability ?? "unknown",
        games: t.games,
        wins: t.wins,
        winRate: wr,
        delta: wr - base,
        communityWinRate: Number.isFinite(comm) ? comm : null,
      };
    })
    .filter((x) => x.games >= minGames)
    .sort((a, b) => (opts.order === "games" ? b.games - a.games : b.winRate - a.winRate || b.games - a.games));

  return {
    report: {
      games,
      rows,
      baseWinRate: base,
      note:
        `样本：本机归档里 ${games} 把海斗、${rows} 行参与者记录（每行 = 某玩家某局的符文与胜负）。` +
        `全员整体胜率 ${base.toFixed(1)}%（应该接近 50%，偏离说明样本不是随机抽样）。` +
        `只列出现 ≥${minGames} 次的符文。`,
    },
    augments,
  };
}

/** 符文组合实证：同一局里同时拿到这两件时的胜率 */
export async function empiricalPairs(
  opts: { minGames?: number; top?: number } = {}
): Promise<{ report: EmpiricalReport; pairs: EmpiricalPair[] }> {
  const d = loadData();
  const { acc, games, rows } = await scan(
    () => ({ singles: new Map<number, Tally>(), pairs: new Map<string, Tally>(), all: { games: 0, wins: 0 } }),
    (acc, ids, win) => {
      acc.all.games++;
      if (win) acc.all.wins++;
      for (const id of ids) {
        const c = acc.singles.get(id) ?? { games: 0, wins: 0 };
        c.games++;
        if (win) c.wins++;
        acc.singles.set(id, c);
      }
      const sorted = [...ids].sort((x, y) => x - y);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const k = `${sorted[i]}|${sorted[j]}`;
          const c = acc.pairs.get(k) ?? { games: 0, wins: 0 };
          c.games++;
          if (win) c.wins++;
          acc.pairs.set(k, c);
        }
      }
    }
  );

  const base = rate(acc.all);
  const name = (id: number) => d.augments.find((x) => x.officialId === id)?.name ?? `未知符文#${id}`;
  const minGames = opts.minGames ?? 60;
  const pairs: EmpiricalPair[] = [...acc.pairs.entries()]
    .map(([k, t]) => {
      const [ia, ib] = k.split("|").map(Number);
      const sa = acc.singles.get(ia) ?? { games: 0, wins: 0 };
      const sb = acc.singles.get(ib) ?? { games: 0, wins: 0 };
      const wr = rate(t);
      const soloA = rate(sa);
      const soloB = rate(sb);
      return {
        a: name(ia),
        b: name(ib),
        games: t.games,
        wins: t.wins,
        winRate: wr,
        delta: wr - base,
        soloA,
        soloB,
        synergy: wr - (soloA + soloB) / 2,
      };
    })
    .filter((x) => x.games >= minGames)
    .sort((a, b) => b.synergy - a.synergy);

  return {
    report: {
      games,
      rows,
      baseWinRate: base,
      note:
        `样本同上（${games} 把 / ${rows} 行）。「协同」= 一起拿的胜率 − 两件各自单拿胜率的平均，` +
        `正数才是真的 1+1>2；只看一起出现过 ≥${minGames} 次的组合。` +
        `注意：玩家是分几次选符文的，能不能凑到一起本身受运气影响，样本天然比单体少。`,
    },
    pairs,
  };
}

/** 羁绊验证：社区站定义的羁绊，在归档里真凑齐时到底赢不赢 */
export async function checkSynergySets(
  opts: { minGames?: number } = {}
): Promise<{ report: EmpiricalReport; sets: SynergyCheck[]; unresolved: number }> {
  const d = loadData();
  // 社区站的羁绊是按英文名给的，先尽量解析成本地符文，再映射到对局记录里的官方数字 id
  const sets = d.synergySets
    .map((s) => {
      const official = s.augmentIds
        .map((lid) => d.augments.find((a) => a.id === lid)?.officialId)
        .filter((x): x is number => typeof x === "number");
      return { set: s, official };
    })
    .filter((x) => x.official.length >= 2);
  const unresolved = d.synergySets.length - sets.length;

  const { acc, games, rows } = await scan(
    () => ({ all: { games: 0, wins: 0 }, sets: new Map<string, Tally>(), dist: new Map<number, number>() }),
    (acc, ids, win) => {
      acc.all.games++;
      if (win) acc.all.wins++;
      acc.dist.set(ids.length, (acc.dist.get(ids.length) ?? 0) + 1);
      for (const { set, official } of sets) {
        if (!official.every((id) => ids.includes(id))) continue;
        const c = acc.sets.get(set.id) ?? { games: 0, wins: 0 };
        c.games++;
        if (win) c.wins++;
        acc.sets.set(set.id, c);
      }
    }
  );

  const base = rate(acc.all);
  const minGames = opts.minGames ?? 30;
  const out: SynergyCheck[] = sets
    .map(({ set, official }) => {
      const t = acc.sets.get(set.id) ?? { games: 0, wins: 0 };
      const wr = rate(t);
      return {
        name: set.name,
        augments: official.map((id) => d.augments.find((a) => a.officialId === id)?.name ?? `未知#${id}`),
        games: t.games,
        wins: t.wins,
        winRate: wr,
        delta: t.games ? wr - base : 0,
        note: t.games === 0 ? "归档里从没凑齐过" : t.games < minGames ? `样本仅 ${t.games} 局，不足以判断` : "",
      };
    })
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate);

  // 每局每人实际拿到几件符文 —— 这是「羁绊几乎凑不齐」的直接原因，写进结论里
  const dist = [...acc.dist.entries()].sort((a, b) => a[0] - b[0]);
  const modal = dist.reduce((best, cur) => (cur[1] > best[1] ? cur : best), [0, 0] as [number, number]);
  const modalShare = rows ? (modal[1] / rows) * 100 : 0;
  const needMin = sets.length ? Math.min(...sets.map((x) => x.official.length)) : 0;
  const needMax = sets.length ? Math.max(...sets.map((x) => x.official.length)) : 0;

  return {
    report: {
      games,
      rows,
      baseWinRate: base,
      note:
        `${d.synergySets.length} 套羁绊里 ${sets.length} 套能解析到 ≥2 件符文并做验证，` +
        `${unresolved} 套因符文未解析到本地库而无法验证。` +
        `样本：${games} 把 / ${rows} 行。判定「凑齐」= 该玩家那一局同时拿到了这套羁绊的全部符文。` +
        `只把凑齐 ≥${minGames} 局的当作有效结论。`,
      augCountDist: dist,
      augCountNote:
        `一局里每个人实际拿到的符文数：${dist.map(([k, v]) => `${k} 件 ${v} 行`).join(" · ")}` +
        `；众数是 ${modal[0]} 件（占 ${modalShare.toFixed(1)}%），而这几套羁绊最少要 ${needMin} 件、最多要 ${needMax} 件。`,
    },
    sets: out,
    unresolved,
  };
}

export interface AugmentEmpirical {
  /** 该符文本身：全归档样本下的场次与胜率 */
  self: { games: number; wins: number; winRate: number; delta: number } | null;
  /** 和别人同局一起拿到时，协同最强/最弱的几个（样本够才列） */
  topPairs: Array<{ with: string; games: number; winRate: number; synergy: number }>;
  worstPairs: Array<{ with: string; games: number; winRate: number; synergy: number }>;
  /** 一共扫了多少行 */
  rows: number;
  note: string;
}

/**
 * 查单个符文的实证数据（符文详情页用）。
 * 一次扫描同时拿到「它自己」和「它和谁一起拿更好/更差」，避免调两个函数扫两遍。
 */
export async function augmentEmpirical(officialId: number, opts: { minGames?: number } = {}): Promise<AugmentEmpirical> {
  const d = loadData();
  const { acc, rows } = await scan(
    () => ({ singles: new Map<number, Tally>(), pairs: new Map<string, Tally>(), all: { games: 0, wins: 0 } }),
    (acc, ids, win) => {
      acc.all.games++;
      if (win) acc.all.wins++;
      for (const id of ids) {
        const c = acc.singles.get(id) ?? { games: 0, wins: 0 };
        c.games++;
        if (win) c.wins++;
        acc.singles.set(id, c);
      }
      // 只记和这个符文有关的组合，省掉无用的组合爆炸
      if (!ids.includes(officialId)) return;
      for (const other of ids) {
        if (other === officialId) continue;
        const k = String(other);
        const c = acc.pairs.get(k) ?? { games: 0, wins: 0 };
        c.games++;
        if (win) c.wins++;
        acc.pairs.set(k, c);
      }
    }
  );

  const base = rate(acc.all);
  const selfTally = acc.singles.get(officialId);
  const name = (id: number) => d.augments.find((x) => x.officialId === id)?.name ?? `未知符文#${id}`;

  const minGames = opts.minGames ?? 60;
  const pairs = [...acc.pairs.entries()]
    .filter(([, t]) => t.games >= minGames)
    // 本地符文库里查不到名字的不列：说不出名字的组合没法拿来指导选符文
    .filter(([k]) => !name(Number(k)).startsWith("未知符文"))
    .map(([k, t]) => {
      const other = Number(k);
      const solo = acc.singles.get(other) ?? { games: 0, wins: 0 };
      const wr = rate(t);
      return {
        with: name(other),
        games: t.games,
        winRate: wr,
        // 协同 = 一起拿 − 两件单拿的平均
        synergy: wr - (rate(selfTally ?? { games: 0, wins: 0 }) + rate(solo)) / 2,
      };
    })
    .sort((a, b) => b.synergy - a.synergy);

  return {
    self: selfTally
      ? {
          games: selfTally.games,
          wins: selfTally.wins,
          winRate: rate(selfTally),
          delta: rate(selfTally) - base,
        }
      : null,
    topPairs: pairs.slice(0, 5),
    worstPairs: pairs.slice(-5).reverse(),
    rows,
    note:
      `样本：本机归档里 ${rows} 行真实对局记录（每行 = 某玩家某局的符文与胜负），全员整体胜率 ${base.toFixed(1)}%。` +
      `组合只列同局一起出现过 ≥${minGames} 次的。这是观察数据：符文由玩家自选，含选择偏差。`,
  };
}

export interface ChampionAugmentStat {
  augmentId: number;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  /** 相对该英雄整体胜率的差（百分点） */
  delta: number;
  /** 该符文在全体的胜率，用来区分「这英雄专属强」还是「符文本身就强」 */
  overallWinRate: number | null;
  /** 英雄内 − 全体（百分点），正数才是「跟这个英雄特别搭」 */
  specific: number | null;
}

export interface ChampionEmpirical {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  winRate: number;
  /** 这个英雄拿到后胜率最高的符文 */
  best: ChampionAugmentStat[];
  /** 拿到后胜率最低的 */
  worst: ChampionAugmentStat[];
  note: string;
}

/**
 * 英雄 × 符文的实证：玩这个英雄时，拿到哪些符文胜率更高。
 *
 * 关键的一步是**减掉符文本身的强度**（`specific` 列）：
 * 「亮出你的剑」在全服就 61% 胜率，某个英雄拿它 60% 说明不了它跟这英雄搭。
 * 只有「英雄内胜率 − 该符文整体胜率」为正，才说明是这英雄的专属好事。
 *
 * 样本来自归档全部参与者行（不只你自己），所以量够。
 */
export async function championAugmentEmpirical(
  championId: number,
  opts: { minGames?: number } = {}
): Promise<ChampionEmpirical> {
  const d = loadData();
  const cid = d.championIds[String(championId)];
  const championName = cid ? d.championById.get(cid.id)?.name ?? cid.name : `英雄#${championId}`;

  // 这里要按「英雄 × 符文」交叉，而通用 scan() 不带 championId，所以自己走一遍
  const games = (await archivedGamesFor("lol")).filter(isMayhemGame);
  const augs = new Map<number, Tally>();
  const champ: Tally = { games: 0, wins: 0 };
  const all = new Map<number, Tally>();
  let n = 0;
  for (const g of games) {
    for (const p of g.participants ?? []) {
      const s: any = p.stats ?? {};
      const ids: number[] = [];
      for (let i = 1; i <= 6; i++) {
        const v = Number(s[`playerAugment${i}`] ?? 0);
        if (v) ids.push(v);
      }
      if (!ids.length || s.win === undefined) continue;
      n++;
      const uniq = [...new Set(ids)];
      for (const id of uniq) {
        const c = all.get(id) ?? { games: 0, wins: 0 };
        c.games++;
        if (s.win === true) c.wins++;
        all.set(id, c);
      }
      if (Number(p.championId) !== championId) continue;
      champ.games++;
      if (s.win === true) champ.wins++;
      for (const id of uniq) {
        const c = augs.get(id) ?? { games: 0, wins: 0 };
        c.games++;
        if (s.win === true) c.wins++;
        augs.set(id, c);
      }
    }
  }

  const base = rate(champ);
  const minGames = opts.minGames ?? 20;
  const list: ChampionAugmentStat[] = [...augs.entries()]
    .filter(([, t]) => t.games >= minGames)
    .map(([id, t]) => {
      const a = d.augments.find((x) => x.officialId === id);
      const wr = rate(t);
      const overall = all.get(id);
      const owr = overall ? rate(overall) : null;
      return {
        augmentId: id,
        name: a?.name ?? `未知符文#${id}`,
        games: t.games,
        wins: t.wins,
        winRate: wr,
        delta: wr - base,
        overallWinRate: owr,
        specific: owr == null ? null : wr - owr,
      };
    })
    // 说不出名字的符文没法指导选符文，不进榜
    .filter((x) => !x.name.startsWith("未知符文"));

  const bySpecific = [...list].filter((x) => x.specific != null).sort((a, b) => (b.specific ?? 0) - (a.specific ?? 0));
  // 两个榜必须互斥：直接取头尾会在条目少的时候把同一件符文同时列进「最搭」和「最不搭」
  const best = bySpecific.slice(0, 8);
  const bestIds = new Set(best.map((x) => x.augmentId));
  // 「最不搭」只在**真的低于该符文全体胜率**（specific < 0）里挑；
  // 挑不出来就空着 —— 硬取倒数几条会把一堆正数说成「不搭」。
  const worst = bySpecific
    .filter((x) => (x.specific ?? 0) < 0 && !bestIds.has(x.augmentId))
    .sort((a, b) => (a.specific ?? 0) - (b.specific ?? 0))
    .slice(0, 6);

  return {
    championId,
    championName,
    games: champ.games,
    wins: champ.wins,
    winRate: base,
    best,
    worst,
    note:
      `${championName}：归档里 ${champ.games} 局（全部参与者行共 ${n} 行），该英雄整体胜率 ${base.toFixed(1)}%。` +
      `只列在这个英雄身上出现 ≥${minGames} 次的符文。` +
      `「专属」列 = 该英雄拿它的胜率 − 它在所有人手里的胜率 —— 正数才是「跟这个英雄特别搭」，` +
      `不是「这个符文本身强」（符文本身强的话所有人都强）。` +
      `⚠ 观察数据：符文是自选的，英雄与符文的选择本身相关。`,
  };
}

// ---------------------------------------------------------------- 文本输出

const pct = (v: number) => `${v.toFixed(1)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

/** 符文实证榜文本 */
export async function empiricalAugmentsText(
  opts: { minGames?: number; top?: number } = {}
): Promise<string> {
  let r: Awaited<ReturnType<typeof empiricalAugments>>;
  try {
    r = await empiricalAugments({ minGames: opts.minGames });
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const top = opts.top ?? 20;
  const byWr = r.augments;
  const byGames = [...r.augments].sort((a, b) => b.games - a.games);

  const out: string[] = [];
  out.push("符文实证榜（样本=本机归档里的真实对局，不是社区站统计）");
  out.push(r.report.note);
  out.push("");

  out.push(`胜率最高（≥ 阈值样本）：`);
  for (const a of byWr.slice(0, top)) {
    out.push(
      `  · ${a.name}：${a.games} 局 ${pct(a.winRate)}（比整体 ${signed(a.delta)}）` +
        (a.communityWinRate != null ? ` · 社区站 ${pct(a.communityWinRate)}` : "")
    );
  }

  out.push("", `胜率最低（样本够的）：`);
  for (const a of byWr.slice(-Math.min(10, top))) {
    out.push(`  · ${a.name}：${a.games} 局 ${pct(a.winRate)}（比整体 ${signed(a.delta)}）`);
  }

  const pick = byGames.slice(0, 12);
  out.push("", `出现最多的符文（说明它们在池里被端上来的频率，不等于强度）：`);
  for (const a of pick) out.push(`  · ${a.name}：${a.games} 局 ${pct(a.winRate)}`);

  out.push(
    "",
    "⚠ 这是观察数据不是实验数据：符文是玩家自己选的，胜率里含「谁会选它」的选择偏差 ——",
    "强符文容易被会玩的人拿走，胜率自然偏高。样本也来自本机几个账号及其排到过的人，不代表全服。"
  );
  return out.join("\n");
}

/** 符文组合实证文本 */
export async function empiricalPairsText(
  opts: { minGames?: number; top?: number } = {}
): Promise<string> {
  let r: Awaited<ReturnType<typeof empiricalPairs>>;
  try {
    r = await empiricalPairs({ minGames: opts.minGames });
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const top = opts.top ?? 15;
  const out: string[] = [];
  out.push("符文组合实证：同局一起拿到这两件时，赢得比单拿多吗");
  out.push(r.report.note);
  out.push("");
  if (!r.pairs.length) {
    out.push("样本不足：归档里没有足够多的「同局拿到同一对符文」的局。多打一些、或先跑 npm run archive:sync 把归档攒厚。");
    return out.join("\n");
  }

  // 这份榜单是**从 N 个候选里挑最大值** —— 而取极值本身就会造出大的差值：
  // N 个独立标准正态的极值期望约 √(2·ln N)，N=455 时约 3.5。
  // 也就是说，光靠噪声就能造出「3.5 个标准误」那么大的「最强协同」。
  // 不把这层说出来，「协同最强」会被读成「这几对真的特别搭」。
  // （是「门槛登记表」的扫描查出来的：组合有 22164 个单元，门槛 60 下仍留 455 条。）
  const seOfPair = (p: EmpiricalPair) =>
    Math.sqrt(Math.max(p.winRate * (100 - p.winRate), 1) / Math.max(p.games, 1));
  const ses = r.pairs.map(seOfPair).sort((a, b) => a - b);
  const medSE = ses.length ? ses[Math.floor(ses.length / 2)] : 0;
  const maxZ = Math.sqrt(2 * Math.log(Math.max(r.pairs.length, 2)));
  const noiseCeil = medSE * maxZ; // 纯噪声能造出的最大协同（百分点）
  const kOf = (p: EmpiricalPair) => (seOfPair(p) > 0 ? Math.abs(p.synergy) / seOfPair(p) : 0);

  const line = (p: EmpiricalPair) =>
    `  · ${p.a} + ${p.b}：${p.games} 局 ${pct(p.winRate)}` +
    `（单拿分别 ${pct(p.soloA)} / ${pct(p.soloB)} → 协同 ${signed(p.synergy)}，` +
    `约是它自己噪声的 ${kOf(p).toFixed(1)} 倍）`;

  const topPair = r.pairs[0];
  const topIsNoise = topPair ? Math.abs(topPair.synergy) < noiseCeil : true;
  out.push(
    `候选 ${r.pairs.length} 对够样本。**这是从这么多对里挑最大值** —— ` +
      `${r.pairs.length} 个候选的极值，光噪声就能造出约 ±${noiseCeil.toFixed(1)} 个百分点的「最强协同」` +
      `（按 √(2·ln N) × 中等标准误 ${medSE.toFixed(1)} 估）。`
  );
  out.push(
    topIsNoise
      ? `所以「最高的那一对」这个事实本身不构成证据 —— 从 ${r.pairs.length} 条里挑最大，最大值本来就有这么大。`
      : `最高的一对超过了这个量级，但那只说明它一条突出，不代表整份清单都可信。`
  );
  // 两个数字回答的是**不同的问题**，不写清楚会看着像自相矛盾：
  //   · 每条后面的「几倍」= 这一条比不比 0 大（单次比较）
  //   · 上面那个 ±X = 整份榜单的尺度（从 N 条里挑最大，最大值本来就这么大）
  out.push(
    `注意这两个尺度不是一回事：**逐条**看，某一条可能有 3~4 倍的自身信号（那条大概率是真的）；` +
      `但「它是这 ${r.pairs.length} 条里最高的」这件事**本身**不构成额外证据。选的时候按前者判断，别按排名。`
  );
  out.push("");
  out.push(`协同最强（一起拿 > 分开拿）：`);
  for (const p of r.pairs.slice(0, top)) out.push(line(p));
  out.push("", `协同最弱（一起拿反而更差）：`);
  for (const p of r.pairs.slice(-Math.min(10, top))) out.push(line(p));
  out.push(
    "",
    "怎么读：「协同」是正数才说明 1+1>2；负数往往是两个符文抢同一件装备/同一个流派，或者只是样本少。",
    "每条后面标了「约是它自己噪声的几倍」—— 不到 2 倍的跟 0 分不开。",
    "样本 < 阈值的一律不列，避免把两三局的偶然当结论。"
  );
  return out.join("\n");
}

/** 羁绊验证文本 */
export async function synergyCheckText(opts: { minGames?: number } = {}): Promise<string> {
  let r: Awaited<ReturnType<typeof checkSynergySets>>;
  try {
    r = await checkSynergySets({ minGames: opts.minGames });
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const ok = r.sets.filter((s) => s.games >= (opts.minGames ?? 30));
  const out: string[] = [];
  out.push("羁绊验证：社区站写的羁绊，实战里凑齐了到底赢不赢");
  out.push(r.report.note);
  if (r.report.augCountNote) out.push("", r.report.augCountNote);
  out.push("");
  if (!ok.length) {
    const zero = r.sets.filter((s) => s.games === 0).length;
    if (zero === r.sets.length) {
      out.push(
        `结论：**${r.sets.length} 套羁绊在 ${r.report.games} 把里一次都没凑齐过。**`,
        "这不是数据缺失，而是设计使然：羁绊要同时拿到 4~8 件指定符文，而一局里绝大多数人只有 4 个符文位（见上行分布），",
        "池子里又有两百多个符文 —— 靠正常发牌凑齐一套的概率低到可以忽略。",
        "所以羁绊在实战里更像是「彩蛋」而不是可以围绕它做规划的构筑目标：",
        "本工具之前的 analyze_synergy 用来推算「离凑齐还差几件」依然有意义（能看还剩几张牌），",
        "但不要为了凑羁绊去拿本来不该拿的符文。"
      );
    } else {
      out.push("归档里还没有任何一套羁绊被凑齐到足够样本 —— 海斗符文是分批发的，凑齐一套本来就难。");
    }
  } else {
    out.push(`凑齐过且样本够的羁绊（按凑齐局数）：`);
    for (const s of ok) {
      out.push(
        `  · ${s.name}：凑齐 ${s.games} 局 ${pct(s.winRate)}（比整体 ${signed(s.delta)}）` +
          ` ← ${s.augments.join(" + ")}`
      );
    }
  }
  const few = r.sets.filter((s) => s.games > 0 && s.games < (opts.minGames ?? 30));
  if (few.length) {
    out.push("", `凑齐过但样本不足（不下结论）：`);
    for (const s of few.slice(0, 10)) out.push(`  · ${s.name}：只有 ${s.games} 局`);
  }
  const zero = r.sets.filter((s) => s.games === 0);
  const allZero = zero.length === r.sets.length;
  // 全都凑不齐时上面已经给过完整结论，这里不再重复列一遍
  if (zero.length && !allZero) out.push("", `归档里从未凑齐过的羁绊：${zero.length} 套（不代表弱，只代表没人凑到过）`);
  out.push(
    "",
    allZero
      ? "⚠ 即便如此，「凑齐样本」这件事本身不是随机分配的，将来真凑齐了也只能当相关性看，不能当因果。"
      : "⚠ 和符文榜一样的偏差：谁能凑齐是运气 + 选择共同决定的，样本不是随机分配；这只是相关性，不是因果。"
  );
  return out.join("\n");
}
