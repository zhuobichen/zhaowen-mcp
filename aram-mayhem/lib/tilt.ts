/**
 * 连败/连胜之后的表现（俗称 tilt 分析）。
 *
 * 问题：输了之后继续打，是打得更差还是照样？赢了之后会不会飘？
 * 做法：把每局按「打这一把之前已经连输/连赢几把」分组，看每组的胜率与数据。
 *
 * 一个必须讲清楚的口径问题：胜率本身就会向 50% 回归，所以「连输 2 把之后胜率
 * 回到 50%」不代表心态恢复，可能只是均值回归。为了能分辨，这里同时给出**同账号
 * 整体胜率**作为基准，并明确说明「接近基准」不等于「有影响」。
 *
 * 只读；数据来自本地归档 ∪ 实时取数。
 */
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";

export interface StreakBucket {
  /** 打这一把之前已经连输（负）或连赢（正）几把 */
  before: number;
  games: number;
  wins: number;
  winRate: number;
  /** 相对该账号整体胜率（百分点） */
  delta: number;
  /** 这一组里场均 KDA，用来看是不是「急了」 */
  kda: number;
  /** 这一组里场均死亡，同上 */
  deaths: number;
  enough: boolean;
}

export interface TiltReport {
  name: string;
  games: number;
  baseWinRate: number;
  /** 整体场均死亡 —— 「连败之后是不是急了」要跟它比，不能光看绝对值 */
  baseDeaths: number;
  /** 输了之后（连败 1/2/3+）的下一把 */
  afterLoss: StreakBucket[];
  /** 赢了之后（连胜 1/2/3+）的下一把 */
  afterWin: StreakBucket[];
  /**
   * 同一天内、上一把输了之后紧接着打的那一把（更严格的「接着打」口径）。
   * 归档里可能没有时间间隔信息，所以用「相邻两局间隔 < 30 分钟」近似。
   */
  immediately: StreakBucket[];
  verdict: string;
  note: string;
}

export async function analyzeTilt(
  opts: { who?: string; puuid?: string; name?: string; minGames?: number } = {}
): Promise<TiltReport> {
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
  const rows = res.games
    .filter(isMayhemGame)
    .map((g: any) => {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      const s: any = p?.stats ?? {};
      if (s.win === undefined) return null;
      return {
        t: Number(g.gameCreation ?? 0),
        dur: Number(g.gameDuration ?? 0) * 1000, // 毫秒，用来算两局间隔
        win: s.win === true,
        k: Number(s.kills ?? 0),
        dd: Number(s.deaths ?? 0),
        a: Number(s.assists ?? 0),
      };
    })
    .filter(Boolean)
    .sort((x: any, y: any) => x.t - y.t) as Array<{
    t: number;
    dur: number;
    win: boolean;
    k: number;
    dd: number;
    a: number;
  }>;

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const base = n ? (wins / n) * 100 : 0;
  const baseDeaths = n ? rows.reduce((s2, r) => s2 + r.dd, 0) / n : 0;
  const minGames = opts.minGames ?? 20;

  const mk = (before: number, list: typeof rows): StreakBucket => {
    const g = list.length;
    const w = list.filter((r) => r.win).length;
    const wr = g ? (w / g) * 100 : 0;
    return {
      before,
      games: g,
      wins: w,
      winRate: wr,
      delta: wr - base,
      kda: list.reduce((s, r) => s + r.k + r.a, 0) / Math.max(list.reduce((s, r) => s + r.dd, 0), 1),
      deaths: g ? list.reduce((s, r) => s + r.dd, 0) / g : 0,
      enough: g >= minGames,
    };
  };

  // 打这一把之前的连胜（正）/ 连败（负）计数
  const afterLoss: StreakBucket[] = [];
  const afterWin: StreakBucket[] = [];
  const immediately: StreakBucket[] = [];
  for (const cap of [1, 2, 3]) {
    // 连败：之前恰好连输 >=cap 把（取「至少」口径，样本更厚）
    const lossSet = [];
    const winSet = [];
    const immSet = [];
    let streak = 0;
    let prev: (typeof rows)[number] | null = null;
    for (const r of rows) {
      const lossStreak = streak < 0 ? -streak : 0;
      const winStreak = streak > 0 ? streak : 0;
      if (lossStreak >= cap) lossSet.push(r);
      if (winStreak >= cap) winSet.push(r);
      // 「接着打」：上一把输了、而且这一把在上把结束后 30 分钟内开始
      if (prev && !prev.win && r.t - (prev.t + prev.dur) < 30 * 60 * 1000 && lossStreak >= 1) immSet.push(r);

      streak = r.win ? (streak > 0 ? streak + 1 : 1) : streak < 0 ? streak - 1 : -1;
      prev = r;
    }
    afterLoss.push(mk(-cap, lossSet));
    afterWin.push(mk(cap, winSet));
    if (cap === 1) immediately.push(mk(-1, immSet));
  }

  const l1 = afterLoss[0];
  const l3 = afterLoss[2];
  const w1 = afterWin[0];
  const imm = immediately[0];

  let verdict: string;
  if (!l1.enough || !w1.enough) {
    verdict = `样本不够：连输/连赢之后的场次不足 ${minGames} 局，不下结论。`;
  } else {
    const parts: string[] = [];
    parts.push(
      `输一把之后打下一把：${l1.games} 局 ${l1.winRate.toFixed(1)}%（比整体 ${l1.delta >= 0 ? "+" : ""}${l1.delta.toFixed(1)}）`
    );
    parts.push(
      `赢一把之后：${w1.games} 局 ${w1.winRate.toFixed(1)}%（${w1.delta >= 0 ? "+" : ""}${w1.delta.toFixed(1)}）`
    );
    if (l3.enough) {
      parts.push(`连输 3 把及以上之后：${l3.games} 局 ${l3.winRate.toFixed(1)}%（${l3.delta >= 0 ? "+" : ""}${l3.delta.toFixed(1)}）`);
    }
    const w3 = afterWin[2];
    if (w3.enough) {
      parts.push(`连赢 3 把及以上之后：${w3.games} 局 ${w3.winRate.toFixed(1)}%（${w3.delta >= 0 ? "+" : ""}${w3.delta.toFixed(1)}）`);
    }
    const worstBucket = l3.enough && l3.delta < l1.delta ? l3 : l1;
    const worst = worstBucket.delta;
    // 判定要跟**噪声**比，不能跟一个固定的百分点比 ——
    // 原先写的是 `worst <= -5`：同一个 -5 个百分点，在 300 局的桶里是实打实的，
    // 在 36 局的桶里标准误就有 8 个点，跟 0 区分不开。
    // 是「门槛扫描」（tools/thresholds-sweep.ts）量出来的：这个号连输 3 把以上那档
    // -6.0 个百分点、标准误 8.8，比值 0.7，而结论原本写的是「明显走低」。
    // 做法照抄 lib/comps.ts：用 k 倍标准误，让它自动随样本量收紧。
    const se = (b: StreakBucket) => Math.sqrt(Math.max(b.winRate * (100 - b.winRate), 1) / Math.max(b.games, 1));
    const worstSE = se(worstBucket);
    const k = worstSE > 0 ? Math.abs(worst) / worstSE : 0;
    // 2 倍标准误（≈95%）才算跟噪声分得开
    const significant = k > 2;
    // 死亡数只有在明显高于自己平时水平时才是「急了」的证据，绝对值没有意义
    const deathNote =
      baseDeaths > 0 && l1.deaths - baseDeaths >= 1
        ? `，而且场均死亡从平时的 ${baseDeaths.toFixed(1)} 涨到 ${l1.deaths.toFixed(1)}`
        : "";
    if (significant && worst < 0) {
      verdict =
        parts.join("；") +
        ` —— 连败之后明显走低（最多 ${worst.toFixed(1)} 个百分点，${worstBucket.games} 局；` +
        `这个偏差约是噪声的 ${k.toFixed(1)} 倍）${deathNote}` +
        "。这个模式下「输两把就停」比硬打划算。";
    } else if (significant && worst >= 0) {
      verdict = parts.join("；") + " —— 输完之后反而打得更好，顶得住，不用刻意停。";
    } else {
      verdict =
        parts.join("；") +
        ` —— 都在整体胜率附近波动：偏离最大的一档是 ${worst.toFixed(1)} 个百分点，` +
        `而那一档只有 ${worstBucket.games} 局，它自己的噪声（一个标准误）就有 ±${worstSE.toFixed(1)} 个百分点，` +
        "两者分不开 —— 看不出明显的上头或越打越好。" +
        "注意胜率本来就会向 50% 回归，所以「接近基准」本身就说明没有额外影响。";
    }
    // 连胜到一定长度也走低的话，方向和「连败」不一样，但同样是「状态被影响」的证据
    // 连胜这头同样要过噪声线，不能只看「低于 -5 个百分点」
    const w3SE = w3.enough ? se(w3) : 0;
    if (w3.enough && w3.delta < 0 && w3SE > 0 && Math.abs(w3.delta) / w3SE > 2) {
      verdict +=
        `\n另外注意连赢那头：连赢 3 把以上之后的 ${w3.games} 局只有 ${w3.winRate.toFixed(1)}%（${w3.delta.toFixed(1)}，` +
        `约是噪声的 ${(Math.abs(w3.delta) / w3SE).toFixed(1)} 倍）—— 不只是输了才上头，赢多了也会飘。`;
    }
    if (imm.enough) {
      verdict += `\n补充：上一把输了、30 分钟内接着开的那 ${imm.games} 局，胜率 ${imm.winRate.toFixed(1)}%（${imm.delta >= 0 ? "+" : ""}${imm.delta.toFixed(1)}）。`;
    }
  }

  return {
    name,
    games: n,
    baseWinRate: base,
    baseDeaths,
    afterLoss,
    afterWin,
    immediately,
    verdict,
    note:
      `${n} 把海斗，整体胜率 ${base.toFixed(1)}%。分组口径：` +
      `「连输 N 把及以上之后的那一把」—— 例如连输 3 把后又连输 4 把，那 4 把都会算进「≥3」这组，` +
      `所以各组是包含关系、样本有重叠，不能相加。` +
      `样本 <${minGames} 局的分组不下结论。「30 分钟内接着开」用相邻两局的开始/结束时间差近似。`,
  };
}

/** 文本输出 */
export async function tiltText(opts: { who?: string; minGames?: number } = {}): Promise<string> {
  let r: TiltReport;
  try {
    r = await analyzeTilt(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const out: string[] = [];
  out.push(`${r.name} · 连败/连胜之后的表现`);
  out.push(r.note);
  out.push("");
  if (!r.games) return out.join("\n");

  out.push(`结论：${r.verdict}`, "");
  const line = (b: StreakBucket) =>
    `  · 之前${b.before > 0 ? `连赢 ${b.before} 把及以上` : `连输 ${-b.before} 把及以上`}：` +
    `${b.games} 局 ${b.winRate.toFixed(1)}%（比整体 ${b.delta >= 0 ? "+" : ""}${b.delta.toFixed(1)}）· ` +
    `KDA ${b.kda.toFixed(2)} · 场均死亡 ${b.deaths.toFixed(1)}${b.enough ? "" : " ← 样本少"}`;

  out.push("输了之后打下一把：");
  for (const b of r.afterLoss) out.push(line(b));
  out.push("", "赢了之后打下一把：");
  for (const b of r.afterWin) out.push(line(b));
  return out.join("\n");
}
