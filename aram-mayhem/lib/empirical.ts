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

/** 把归档里所有「带符文的海斗参与者行」扫一遍，交给回调聚合 */
async function scan<T>(init: () => T, visit: (t: T, augments: number[], win: boolean) => void): Promise<{ acc: T; games: number; rows: number }> {
  const games = (await archivedGamesFor("lol")).filter(isMayhemGame);
  const acc = init();
  let rows = 0;
  for (const g of games) {
    for (const p of g.participants ?? []) {
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

  const line = (p: EmpiricalPair) =>
    `  · ${p.a} + ${p.b}：${p.games} 局 ${pct(p.winRate)}` +
    `（单拿分别 ${pct(p.soloA)} / ${pct(p.soloB)} → 协同 ${signed(p.synergy)}）`;

  out.push(`协同最强（一起拿 > 分开拿）：`);
  for (const p of r.pairs.slice(0, top)) out.push(line(p));
  out.push("", `协同最弱（一起拿反而更差）：`);
  for (const p of r.pairs.slice(-Math.min(10, top))) out.push(line(p));
  out.push(
    "",
    "怎么读：「协同」是正数才说明 1+1>2；负数往往是两个符文抢同一件装备/同一个流派，或者只是样本少。",
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
