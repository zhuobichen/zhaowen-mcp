/**
 * 贡献度与胜负的关系：你在队里打第几，跟赢不赢有没有关系。
 *
 * 回答的是一个很实际的问题 ——「我是必须 carry 才能赢，还是躺着也能赢？」
 * 具体做法：每局把你和**同队其他 4 人**的关键指标排名（伤害 / 金币 / KDA / 补刀），
 * 再看不同排名下你的胜率。
 *
 * 注意这不是因果，而且有内生的反向关系：赢得快/顺的局大家数据都好看，
 * 落后方的数据会被压制 —— 所以「伤害第一时胜率高」既可能是「你 carry 才赢」，
 * 也可能是「赢的局你自然伤害高」。输出里会写明，并给一个能分辨两者的补充指标：
 * 队友伤害也高时你赢不赢（说明是不是「全队都顺」）。
 *
 * 只读；数据来自本地归档（带完整 10 人名单的局）。
 */
import { archivedGamesFor } from "./archive.js";
import { isMayhemGame } from "./lcu.js";

export interface RankBucket {
  /** 队内排名（1 = 最高） */
  rank: number;
  games: number;
  wins: number;
  winRate: number;
  /** 相对你整体胜率的差（百分点） */
  delta: number;
  enough: boolean;
}

export interface MetricContribution {
  metric: "damage" | "gold" | "kda" | "cs";
  label: string;
  buckets: RankBucket[];
  /** 排名第 1 与排名第 5 的胜率差（百分点），越大说明越依赖这项 */
  spread: number;
  note: string;
}

export interface ContributionReport {
  playerName: string | null;
  games: number;
  baseWinRate: number;
  metrics: MetricContribution[];
  /** 队友伤害也高（前二）时你的胜率 —— 用来区分「你 carry」和「全队都顺」 */
  teamAlsoStrong: { games: number; winRate: number } | null;
  /** 你伤害队内第一、且队友也不算差时，胜率有没有掉下来 */
  verdict: string;
  note: string;
}

type Stats = { damage: number; gold: number; kda: number; cs: number };
type Row = {
  damage: number;
  gold: number;
  kda: number;
  cs: number;
  win: boolean;
  /** 同队其他每个人的同项数值，用来算**真实队内排名**（1~5） */
  mates: Stats[];
};

export async function analyzeContribution(
  opts: { puuid?: string; name?: string; minGames?: number } = {}
): Promise<ContributionReport> {
  const games = (await archivedGamesFor("lol")).filter(isMayhemGame);

  // 身份：优先显式 puuid，否则取归档里出现最多的账号
  let puuid = opts.puuid ?? null;
  let fallback = false;
  if (!puuid) {
    fallback = true;
    const tally = new Map<string, number>();
    for (const g of games) for (const p of g.participants ?? []) if (p.puuid) tally.set(p.puuid, (tally.get(p.puuid) ?? 0) + 1);
    puuid = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  if (!puuid) {
    return {
      playerName: null,
      games: 0,
      baseWinRate: 0,
      metrics: [],
      teamAlsoStrong: null,
      verdict: "归档里没有可用对局。",
      note: "归档里没有可用对局。",
    };
  }

  const rows: Row[] = [];
  let playerName: string | null = null;

  for (const g of games) {
    const parts = g.participants ?? [];
    if (parts.length < 4) continue;
    const me = parts.find((p: any) => p.puuid === puuid);
    const s: any = me?.stats ?? {};
    if (!me || s.win === undefined) continue;
    if (!playerName && (g as any).puuidName) playerName = (g as any).puuidName;

    const num = (v: unknown) => Number(v ?? 0);
    const kdaOf = (x: any) => (num(x.kills) + num(x.assists)) / Math.max(num(x.deaths), 1);
    const mates = parts
      .filter((p: any) => p.teamId === me.teamId && p.puuid !== puuid)
      .map((p: any) => {
        const st: any = p.stats ?? {};
        return {
          damage: num(st.totalDamageDealtToChampions),
          gold: num(st.goldEarned),
          kda: kdaOf(st),
          cs: num(st.totalMinionsKilled),
        };
      });
    if (mates.length < 2) continue;

    rows.push({
      damage: num(s.totalDamageDealtToChampions),
      gold: num(s.goldEarned),
      kda: kdaOf(s),
      cs: num(s.totalMinionsKilled),
      win: s.win === true,
      mates,
    });
  }

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const base = n ? (wins / n) * 100 : 0;
  const minGames = opts.minGames ?? 15;

  const buildMetric = (metric: keyof Omit<Row, "win" | "mates">, label: string, note: string): MetricContribution => {
    // 队内排名 = 同队里比我高的人数 + 1（严格大于，并列算同名次）
    const m = new Map<number, { g: number; w: number }>();
    for (const r of rows) {
      const rank = 1 + r.mates.filter((x) => x[metric] > r[metric]).length;
      const c = m.get(rank) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      m.set(rank, c);
    }
    const buckets: RankBucket[] = [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, c]) => {
        const wr = c.g ? (c.w / c.g) * 100 : 0;
        return { rank, games: c.g, wins: c.w, winRate: wr, delta: wr - base, enough: c.g >= minGames };
      });
    const ok = buckets.filter((b) => b.enough);
    return {
      metric: metric as MetricContribution["metric"],
      label,
      buckets,
      spread: ok.length >= 2 ? ok[ok.length - 1].winRate - ok[0].winRate : 0,
      note,
    };
  };

  const metrics = [
    buildMetric("damage", "伤害", "你对英雄造成的伤害是不是全队最高"),
    buildMetric("gold", "金币", "你的总金币是不是全队最高"),
    buildMetric("kda", "KDA", "(击杀+助攻)/死亡 是不是全队最高"),
    buildMetric("cs", "补刀", "补刀数是不是全队最高"),
  ];

  // 「全队都顺」对照：你是伤害第一、且队友最高伤害也过 2 万时，胜率如何
  const strong = rows.filter((r) => r.damage > Math.max(...r.mates.map((m) => m.damage)) && Math.max(...r.mates.map((m) => m.damage)) >= 20000);
  const teamAlsoStrong = strong.length >= minGames
    ? { games: strong.length, winRate: (strong.filter((r) => r.win).length / strong.length) * 100 }
    : null;

  const dmg = metrics[0];
  const top = dmg.buckets.find((b) => b.rank === 1);
  // 「没进前二」= 排名 3 及以后合并
  const low = dmg.buckets.filter((b) => b.rank >= 3);
  const lowGames = low.reduce((s2, b) => s2 + b.games, 0);
  const lowWins = low.reduce((s2, b) => s2 + b.wins, 0);
  let verdict: string;
  if (!top?.enough || lowGames < minGames) {
    verdict = `样本不够：伤害排名分组的样本不足 ${minGames} 局，不下结论。`;
  } else {
    const lowWr = (lowWins / lowGames) * 100;
    verdict =
      `你伤害**全队第一**时 ${top.games} 局 ${top.winRate.toFixed(1)}%（比整体 ${top.delta >= 0 ? "+" : ""}${top.delta.toFixed(1)}），` +
      `**排到第三及以后**时 ${lowGames} 局 ${lowWr.toFixed(1)}%（${lowWr - base >= 0 ? "+" : ""}${(lowWr - base).toFixed(1)}）。` +
      (Math.abs(top.winRate - lowWr) < 5
        ? "两者差不多 —— 你赢不赢跟「你是不是输出第一」关系不大，队伍整体更重要。"
        : top.winRate > lowWr
          ? "差得明显 —— 你打出全队最高伤害时赢面更大，说明你偏向「得自己 carry」的打法。"
          : "反过来了：伤害第一时反而更容易输 —— 可能是你吃了太多资源却没转化成胜势，或者队友跟不上。");
    if (teamAlsoStrong) {
      verdict +=
        `\n补充对照：你伤害最高、且队友最高伤害也过 2 万（全队都顺）时 ${teamAlsoStrong.games} 局 ${teamAlsoStrong.winRate.toFixed(1)}% —— ` +
        "拿它和「只有你高」比，能区分是「你 carry」还是「全队都顺」。";
    }
  }

  return {
    playerName,
    games: n,
    baseWinRate: base,
    metrics,
    teamAlsoStrong,
    verdict,
    note:
      (fallback
        ? `⚠ 没有指定账号、也解析不出身份，以下用的是**归档里出现最多的那个账号**（可能是好友，不一定是本人）。`
        : "") +
      `样本：归档里 ${n} 把有该账号、且有同队至少 3 人的海斗对局，该账号整体胜率 ${base.toFixed(1)}%。` +
      `排名是**真实队内名次**（同队 5 人里排第几，并列算同名次）。` +
      `⚠ 反向因果：赢得顺的局大家数据都好看，所以这里只能说相关，不能说「伤害高所以赢」。`,
  };
}

/** 文本输出 */
export async function contributionText(opts: { puuid?: string; name?: string; minGames?: number } = {}): Promise<string> {
  let r: ContributionReport;
  try {
    r = await analyzeContribution(await resolveTarget(opts));
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const out: string[] = [];
  out.push(`${r.playerName ?? "（归档里出现最多的账号）"} · 贡献度与胜负`);
  out.push(r.note);
  out.push("");
  if (!r.games) return out.join("\n");

  out.push(`结论：${r.verdict}`);
  out.push("");
  for (const m of r.metrics) {
    out.push(`${m.label}：`);
    for (const b of m.buckets) {
      out.push(
        `  队内第 ${b.rank} 名：${b.games} 局 ${b.winRate.toFixed(1)}%` +
          `（比整体 ${b.delta >= 0 ? "+" : ""}${b.delta.toFixed(1)}）${b.enough ? "" : " ← 样本少"}`
      );
    }
    // 结论里引用的是「排到第三及以后」这个**合并**口径的数字。如果不把它也打出来，
    // 读者在表里只能看到第 3/4/5 三行分开的数，没法核对结论 —— 是结论自洽审计查出来的。
    const low = m.buckets.filter((b) => b.rank >= 3);
    const lg = low.reduce((s, b) => s + b.games, 0);
    if (lg > 0) {
      const lw = low.reduce((s, b) => s + b.wins, 0);
      const wr = (lw / lg) * 100;
      out.push(
        `  └ 第 3 名及以后合并：${lg} 局 ${wr.toFixed(1)}%（比整体 ${wr - r.baseWinRate >= 0 ? "+" : ""}${(wr - r.baseWinRate).toFixed(1)}）`
      );
    }
  }
  return out.join("\n");
}

async function resolveTarget(opts: { puuid?: string; name?: string }): Promise<{ puuid?: string; name?: string }> {
  if (opts.puuid) return { puuid: opts.puuid, name: opts.name };
  if (opts.name) {
    const { resolveAccountByName } = await import("./identity.js");
    const r = await resolveAccountByName(opts.name);
    if (!r.matches.length) throw new Error(`没找到「${opts.name}」——${r.note}`);
    return { puuid: r.matches[0].puuid, name: r.matches[0].name };
  }
  const { resolveMe } = await import("./identity.js");
  const me = await resolveMe();
  return me ? { puuid: me.puuid, name: me.name } : {};
}
