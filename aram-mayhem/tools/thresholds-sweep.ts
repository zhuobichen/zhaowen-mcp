/**
 * 门槛扫描：把某个门槛从小到大扫一遍，看**报出来的效应**怎么变。
 *
 * 用途：`docs/THRESHOLDS.md` 里 21 条理由是「未说明」—— 那些数没人知道该是多少。
 * 这个探针是唯一能让它们收敛的办法：拿真实归档跑一遍，看效应随门槛的变化曲线。
 *
 * 怎么读结果：
 *   · 效应随门槛上升**一直在变小** → 之前大是因为把噪声算进去了，门槛太低
 *   · 效应**很快就稳在一个值附近** → 那个值是真的，门槛只要够到拐点就够
 *   · 存活条目数随门槛陡掉 → 门槛再高就没东西可说了，得权衡
 * 同时给出**该门槛下的标准误**：效应没超过 2 倍标准误的，就是跟噪声分不开。
 *
 * 跑：npm run thresholds:sweep
 */
import { analyzeContribution } from "../lib/contribution.js";
import { analyzeComps } from "../lib/comps.js";
import { analyzeTilt } from "../lib/tilt.js";
import { analyzeMatchups } from "../lib/matchups.js";
import { analyzeBuilds } from "../lib/builds.js";
import { queueStats } from "../lib/queue-stats.js";
import { tftDetail } from "../lib/tft-detail.js";
import { analyzeCounters } from "../lib/counters.js";
import { analyzeSocial } from "../lib/social.js";
import { resolveMe } from "../lib/identity.js";

const SWEEP = [5, 8, 10, 12, 15, 20, 30, 40, 60, 80, 120, 200];

// 必须先拿准是谁。这些分析函数**不传 puuid 时会挑「归档里出现最多的账号」** ——
// 第一版就是这么写的，结果量的是另一个号（1060 局），跟工具报的（那个号 306 局）差了三倍，
// 而两者的 playerName 都写着同一个名字，光看输出看不出来。
// 内部调用方（checkup / report）都传了 puuid，所以产品侧没问题；是探针自己错了。
const me = await resolveMe();
if (!me?.puuid) {
  console.error("拿不到当前账号（客户端没开且没固定过）：这些分析必须指定是谁，先跑一次 get_my_account_status。");
  process.exit(1);
}
const WHO = { puuid: me.puuid, name: me.name };
console.log(`账号：${me.name}（${me.source}）`);

/** 两个比例之差的标准误（百分点） */
function seOfDiff(n1: number, p1: number, n2: number, p2: number): number {
  if (n1 < 1 || n2 < 1) return Number.NaN;
  return Math.sqrt((p1 * (100 - p1)) / n1 + (p2 * (100 - p2)) / n2);
}

function table(title: string, unit: string, rows: Array<{ n: number; alive: string; effect: number | null; se: number | null }>) {
  console.log(`\n=== ${title} ===`);
  console.log("  门槛   存活                效应(" + unit + ")   标准误   效应/标准误");
  for (const r of rows) {
    const e = r.effect == null ? "  —  " : r.effect.toFixed(1).padStart(5);
    const s = r.se == null ? "  —  " : r.se.toFixed(1).padStart(5);
    const ratio = r.effect != null && r.se ? (Math.abs(r.effect) / r.se).toFixed(1).padStart(6) : "   —  ";
    console.log(`  ${String(r.n).padStart(4)}   ${r.alive.padEnd(18)} ${e}     ${s}     ${ratio}`);
  }
}

console.log("门槛扫描（数据源：本地归档，实时读）");
console.log("效应/标准误 > 2 才算跟噪声分得开；< 2 的那些行，结论撑不起来。");

// ---- 1. contribution：伤害队内第一 vs 第 3 名及以后**合并**
//
// 必须复现工具自己的口径 —— 第一版这里比的是「第 1 档 vs 最后一档」，跟结论里那句
// 「排到第三及以后」不是一回事，量出来的效应（3.6pp）和结论引用的（12.6pp）差了三倍。
// 度量口径错了，整张表就没意义。
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await analyzeContribution({ ...WHO, minGames: n });
    const m = r.metrics.find((x) => x.metric === "damage");
    if (!m) continue;
    const first = m.buckets.find((x) => x.rank === 1);
    const low = m.buckets.filter((x) => x.rank >= 3);
    const lowGames = low.reduce((s, b) => s + b.games, 0);
    const lowWins = low.reduce((s, b) => s + b.wins, 0);
    const lowWr = lowGames ? (lowWins / lowGames) * 100 : 0;
    const gated = !first?.enough || lowGames < n;
    rows.push({
      n,
      alive: gated ? `不下结论（门槛未达）` : `第一 ${first.games} 局 vs 第三+ ${lowGames} 局`,
      effect: gated ? null : first.winRate - lowWr,
      se: gated ? null : seOfDiff(first.games, first.winRate, lowGames, lowWr),
    });
  }
  table("contribution：伤害第 1 名 − 第 3 名及以后（与结论同口径）", "pp", rows);
}

// ---- 2. comps：对面标签之间的胜率极差
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await analyzeComps({ ...WHO, minGames: n });
    const ok = r.present.filter((x) => x.enough);
    const lo = ok.reduce<(typeof ok)[number] | null>((a, x) => (!a || x.winRate < a.winRate ? x : a), null);
    const hi = ok.reduce<(typeof ok)[number] | null>((a, x) => (!a || x.winRate > a.winRate ? x : a), null);
    rows.push({
      n,
      alive: `${ok.length} 类标签够样本`,
      effect: lo && hi ? hi.winRate - lo.winRate : null,
      se: lo && hi ? seOfDiff(lo.games, lo.winRate, hi.games, hi.winRate) : null,
    });
  }
  table("comps：对面 6 类标签里最高 − 最低 的胜率极差", "pp", rows);
}

// ---- 3. tilt：连败之后那一把，偏离基准最大的那档
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await analyzeTilt({ ...WHO, minGames: n });
    const ok = r.afterLoss.filter((x) => x.enough);
    let worst: { delta: number; games: number; winRate: number } | null = null;
    for (const b of ok) if (!worst || Math.abs(b.delta) > Math.abs(worst.delta)) worst = b;
    rows.push({
      n,
      alive: `${ok.length} 档连败桶够样本`,
      effect: worst?.delta ?? null,
      se: worst ? seOfDiff(worst.games, worst.winRate, r.games, r.baseWinRate) : null,
    });
  }
  table("tilt：连败后那一把偏离基准最大的档", "pp", rows);
}

// ---- 4. matchups：对面英雄条目数与最差残差
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await analyzeMatchups({ ...WHO, minGames: n });
    const x = r.versusAll[0];
    rows.push({
      n,
      alive: `${r.versusAll.length} 个对面英雄够样本`,
      effect: x?.residual ?? null,
      se: x ? seOfDiff(x.games, x.winRate, 100, 50) : null, // 对手是「该英雄的社区站胜率」，样本量未知，用 100 做数量级参考
    });
  }
  table("matchups：残差最负的那个英雄（负=比你该赢的更差）", "pp", rows);
}

// ---- 5~10. 其余带样本门槛的分析：量的是「门槛卡掉多少条目」+「幸存的那些撑不撑得起结论」
//
// 这些模块的结论形式各不相同，所以这里只取一个**共同可比的量**：
// 幸存条目数 + 幸存者里最高与最低之间的差（以及它的标准误）。
//
// ⚠ **这个「极差」是最大值统计量，不能当成效应量读。**
// 条目越多、极差越大是构造性的 —— 从 40 条里挑最高和最低两个，比率天然会超过 2，
// 哪怕每一条都纯是噪声。所以 builds / counters 那两栏的「效应/标准误」列**不要**解读成
// 「有真效应」；它们能说明的只有一件事：**极差随门槛上升一路缩小**（69→58→36→25→13），
// 那是典型的「低门槛把噪声算进来了」的特征。
//
// 这一栏真正可靠的用法是**看门槛会不会改变幸存集合**：
// 若门槛从 5 扫到 60 幸存条目数几乎不动，说明「定多少都一样」—— 那本身就是答案。
// （queue-stats 就是这个情况：只有一个队列够样本。）

/** 通用：给一组「有 games / 有比率」的条目，算幸存数与极差的标准误 */
function summarize2<T extends { games: number }>(
  items: T[],
  rateOf: (x: T) => number | null,
  n: number
) {
  const alive = items.filter((x) => x.games >= n);
  const withRate = alive.filter((x) => rateOf(x) != null);
  if (withRate.length < 2) return { alive: `${alive.length} 条够样本（不够比极差）`, effect: null, se: null };
  const hi = withRate.reduce((a, x) => (rateOf(x)! > rateOf(a)! ? x : a));
  const lo = withRate.reduce((a, x) => (rateOf(x)! < rateOf(a)! ? x : a));
  return {
    alive: `${alive.length} 条够样本`,
    effect: rateOf(hi)! - rateOf(lo)!,
    se: seOfDiff(hi.games, rateOf(hi)!, lo.games, rateOf(lo)!),
  };
}

// 5. builds：装备门槛
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await analyzeBuilds({ ...WHO, minGames: n });
    rows.push({ n, ...summarize2(r.items, (x) => x.winRate, n) });
  }
  table("builds：装备胜率的极差（最高 − 最低）", "pp", rows);
}

// 6. queue-stats：队列门槛
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await queueStats({ ...WHO, kind: "lol", minGames: n });
    rows.push({ n, ...summarize2(r.buckets, (x) => x.winRate, n) });
  }
  table("queue-stats：各队列胜率的极差", "pp", rows);
}

// 7. tft-detail：棋子门槛（名次越小越好，极差用最低−最高）
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await tftDetail({ ...WHO, minGames: n });
    const s = summarize2(r.units, (x) => x.avgPlacement, n);
    rows.push({ n, alive: s.alive, effect: s.effect == null ? null : -s.effect, se: s.se });
  }
  table("tft-detail：棋子平均名次的极差（越好 − 越差，负数=差距）", "名次", rows);
}

// 8. counters：对面阵容档门槛
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await analyzeCounters({ ...WHO, minBucketGames: n });
    // 每个阵容档给出「最好的装备」和「最差的装备」两组，合并起来看极差
    const flat = r.buckets.flatMap((b) => [...(b.best ?? []), ...(b.worst ?? [])]);
    rows.push({ n, ...summarize2(flat, (x) => x.winRate, n) });
  }
  table("counters：各阵容档里装备胜率的极差", "pp", rows);
}

// 9. social：队友/对手门槛
{
  const rows = [];
  for (const n of SWEEP) {
    const r = await analyzeSocial({ ...WHO, minGames: n });
    rows.push({ n, ...summarize2([...r.teammates, ...r.opponents], (x) => x.winRate, n) });
  }
  table("social：同队过的账号之间胜率的极差", "pp", rows);
}
