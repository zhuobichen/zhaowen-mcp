/**
 * 战斗细节维度：控制、治疗、存活、对目标伤害 —— 也就是「伤害以外」的贡献。
 *
 * 起因是一次字段审计：归档里采集了 34 个统计字段，其中有一批从来没被任何模块读过。
 * 这个模块专治这批「采集了但没分析」的字段。审计结论（实测 38999 行）：
 *   · totalHeal                 99% 有值 → 分析
 *   · timeCCingOthers           93% 有值 → 分析
 *   · longestTimeSpentLiving    99% 有值 → 分析
 *   · damageDealtToObjectives   80% 有值 → 分析
 * 另外两项（totalDamageTaken 承伤 / champLevel 局内等级）是更严的一轮审计查出来的 ——
 * 它们早就在采集列表里、也进了导出的 CSV，但**没有任何模块对它们做判断**。
 * 判据的区别：「被读过」和「被分析过」不是一回事，只在 CSV 里露过面不算分析。
 *   · visionScore               98% 是 0  → **不分析**，海斗没有眼位系统，这个字段在这里没意义
 *   · timeSpentDead             0% 有值   → **不分析**，源里根本没给这个字段（采集列表里声明了但取不到）
 *
 * 口径沿用贡献度那套：按**队内真实名次**分组看胜率，而不是看绝对值 ——
 * 「控制 30 秒」在不同时长的局里意义不同，但「队内第一」是可比。
 *
 * 只读本地归档。
 */
import { archivedGamesFor } from "./archive.js";
import { isMayhemGame } from "./lcu.js";

export interface MetricRow {
  key: string;
  label: string;
  /** 该指标有值的行数占比（用来解释为什么某些指标不分析） */
  coverage: number;
  /** 队内名次 → 胜率 */
  byRank: Array<{ rank: number; games: number; wins: number; winRate: number; delta: number; enough: boolean }>;
  /** 队内第一 vs 队内第四第五的胜率差 */
  spread: number | null;
  /**
   * 该项队内第一的人里，对英雄伤害也队内第一的比例（0~1）。
   * 明显低于 100% 说明这项和「输出」在抢同一份资源 —— 用来解释负相关，
   * 比直接说「这项做多了会输」诚实得多。
   */
  overlapsDamageRank: number | null;
  /** 该项队内第一 vs 垫底的**中位对局时长**（分钟），用来排除「是不是久局造成的」 */
  durationFirst: number | null;
  durationLast: number | null;
  /** 一句话结论 */
  verdict: string;
}

export interface CombatReport {
  playerName: string | null;
  games: number;
  baseWinRate: number;
  metrics: MetricRow[];
  /** 有数据但因为在这个模式下没意义而不分析的字段 */
  excluded: Array<{ key: string; reason: string }>;
  note: string;
}

const METRICS: Array<{ key: string; label: string }> = [
  { key: "timeCCingOthers", label: "控制时间" },
  { key: "totalHeal", label: "治疗量" },
  { key: "longestTimeSpentLiving", label: "最长存活" },
  { key: "damageDealtToObjectives", label: "对目标伤害" },
  // 下面两项是更严的审计（audit:analysis，判据是「有没有被判断过」而不是「被读过」）查出来的：
  // 它们早就采了、也进了 CSV，但没有任何模块对它们做判断。
  { key: "totalDamageTaken", label: "承伤" },
  { key: "champLevel", label: "局内等级" },
];

export async function analyzeCombat(
  opts: { puuid?: string; name?: string; minGames?: number } = {}
): Promise<CombatReport> {
  const games = (await archivedGamesFor("lol")).filter(isMayhemGame);

  let puuid = opts.puuid ?? null;
  let fallback = false;
  if (!puuid) {
    // 没指定人又解析不出身份时，退回「归档里出现最多的账号」。
    // 这时候很可能不是本人（同步过好友的话，好友的局数可能比你多）——
    // 所以要标出来，并且下面不能再自称「你」。
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
      excluded: [],
      note: "归档里没有可用对局。",
    };
  }

  // 每局：我的指标值 + 同队其他人的值
  interface Row {
    win: boolean;
    minutes: number;
    me: Record<string, number>;
    mates: Array<Record<string, number>>;
    /** 我的对英雄伤害在队内的名次（用来算「互斥度」） */
    myDamageRank: number;
  }
  const rows: Row[] = [];
  let playerName: string | null = null;
  // 字段覆盖率（全库，用来解释为什么排除某些指标）
  const cover = new Map<string, { n: number; nonzero: number }>();
  for (const k of [...METRICS.map((m) => m.key), "visionScore", "timeSpentDead"]) {
    cover.set(k, { n: 0, nonzero: 0 });
  }

  for (const g of games) {
    const parts = g.participants ?? [];
    const me = parts.find((p: any) => p.puuid === puuid) as any;
    for (const p of parts) {
      const s: any = p.stats ?? {};
      for (const k of cover.keys()) {
        if (s[k] === undefined) continue;
        const c = cover.get(k)!;
        c.n++;
        if (Number(s[k]) > 0) c.nonzero++;
      }
    }
    if (!me || (me.stats as any)?.win === undefined) continue;
    if (!playerName && (g as any).puuidName) playerName = (g as any).puuidName;

    const mates = parts.filter((p: any) => p.teamId === me.teamId && p.puuid !== puuid) as any[];
    if (mates.length < 2) continue;
    const pick = (p: any) => {
      const s: any = p.stats ?? {};
      const out: Record<string, number> = {};
      for (const m of METRICS) out[m.key] = Number(s[m.key] ?? 0);
      return out;
    };
    const myDmg = Number((me.stats as any).totalDamageDealtToChampions ?? 0);
    const myDamageRank = 1 + mates.filter((p: any) => Number(p.stats?.totalDamageDealtToChampions ?? 0) > myDmg).length;
    rows.push({
      win: (me.stats as any).win === true,
      minutes: Number(g.gameDuration ?? 0) / 60,
      me: pick(me),
      mates: mates.map(pick),
      myDamageRank,
    });
  }

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const base = n ? (wins / n) * 100 : 0;
  const minGames = opts.minGames ?? 15;

  const metrics: MetricRow[] = METRICS.map((m) => {
    const bucket = new Map<number, { g: number; w: number }>();
    for (const r of rows) {
      const mine = r.me[m.key];
      const rank = 1 + r.mates.filter((x) => x[m.key] > mine).length;
      const c = bucket.get(rank) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      bucket.set(rank, c);
    }
    const byRank = [...bucket.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, c]) => {
        const wr = c.g ? (c.w / c.g) * 100 : 0;
        return { rank, games: c.g, wins: c.w, winRate: wr, delta: wr - base, enough: c.g >= minGames };
      });
    const first = byRank.find((x) => x.rank === 1);
    const last = byRank.filter((x) => x.rank >= 4);
    const lastG = last.reduce((s, x) => s + x.games, 0);
    const lastW = last.reduce((s, x) => s + x.wins, 0);
    const okLast = lastG >= minGames;
    const lastRate = lastG ? (lastW / lastG) * 100 : 0;
    const spread = first?.enough && okLast ? first.winRate - lastRate : null;

    // 互斥度：这项队内第一的人里，对英雄伤害也第一的比例
    const firstRows = rows.filter((r) => 1 + r.mates.filter((x) => x[m.key] > r.me[m.key]).length === 1);
    const overlaps = firstRows.length
      ? firstRows.filter((r) => r.myDamageRank === 1).length / firstRows.length
      : null;
    // 时长对照：排除「负相关只是因为这项高的人打得更久」
    const med = (a: number[]) => {
      if (!a.length) return null;
      const t = [...a].sort((x, y) => x - y);
      return t[Math.floor(t.length / 2)];
    };
    const lastRows = rows.filter((r) => 1 + r.mates.filter((x) => x[m.key] > r.me[m.key]).length >= 4);
    const durationFirst = med(firstRows.map((r) => r.minutes));
    const durationLast = med(lastRows.map((r) => r.minutes));

    // 时长差不多就说明负相关不是「久局」造成的，可以直接排除这个解释
    const durSame =
      durationFirst != null && durationLast != null && Math.abs(durationFirst - durationLast) < 2;

    // 退化检测：如果绝大多数局都落在队内第一（并列太多），这个「名次」就没有区分度，
    // 拿它比胜率会得出看着有差、实则无意义的结论。大乱斗的局内等级就是这种情况
    // —— 共享经验，五个人的等级本来就几乎一样。
    const topShare = first && n ? first.games / n : 0;
    const degenerate = topShare > 0.6;

    // 把两个被减数都写出来（第一 X% / 垫底合并 Y% / 差 Z）—— 只说「差 12.7」
    // 读者在表里找不到 12.7 这个数，没法核对。是结论自洽审计提的同一类问题。
    // 带上各自的局数：只报百分比、不报 n，读者没法核对，判据也算不出噪声
    // （「几倍标准误」那套要从 n 和 p 推）。tilt / contribution 的结论都带 n。
    const pair = (a: number, b: number) =>
      `队内第一 ${a.toFixed(1)}%（${first?.games ?? 0} 局） / 第 4 名及以后合并 ${b.toFixed(1)}%（${lastG} 局）`;

    let verdict: string;
    if (degenerate) {
      verdict =
        `**这个指标在这里没有区分度**：${first!.games}/${n} 局（${(topShare * 100).toFixed(0)}%）你都排队内第一 ` +
        `—— 说明五个人的这项数值几乎一样（并列按同名次算就会都落进第一档），` +
        `拿它分档比胜率没有意义。这一项不做结论。`;
    } else if (spread == null) {
      verdict = "样本不足（队内第一或垫底的场次不够），不下结论。";
    } else {
      // 判据按**标准误倍数**，不用固定的 5 个百分点。
      // 和 lib/tilt.ts / lib/contribution.ts 同一个毛病、同一个改法：
      // 同一个 5pp，在 400 局的组里是实的，在 30 局的组里连一个标准误都不到。
      // 这三处原先都是固定阈值，comps.ts 的「4 个标准误」才是本仓库的正确样板。
      const gap = Math.abs(spread);
      const se = Math.sqrt(
        Math.max(first!.winRate * (100 - first!.winRate), 1) / first!.games +
          Math.max(lastRate * (100 - lastRate), 1) / Math.max(lastG, 1)
      );
      const k = se > 0 ? gap / se : 0;
      const head = `${pair(first!.winRate, lastRate)}，差 ${spread.toFixed(1)} 个百分点（约是噪声的 ${k.toFixed(2)} 倍）`;
      if (k < 1.5) {
        verdict = `${head} —— 看不出这项与胜负有关。`;
      } else if (k < 2.5) {
        // 卡在线上：说「看不出」太轻、说「赢得更多」太满
        verdict = `${head} —— **正好卡在「分得开」的线上**，先当倾向，别当结论。`;
      } else if (spread > 0) {
        verdict = `${head} —— 这项做得多，赢得更多。`;
      } else {
        const parts = [`${head}，第一反而更低`];
        if (durSame) parts.push(`两队的中位时长几乎一样（${durationFirst?.toFixed(0)} 分），所以不是「久局拖出来的」`);
        if (overlaps != null && overlaps < 0.7) {
          parts.push(
            `而且这项队内第一的人里只有 ${(overlaps * 100).toFixed(0)}% 对英雄伤害也第一 —— ` +
              `说明它和「输出」在抢同一份注意力，多半是资源投到了别处，而不是「做这件事会输」`
          );
        }
        verdict = parts.join("；") + "。";
      }
    }

  const c = cover.get(m.key)!;
  return {
    key: m.key,
    label: m.label,
    coverage: c.n ? c.nonzero / c.n : 0,
    byRank,
    spread,
    overlapsDamageRank: overlaps,
    durationFirst,
    durationLast,
    verdict,
  };
});

// 排除的字段：给出可核对的原因，而不是默默不分析
const excluded: CombatReport["excluded"] = [];
const vis = cover.get("visionScore")!;
if (vis.n && vis.nonzero / vis.n < 0.1) {
  excluded.push({
    key: "visionScore",
    reason: `归档 ${vis.n} 行里只有 ${vis.nonzero} 行非零（${((vis.nonzero / vis.n) * 100).toFixed(0)}%）—— 海斗没有眼位系统，这个字段在这里没有意义，不分析。`,
  });
}
const dead = cover.get("timeSpentDead")!;
if (!dead.n) {
  excluded.push({
    key: "timeSpentDead",
    reason: "归档里 0 行有值 —— 采集列表里声明了这个字段，但数据源（SGP/LCU）实际上没给，取不到就不编。",
  });
}

return {
  playerName,
  games: n,
  baseWinRate: base,
  metrics,
  excluded,
  note:
    (fallback
      ? `⚠ 没有指定账号、也解析不出身份，以下用的是**归档里出现最多的那个账号**（可能是好友，不一定是本人）。`
      : "") +
    `样本：归档里 ${n} 把有该账号、且有同队至少 3 人的海斗对局，该账号整体胜率 ${base.toFixed(1)}%。` +
    `统计口径是**队内真实名次**（同队 5 人里排第几，并列算同名次）—— ` +
    `「控制 30 秒」在不同时长的局里意义不同，但「队内第一」可比。` +
    `样本 <${minGames} 局的分组不下结论。` +
    `⚠ 同 contribution：赢得顺的局大家数据都好看，所以只能说相关。`,
};
}

/** 文本输出 */
export async function combatText(opts: { puuid?: string; name?: string; minGames?: number } = {}): Promise<string> {
let r: CombatReport;
try {
  r = await analyzeCombat(await resolveTarget(opts));
} catch (e: any) {
  return `读取失败：${e?.message ?? e}`;
}
const out: string[] = [];
out.push(`${r.playerName ?? "（归档里出现最多的账号）"} · 伤害以外的贡献`);
out.push(r.note);
out.push("");
if (!r.games) return out.join("\n");

out.push("为什么分析这几项：做了一次字段审计，归档里采集了 34 个统计字段，");
out.push("其中这批从来没被任何模块读过。审计结果（实测覆盖率）如下。", "");

for (const m of r.metrics) {
  out.push(`${m.label}（有值行数占比 ${(m.coverage * 100).toFixed(0)}%）：${m.verdict}`);
  for (const b of m.byRank) {
    out.push(
      `  队内第 ${b.rank} 名：${b.games} 局 ${b.winRate.toFixed(1)}%（比整体 ${b.delta >= 0 ? "+" : ""}${b.delta.toFixed(1)}）${b.enough ? "" : " ← 样本少"}`
    );
  }
    // 结论里说的「与垫底差 X 个百分点」是**第 4/5 名合并**算的，表里只有分开的两行 ——
    // 不把这行打出来，读者没法核对结论（结论自洽审计查出来的，和 contribution 同一类问题）。
    const low = m.byRank.filter((b) => b.rank >= 4);
    const lg = low.reduce((s2, b) => s2 + b.games, 0);
    if (lg > 0) {
      const lw = low.reduce((s2, b) => s2 + b.wins, 0);
      out.push(`  └ 第 4 名及以后合并：${lg} 局 ${((lw / lg) * 100).toFixed(1)}%`);
      // 结论里引用的「差 X 个百分点」必须能在明细里找到 —— 否则读者没法核对。
      // 是结论自洽审计（audit:verdict）提出来的：改了结论的措辞让它带上符号之后，
      // 明细里只有两端的百分比、没有这个差值，审计就报「-7.5 在明细里找不到」。
      if (m.spread != null) {
        out.push(`  └ 队内第一 − 第 4 名及以后：差 ${m.spread.toFixed(1)} 个百分点`);
      }
    }
    out.push("");
  }

  if (r.excluded.length) {
    out.push("采了但不分析的字段（原因可核对）：");
    for (const e of r.excluded) out.push(`  · ${e.key}：${e.reason}`);
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
