/**
 * 英雄克制 / 对位分析。
 *
 * 海斗是随机发牌，你**不能**临场反选英雄，所以这里不叫「克制建议」，只回答两个能改变打法的经验问题：
 *   1) 对面有谁的时候你整体最容易输（谁是你的克星）—— 提醒你在那种局里改出装/改打法；
 *   2) 你玩某个英雄时，遇到谁胜率明显偏低 —— 同英雄对位差异，说明问题出在打法而不是英雄本身。
 *
 * 数据来源：对局记录里的完整 10 人名单（SGP 提供）。本地客户端那种只记录自己一行的对局
 * 无法统计对位，会如实标注覆盖率。样本量小的组合一律不排名（避免把噪声当结论）。
 *
 * 只读，不涉及任何写操作。
 */
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export interface VersusStat {
  champion: string;
  /** 你在对面见到该英雄的局数（整体视角）/ 该对位局数（英雄视角） */
  games: number;
  wins: number;
  winRate: number;
  /** 相对你自己基准胜率的差值（百分点），正=打得比平均好 */
  delta: number;
  /** 该英雄的社区站胜率（国服口径优先，%）。用来区分「它本身强」和「我特别怕它」 */
  championWinRate: number | null;
  /**
   * 残差（百分点）= 你的实际胜率 − 该英雄的整体胜率。
   * 负得多说明：扣掉「这个英雄本身强」之后，你还是额外打不过它 —— 这才是真正的克星信号。
   * 注意这是近似：社区站胜率统计的是该英雄在**己方**时的表现，这里是它在**对面**时的表现。
   */
  residual: number | null;
}

export interface ChampionMatchup {
  champion: string;
  games: number;
  winRate: number;
  /** 样本足够的对位，按胜率升序（最怕的在前） */
  worst: VersusStat[];
  best: VersusStat[];
}

export interface MatchupReport {
  name: string;
  games: number;
  /** 有完整 10 人名单、可统计对位的局数 */
  gamesWithFullRoster: number;
  /** 本人基准胜率（所有可统计对位的局） */
  baseWinRate: number;
  /** 整体视角：对面出现该英雄时你的胜率 */
  versusAll: VersusStat[];
  /** 英雄视角：至少打过 minChampionGames 局的英雄 */
  byChampion: ChampionMatchup[];
  note: string;
}

/** 数字英雄 id → 中文常用名（取自官方 champion-ids 快照，回退到社区站英雄名） */
function championName(championId: number): string {
  const d = loadData();
  const cid = d.championIds[String(championId)];
  if (!cid) return `英雄#${championId}`;
  return d.championById.get(cid.id)?.name ?? cid.name;
}

/** 英雄的社区站胜率（%，国服口径优先）—— 用来把「它本身强」从对位数据里扣掉 */
function globalWinRateOf(championId: number): number | null {
  const d = loadData();
  const cid = d.championIds[String(championId)];
  if (!cid) return null;
  const c = d.championById.get(cid.id);
  if (!c) return null;
  if (typeof c.cnWinRate === "number" && Number.isFinite(c.cnWinRate)) return c.cnWinRate * 100;
  if (c.winRate) {
    const v = parseFloat(c.winRate);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/** 同一个英雄在不同对局里的数字 id 是稳定的，这里缓存一下免得到处查 */
const globalRateCache = new Map<number, number | null>();
function cachedGlobalWinRate(championId: number): number | null {
  if (!globalRateCache.has(championId)) globalRateCache.set(championId, globalWinRateOf(championId));
  return globalRateCache.get(championId) ?? null;
}

export async function analyzeMatchups(
  opts: { who?: string; games?: number; minGames?: number; minChampionGames?: number; puuid?: string; name?: string } = {}
): Promise<MatchupReport> {
  let puuid: string;
  let name: string;
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

  /** 对面英雄 id → 战绩（整体视角） */
  const versus = new Map<number, { games: number; wins: number }>();
  /** 我的英雄 id → 对面英雄 id → 战绩（英雄视角） */
  const byChamp = new Map<number, { games: number; wins: number; versus: Map<number, { games: number; wins: number }> }>();
  let fullRoster = 0;

  for (const g of all) {
    const parts = g.participants ?? [];
    if (parts.length < 2) continue; // 只有自己一行的局统计不了对位
    const mePart = parts.find((p: any) => p.puuid === puuid);
    if (!mePart?.stats) continue;
    fullRoster++;
    const win = mePart.stats.win === true;
    const myTeam = mePart.teamId;
    const myChampId = Number(mePart.championId);

    const myEntry =
      byChamp.get(myChampId) ?? { games: 0, wins: 0, versus: new Map<number, { games: number; wins: number }>() };
    myEntry.games++;
    if (win) myEntry.wins++;

    for (const p of parts) {
      if (p.teamId === myTeam || !p.championId) continue;
      const foe = Number(p.championId);

      const v = versus.get(foe) ?? { games: 0, wins: 0 };
      v.games++;
      if (win) v.wins++;
      versus.set(foe, v);

      const mv = myEntry.versus.get(foe) ?? { games: 0, wins: 0 };
      mv.games++;
      if (win) mv.wins++;
      myEntry.versus.set(foe, mv);
    }
    byChamp.set(myChampId, myEntry);
  }

  const totalWins = [...byChamp.values()].reduce((s, c) => s + c.wins, 0);
  const baseWinRate = fullRoster ? (totalWins / fullRoster) * 100 : 0;

  /** 把原始计数换算成一条对位统计，并扣掉该英雄自身的强度 */
  const toStat = (championId: number, v: { games: number; wins: number }, base: number): VersusStat => {
    const winRate = v.games ? (v.wins / v.games) * 100 : 0;
    const championWinRate = cachedGlobalWinRate(championId);
    return {
      champion: championName(championId),
      games: v.games,
      wins: v.wins,
      winRate,
      delta: v.games ? winRate - base : 0,
      championWinRate,
      residual: championWinRate != null && v.games ? winRate - championWinRate : null,
    };
  };

  const minGames = opts.minGames ?? 12;
  const versusAll: VersusStat[] = [...versus.entries()]
    .map(([id, v]) => toStat(id, v, baseWinRate))
    .filter((x) => x.games >= minGames)
    .sort((a, b) => (a.residual ?? a.delta) - (b.residual ?? b.delta) || b.games - a.games);

  const minChampionGames = opts.minChampionGames ?? 15;
  const perPair = opts.minGames ?? 5;
  const byChampion: ChampionMatchup[] = [...byChamp.entries()]
    .filter(([, v]) => v.games >= minChampionGames)
    .map(([id, v]) => {
      const rate = v.games ? (v.wins / v.games) * 100 : 0;
      const pairs: VersusStat[] = [...v.versus.entries()]
        .filter(([, m]) => m.games >= perPair)
        .map(([fid, m]) => toStat(fid, m, rate));
      return {
        champion: championName(id),
        games: v.games,
        winRate: rate,
        worst: [...pairs].sort((a, b) => a.winRate - b.winRate || b.games - a.games).slice(0, 3),
        best: [...pairs].sort((a, b) => b.winRate - a.winRate || b.games - a.games).slice(0, 3),
      };
    })
    .sort((a, b) => b.games - a.games);

  return {
    name,
    games: all.length,
    gamesWithFullRoster: fullRoster,
    baseWinRate,
    versusAll,
    byChampion,
    note:
      `${all.length} 把海斗里 ${fullRoster} 把有完整 10 人名单可统计对位` +
      (fullRoster < all.length ? `（其余 ${all.length - fullRoster} 把只有自己那一行）` : "") +
      `；基准胜率 ${baseWinRate.toFixed(1)}%。对面英雄只列出现 ≥${minGames} 次的，` +
      `英雄视角只列你玩过 ≥${minChampionGames} 把的英雄、单个对位 ≥${perPair} 次。`,
  };
}

/** 给人看的文本报告 */
export async function matchupsText(
  opts: { who?: string; minGames?: number; minChampionGames?: number } = {}
): Promise<string> {
  let r: MatchupReport;
  try {
    r = await analyzeMatchups(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }

  const out: string[] = [];
  out.push(`${r.name} · 英雄对位分析`);
  out.push(r.note);
  out.push("");

  // 主榜按「残差」排：扣掉该英雄本身强度之后你还打不过的，才是真的克星
  const worst = r.versusAll.slice(0, 8);
  const best = [...r.versusAll]
    .sort((a, b) => (b.residual ?? b.delta) - (a.residual ?? a.delta) || b.games - a.games)
    .slice(0, 8);

  const line = (v: VersusStat) => {
    const base =
      `  · 对面有 ${v.champion}：${v.games} 把 · 你 ${v.winRate.toFixed(0)}%` +
      `（比你自己基准 ${v.delta >= 0 ? "+" : ""}${v.delta.toFixed(1)}）`;
    if (v.residual == null) return base;
    return (
      base +
      ` · 它本身胜率 ${v.championWinRate!.toFixed(0)}% → 残差 ${v.residual >= 0 ? "+" : ""}${v.residual.toFixed(1)}`
    );
  };

  out.push(`你的克星（按「扣掉该英雄自身强度后的残差」排，你的基准胜率 ${r.baseWinRate.toFixed(1)}%）：`);
  for (const v of worst) out.push(line(v));
  if (!worst.length) out.push("  （样本不足，没有出现 ≥ 阈值的对手英雄）");

  out.push("", "对面有谁时你最稳（同样按残差排）：");
  for (const v of best) out.push(line(v));

  if (r.byChampion.length) {
    out.push("", "分英雄看（你玩这个英雄时的对位差异）：");
    for (const c of r.byChampion.slice(0, 5)) {
      out.push(`  ${c.champion}：${c.games} 把 ${c.winRate.toFixed(0)}%`);
      if (c.worst.length) out.push(`    最怕：${c.worst.map((v) => `${v.champion}(${v.games}把${v.winRate.toFixed(0)}%)`).join("、")}`);
      if (c.best.length) out.push(`    最稳：${c.best.map((v) => `${v.champion}(${v.games}把${v.winRate.toFixed(0)}%)`).join("、")}`);
    }
  }

  out.push(
    "",
    "说明：海斗随机发牌，你无法临场换英雄，所以这份数据不是「该选谁」，而是告诉你——",
    "在什么样的对局里需要改出装或改打法。样本量小的组合会被过滤掉，不做排名。",
    "「残差」= 你对它的胜率 − 它自己的社区站胜率。一个英雄本身胜率就高（比如 56%），你打不过它很正常；",
    "残差才是超出它自身强度的部分。注意这是近似：社区站胜率统计的是该英雄在**己方**时的表现。"
  );
  return out.join("\n");
}
