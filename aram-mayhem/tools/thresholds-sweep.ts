/**
 * 门槛扫描：把某个门槛从小到大扫一遍，看**报出来的效应**怎么变。
 *
 * 用途：`docs/THRESHOLDS.md` 里那些理由是「未说明」的门槛 —— 没人知道该是多少。
 * 这个探针是唯一能让它们收敛的办法：拿真实归档跑一遍，看效应随门槛的变化曲线。
 * （数字不写死在注释里 —— 这里原先是「21 条」，填掉几条之后那句就成了假的。）
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
import { augmentEmpirical, championAugmentEmpirical, checkSynergySets, empiricalAugments, empiricalPairs, othersAugmentRates } from "../lib/empirical.js";
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

// ---- 11~13. lib/empirical.ts：一个文件 8 处门槛、7 个函数。
//     之前登记表只能把它们合并成一行写「未说明为何不同」；键细到函数级之后才拆得开。
//     这里量的是同一件事：门槛会不会改变幸存集合（幸存条目数在 5~200 之间稳不稳）。
{
  const sections: Array<[string, () => Promise<{ games: number; winRate: number }[]>]> = [
    ["empiricalAugments：单件符文的胜率极差", async () => (await empiricalAugments({ minGames: 0 })).augments],
    ["empiricalPairs：符文组合的胜率极差", async () => (await empiricalPairs({ minGames: 0 })).pairs],
    ["checkSynergySets：羁绊的胜率极差", async () => (await checkSynergySets({ minGames: 0 })).sets],
  ];
  for (const [title, load] of sections) {
    const all = await load();
    const rows = SWEEP.map((n) => ({
      n,
      alive: `${all.filter((x) => x.games >= n).length} 条够样本（总共 ${all.length} 条）`,
      effect: null as number | null,
      se: null as number | null,
    }));
    console.log(`\n=== ${title}（只看门槛卡掉多少条）===`);
    console.log("  门槛   存活");
    for (const r of rows) console.log(`  ${String(r.n).padStart(4)}   ${r.alive}`);
    console.log("  （这一族没算极差：条目多、极差是最大值统计量，算了也不能当效应量读）");
  }
}

// ---- 14. 同一族的三个门槛并排量：单符文榜 100 / 其他玩家口径 30 / 英雄×符文 20
//
// 这三处是**同一种统计**（某个单元在归档里的胜率），只是单元集合不同。
// 登记表里它们各写了一个数、相对大小看不出规律（单元最多的英雄×符文反而最低 20）。
// 这里把三者并排：看每个门槛卡掉多少、以及**在它的候选数下噪声能造出多大的极值**。
// 那两个量一起才说明问题 —— 门槛低 + 候选多 = 榜首必然被噪声占满。
{
  const rowsOut: Array<{ 口径: string; 默认门槛: string; "候选@默认": string; "噪声尺度": string }> = [];

  /** N 个候选、给定中等标准误时，纯噪声能造出的最大偏离（百分点） */
  const noiseCeil = (n: number, medSE: number) => Math.sqrt(2 * Math.log(Math.max(n, 2))) * medSE;

  // (a) 单符文榜：门槛 100
  {
    const all = (await empiricalAugments({ minGames: 0 })).augments;
    const at = all.filter((x) => x.games >= 100);
    const ses = at.map((x) => Math.sqrt(Math.max(x.winRate * (100 - x.winRate), 1) / Math.max(x.games, 1))).sort((a, b) => a - b);
    const med = ses.length ? ses[Math.floor(ses.length / 2)] : 0;
    rowsOut.push({
      口径: "单符文榜 empiricalAugments",
      默认门槛: "100",
      "候选@默认": `${at.length} / ${all.length}`,
      噪声尺度: `±${noiseCeil(at.length, med).toFixed(1)}pp`,
    });
    console.log(`\n=== (a) 单符文榜：门槛 100 ===`);
    for (const n of SWEEP) {
      const at2 = all.filter((x) => x.games >= n);
      console.log(`  门槛 ${String(n).padStart(4)} → 候选 ${String(at2.length).padStart(4)} / ${all.length}`);
    }
  }

  // (b) 其他玩家口径：门槛 30
  {
    const m = await othersAugmentRates(WHO.puuid, { minGames: 0 });
    const all = [...m.values()];
    const at = all.filter((x) => x.games >= 30);
    const ses = at.map((x) => Math.sqrt(Math.max(x.winRate * (100 - x.winRate), 1) / Math.max(x.games, 1))).sort((a, b) => a - b);
    const med = ses.length ? ses[Math.floor(ses.length / 2)] : 0;
    rowsOut.push({
      口径: "其他玩家口径 othersAugmentRates",
      默认门槛: "30",
      "候选@默认": `${at.length} / ${all.length}`,
      噪声尺度: `±${noiseCeil(at.length, med).toFixed(1)}pp`,
    });
    console.log(`\n=== (b) 其他玩家口径：门槛 30 ===`);
    for (const n of SWEEP) console.log(`  门槛 ${String(n).padStart(4)} → 候选 ${String(all.filter((x) => x.games >= n).length).padStart(4)} / ${all.length}`);
  }

  // (c) 英雄×符文：门槛 20（挑这个号玩得最多的英雄来量）
  {
    const d = (await import("../lib/store.js")).loadData();
    const games = (await import("../lib/archive.js")).archivedGamesFor("lol");
    const { isMayhemGame } = await import("../lib/lcu.js");
    const mayhem = (await games).filter(isMayhemGame);
    const tally = new Map<number, number>();
    for (const g of mayhem)
      for (const p of g.participants ?? []) {
        if (p.puuid !== WHO.puuid) continue;
        const c = Number(p.championId ?? 0);
        if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
    const topChamp = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topChamp) {
      const cid = d.championIds[String(topChamp)];
      const name = cid ? d.championById.get(cid.id)?.name ?? cid.name : String(topChamp);
      const r0 = await championAugmentEmpirical(topChamp, { minGames: 0 });
      // 返回的 best/worst 是**截断过的**（各取前几个），所以数不出「多少条够样本」。
      // 能观测的是**榜单首位那条的样本量**：门槛低时首位多半只有几局（那正是噪声），
      // 门槛上去之后首位才轮到样本厚的 —— 这比数条目数更能说明门槛有没有在起作用。
      console.log(`\n=== (c) 英雄×符文：门槛 20（用玩得最多的 ${name}，${r0.games} 局）===`);
      console.log("  门槛   榜单首位那条（样本 / 胜率 / 相对基准）");
      for (const n of [5, 10, 20, 30, 60, 120]) {
        const r = await championAugmentEmpirical(topChamp, { minGames: n });
        const top = r.best[0];
        console.log(
          `  ${String(n).padStart(4)}   ` +
            (top
              ? `${top.games} 局 ${top.winRate.toFixed(1)}%（${top.delta >= 0 ? "+" : ""}${top.delta.toFixed(1)}）`
              : "（没有够样本的）")
        );
      }
      rowsOut.push({
        口径: `英雄×符文 championAugmentEmpirical（${name}）`,
        默认门槛: "20",
        "候选@默认": "（返回截断，数不出）",
        噪声尺度: "见 (c) 的榜首样本量",
      });
    }
  }

  console.log("\n=== 三者并排（默认门槛下）===");
  console.log("  口径                                        默认门槛  候选@默认        噪声尺度");
  for (const r of rowsOut) {
    console.log(`  ${r.口径.padEnd(42)} ${r.默认门槛.padStart(6)}  ${r["候选@默认"].padEnd(14)} ${r.噪声尺度}`);
  }
}

// ---- 15. matchups 一族：一个分析里三个门槛（对面英雄 12 / 我玩过的英雄 15 / 单个对位 5）
//
// 和 empirical 那一族同类：三个数在同一个分析里，各自管一层筛选。
// 分开扫，看每个是不是真的在选东西 —— 尤其是 perPairGames 的 5：
// 它原先是读 opts.minGames 的（默认 12），拆开时照抄了旧默认值 5，**没有任何依据**。
{
  console.log("\n=== matchups 一族：三个门槛各自单独扫（其余保持默认）===");

  // (a) minGames：对面出现过的英雄
  {
    const rows = [];
    for (const n of SWEEP) {
      const r = await analyzeMatchups({ ...WHO, minGames: n });
      const top = r.versusAll[0];
      const se = top ? seOfDiff(top.games, top.winRate, 100, 50) : null;
      rows.push({
        n,
        alive: `${r.versusAll.length} 个对面英雄`,
        effect: top?.residual ?? null,
        se,
      });
    }
    table("(a) minGames：对面英雄条目数 + 最负残差（其余默认）", "pp", rows);
  }

  // (b) minChampionGames：我玩过的英雄（看英雄视角列出几个、以及它们各自的样本）
  {
    console.log("\n(b) minChampionGames：我玩过的英雄列出几个（其余默认）");
    console.log("  门槛   列出英雄数   第一个英雄的样本");
    for (const n of SWEEP) {
      const r = await analyzeMatchups({ ...WHO, minChampionGames: n });
      const first = r.byChampion[0];
      console.log(`  ${String(n).padStart(4)}   ${String(r.byChampion.length).padStart(8)}   ${first ? `${first.champion} ${first.games} 把` : "—"}`);
    }
  }

  // (c) perPairGames：英雄视角里「单个对位」的条目（默认 5，拆开时照抄的）
  {
    console.log("\n(c) perPairGames：英雄视角里单个对位至少几次才列（其余默认）");
    console.log("  门槛   第一个英雄列出的对位数   其中最薄的那个样本");
    for (const n of SWEEP) {
      const r = await analyzeMatchups({ ...WHO, perPairGames: n });
      const first = r.byChampion[0];
      const pairs = first ? [...first.worst, ...first.best] : [];
      const games = pairs.map((x) => x.games);
      console.log(
        `  ${String(n).padStart(4)}   ${String(pairs.length).padStart(20)}   ${games.length ? `${Math.min(...games)} 把` : "—"}`
      );
    }
    const r5 = await analyzeMatchups({ ...WHO, perPairGames: 5 });
    const f = r5.byChampion[0];
    if (f) {
      const all = [...f.worst, ...f.best];
      const withK = all.map((x) => {
        const se = seOfDiff(x.games, x.winRate, 100, 50);
        return { n: x.games, wr: x.winRate, k: se > 0 ? Math.abs(x.winRate - 50) / se : 0 };
      });
      console.log(`  默认 5 下 ${f.champion} 的对位：` + withK.map((x) => `${x.n}把${x.wr.toFixed(0)}%(${x.k.toFixed(1)}倍)`).join(" · "));
      console.log("  （「几倍」= 该对位胜率偏离 50% 约几个标准误；不到 2 的跟噪声分不开）");
    }
  }
}

// ---- 16. 把四条「幸存者极差」的量法重做一遍
//
// 那四条（builds / counters / tft-detail / social）当时用的是「幸存者里最高与最低之差」——
// 后来我在同一个文件里写明：**极差是最大值统计量，条目越多必然越大，不能当效应量读**。
// 也就是说那四条的实测结论引用了**我自己否掉的度量**。改用现在这套
// 「榜首位那条的样本 / 倍数」重做 —— 它才回答得了「门槛低时榜首位是不是几局的噪声」。

/** 给定一组条目，报告：某个门槛下、按 rate 排序的榜首位是谁、多少样本、几倍噪声 */
function topRow<T extends { games: number }>(
  items: T[],
  rateOf: (x: T) => number,
  n: number,
  higherIsBetter = true
): { alive: number; top: string } {
  const alive = items.filter((x) => x.games >= n);
  if (!alive.length) return { alive: 0, top: "—" };
  const sorted = [...alive].sort((a, b) => (higherIsBetter ? rateOf(b) - rateOf(a) : rateOf(a) - rateOf(b)));
  const t = sorted[0];
  const r = rateOf(t);
  const base = higherIsBetter ? 50 : 0; // 胜率跟 50 比；名次不适用倍数
  const se = Math.sqrt(Math.max(r * (100 - r), 1) / Math.max(t.games, 1));
  const k = belowNoise(items) ? null : Math.abs(r - base) / se;
  return {
    alive: alive.length,
    top: `${t.games} 局 ${r.toFixed(1)}%${k != null && Number.isFinite(k) ? `（${k.toFixed(1)} 倍噪声）` : ""}`,
  };
}
/** 名次类（越小越好）不适用「偏离 50% 几倍」的说法 */
function belowNoise(items: unknown[]): boolean {
  return items.length > 0 && "avgPlacement" in (items[0] as object);
}

{
  console.log("\n=== 重做：榜首位那条的样本 / 倍数（原来那四栏用的是被否掉的最大值统计量）===");
  console.log("  口径                 门槛   榜首位是谁（样本 / 值 / 倍数）");

  const sections: Array<[string, (n: number) => Promise<{ games: number; winRate: number }[]>]> = [
    ["builds 装备", async (n) => (await analyzeBuilds({ ...WHO, minGames: n })).items],
    ["counters 装备", async (n) => {
      const r = await analyzeCounters({ ...WHO, minBucketGames: n });
      return r.buckets.flatMap((b) => [...(b.best ?? []), ...(b.worst ?? [])]);
    }],
    ["social 队友/对手", async (n) => {
      const r = await analyzeSocial({ ...WHO, minGames: n });
      return [...r.teammates, ...r.opponents];
    }],
  ];
  for (const [title, load] of sections) {
    for (const n of [5, 15, 30, 60]) {
      const items = await load(n);
      const t = topRow(items, (x) => x.winRate, n);
      console.log(`  ${title.padEnd(20)} ${String(n).padStart(4)}   ${t.top}（共 ${t.alive} 条够样本）`);
    }
  }
  // tft-detail 是名次，单独一栏
  console.log("  tft-detail 棋子（名次，越小越好）");
  for (const n of [5, 15, 30, 60]) {
    const r = await tftDetail({ ...WHO, minGames: n });
    const alive = r.units.filter((x) => x.games >= n);
    const best = [...alive].sort((a, b) => a.avgPlacement - b.avgPlacement)[0];
    console.log(`  ${"".padEnd(20)} ${String(n).padStart(4)}   ${best ? `${best.games} 局 平均名次 ${best.avgPlacement.toFixed(2)}` : "—"}（共 ${alive.length} 条够样本）`);
  }
}

// ---- 17. augmentEmpirical（符文详情页的「本机实证」段，门槛 60）
//
// 它是**单件符文的实证**：这个符文跟谁一起拿协同最强 / 最弱。
// 与 empiricalAugments（符文榜，门槛 100）是同类统计的两个门槛 —— 那条量过「保留 76%、基本不 bind」，
// 但这处没量过自己的榜首形状。补上。
{
  console.log("\n=== augmentEmpirical：符文详情页的「和谁搭」（门槛 60）===");
  // 挑一个样本最厚的符文
  const all = (await empiricalAugments({ minGames: 0 })).augments;
  const fat = [...all].sort((a, b) => b.games - a.games)[0];
  if (fat) {
    console.log(`  用样本最厚的符文：${fat.name}（${fat.games} 局）`);
    console.log("  门槛   协同榜首（对子 / 样本 / 协同 / 倍数）");
    for (const n of [5, 20, 40, 60, 100]) {
      const r = await augmentEmpirical(fat.id, { minGames: n });
      const t = r.topPairs[0];
      if (!t) {
        console.log(`  ${String(n).padStart(4)}   （没有够样本的对子）`);
        continue;
      }
      const se = Math.sqrt(Math.max(t.winRate * (100 - t.winRate), 1) / Math.max(t.games, 1));
      console.log(
        `  ${String(n).padStart(4)}   ${t.with}　${t.games} 局 ${t.winRate.toFixed(1)}%　协同 ${t.synergy >= 0 ? "+" : ""}${t.synergy.toFixed(1)}　${se > 0 ? `${(Math.abs(t.synergy) / se).toFixed(1)} 倍` : "—"}`
      );
    }
  }
}
