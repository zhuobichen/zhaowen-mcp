/**
 * 一键体检：把各维度的分析结果收拢成一份「该看哪几条」。
 *
 * 工具已经有三十多个，问题从「查不到」变成了「不知道该查哪个」。
 * 这个模块不做新的统计，只做**筛选与排序**：
 *   · 每个维度只取它自己算出来的结论句（各模块已经有 verdict / 结论字段），
 *   · 按「偏离基准的程度」排序，最该注意的排最前，
 *   · 明确标出哪些维度这次**没跑出结论**（样本不够），而不是静默省略。
 *
 * 因为只是汇总，所以慢的那几个（要扫全归档）会并行发起。
 * 只读。
 */
import { analyzeTilt } from "./tilt.js";
import { analyzeTrend } from "./trend.js";
import { analyzePatches } from "./patches.js";
import { analyzeContribution } from "./contribution.js";
import { analyzeMatchups } from "./matchups.js";
import { analyzeBuilds } from "./builds.js";
import { othersAugmentRates } from "./empirical.js";
import { resolveMe } from "./identity.js";
import { loadLolGames } from "./games.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export interface CheckupItem {
  /** 维度名 */
  area: string;
  /** 一句话结论 */
  finding: string;
  /** 偏离基准多大幅度（百分点或名次，越大越值得看）—— 用于排序 */
  weight: number;
  /** 是否跑出了结论（false = 样本不够，会被单独列出来） */
  concluded: boolean;
}

export interface CheckupReport {
  name: string;
  games: number;
  winRate: number;
  /** 按 weight 降序 */
  items: CheckupItem[];
  /** 样本不够、没跑出结论的维度 */
  skipped: string[];
  note: string;
}

export async function checkup(opts: { puuid?: string; name?: string; games?: number } = {}): Promise<CheckupReport> {
  const d = loadData();
  let puuid = opts.puuid ?? null;
  let name = opts.name ?? "";
  if (!puuid) {
    const me = await resolveMe();
    if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");
    puuid = me.puuid;
    name = me.name;
  }

  const items: CheckupItem[] = [];
  const skipped: string[] = [];

  // 各维度并行跑；任何一个挂了都不影响其他（宁可少一条，不整份失败）
  const [tilt, trend, patches, contrib, matchups, builds, othersRes] = await Promise.all([
    analyzeTilt({ puuid, name }).catch(() => null),
    analyzeTrend({ who: undefined, kind: "mayhem" }).catch(() => null),
    analyzePatches({ kind: "mayhem" }).catch(() => null),
    analyzeContribution({ puuid, name }).catch(() => null),
    analyzeMatchups({ puuid, name, minGames: 12 }).catch(() => null),
    analyzeBuilds({ puuid, name, minGames: 8 }).catch(() => null),
    othersAugmentRates(puuid, { minGames: 30 }).catch(() => null),
  ]);

  // 基础盘
  const res = await loadLolGames(puuid, opts.games ?? 2000, name);
  const myGames = res.games.filter(isMayhemGame);
  let games = 0;
  let wins = 0;
  const myAug = new Map<number, { g: number; w: number }>();
  for (const g of myGames) {
    const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
    const s: any = p?.stats ?? {};
    if (s.win === undefined) continue;
    games++;
    if (s.win === true) wins++;
    for (let i = 1; i <= 6; i++) {
      const id = Number(s[`playerAugment${i}`] ?? 0);
      if (!id) continue;
      const c = myAug.get(id) ?? { g: 0, w: 0 };
      c.g++;
      if (s.win === true) c.w++;
      myAug.set(id, c);
    }
  }
  const base = games ? (wins / games) * 100 : 0;

  // ---- 逐维度提炼 ----

  if (tilt?.verdict && !/样本不够/.test(tilt.verdict)) {
    const l1 = tilt.afterLoss[0];
    const w3 = tilt.afterWin[2];
    items.push({
      area: "连败之后",
      finding: `输一把后下一把 ${l1.games} 局 ${l1.winRate.toFixed(1)}%（比整体 ${l1.delta >= 0 ? "+" : ""}${l1.delta.toFixed(1)}）` +
        (w3?.enough ? `；连赢 3 把以上之后 ${w3.winRate.toFixed(1)}%（${w3.delta >= 0 ? "+" : ""}${w3.delta.toFixed(1)}）` : ""),
      weight: Math.max(Math.abs(l1.delta), w3?.enough ? Math.abs(w3.delta) : 0),
      concluded: true,
    });
  } else skipped.push("连败/连胜（样本不足）");

  if (trend?.recent && trend.earlier) {
    const diff = trend.recent.winRate - trend.earlier.winRate;
    items.push({
      area: "近期走势",
      finding: `最近 ${trend.recent.weeks} 个有效周 ${trend.recent.winRate.toFixed(1)}%，之前 ${trend.earlier.weeks} 个 ${trend.earlier.winRate.toFixed(1)}%（${diff >= 0 ? "+" : ""}${diff.toFixed(1)}）`,
      weight: Math.abs(diff),
      concluded: true,
    });
  } else skipped.push("周趋势（有效周不足）");

  if (patches?.verdict && !/比不出来/.test(patches.verdict)) {
    items.push({ area: "补丁适应", finding: patches.verdict, weight: 3, concluded: true });
  } else skipped.push("补丁对比（单个补丁样本不够 15 局）");

  if (contrib?.verdict && !/样本不够/.test(contrib.verdict)) {
    const top = contrib.metrics[0]?.buckets.find((b) => b.rank === 1);
    items.push({
      area: "是否要自己 carry",
      finding: top ? `伤害队内第一时 ${top.games} 局 ${top.winRate.toFixed(1)}%（${top.delta >= 0 ? "+" : ""}${top.delta.toFixed(1)}）` : contrib.verdict,
      weight: top ? Math.abs(top.delta) : 2,
      concluded: true,
    });
  } else skipped.push("贡献度（队内名次样本不足）");

  if (matchups?.versusAll.length) {
    const worst = matchups.versusAll[0];
    items.push({
      area: "最怕的对手",
      finding: `对面有 ${worst.champion} 时 ${worst.games} 把 ${worst.winRate.toFixed(0)}%（残差 ${(worst.residual ?? worst.delta) >= 0 ? "+" : ""}${(worst.residual ?? worst.delta).toFixed(1)}）`,
      weight: Math.abs(worst.residual ?? worst.delta),
      concluded: true,
    });
  } else skipped.push("英雄对位（样本不足）");

  // 符文：自己的 vs 同批其他人的
  if (othersRes && myAug.size) {
    let bestGap = 0;
    let bestName = "";
    let worstGap = 0;
    let worstName = "";
    let bestGames = 0;
    let worstGames = 0;
    for (const [id, v] of myAug) {
      if (v.g < 10) continue;
      const o = othersRes.get(id);
      if (!o) continue;
      const a = d.augments.find((x) => x.officialId === id);
      if (!a || a.name.startsWith("未知")) continue;
      const gap = (v.w / v.g) * 100 - o.winRate;
      if (gap > bestGap) {
        bestGap = gap;
        bestName = a.name;
        bestGames = v.g;
      }
      if (gap < worstGap) {
        worstGap = gap;
        worstName = a.name;
        worstGames = v.g;
      }
    }
    if (worstName) {
      items.push({
        area: "符文用不来的",
        finding: `${worstName}：你 ${worstGames} 把低于同批人 ${Math.abs(worstGap).toFixed(1)} 个百分点`,
        weight: Math.abs(worstGap),
        concluded: true,
      });
    }
    if (bestName) {
      items.push({
        area: "符文用得好",
        finding: `${bestName}：你 ${bestGames} 把高于同批人 ${bestGap.toFixed(1)} 个百分点`,
        weight: bestGap,
        concluded: true,
      });
    }
    if (!worstName && !bestName) skipped.push("符文对比（单件样本不足 10 把）");
  } else skipped.push("符文对比（归档里没有同批其他人的数据）");

  // 出装：出得多但胜率低的
  if (builds?.items.length) {
    const weak = builds.items.filter((x) => x.games >= 15).sort((a, b) => a.winRate - b.winRate)[0];
    if (weak) {
      items.push({
        area: "该换的装备",
        finding: `${weak.name}：出了 ${weak.games} 把只有 ${weak.winRate.toFixed(0)}%`,
        weight: Math.abs(base - weak.winRate),
        concluded: true,
      });
    }
  } else skipped.push("出装（样本不足）");

  items.sort((a, b) => b.weight - a.weight);

  return {
    name: name || "（未固定账号）",
    games,
    winRate: base,
    items,
    skipped,
    note:
      `${games} 把海斗，整体胜率 ${base.toFixed(1)}%。` +
      `这里不做新的统计，只是把各维度自己算出的结论按「偏离基准的幅度」排序 —— ` +
      `排在前面的更值得看，不代表因果。` +
      `没跑出结论的维度单独列在下面（原因都是样本不够），不会静默省略。` +
      `想看某一维度的细节，用对应的工具（get_my_tilt / get_my_trend / get_my_patches / ` +
      `get_my_contribution / get_my_matchups / get_my_builds / get_empirical_augments）。`,
  };
}

/** 文本输出 */
export async function checkupText(opts: { who?: string; games?: number } = {}): Promise<string> {
  let r: CheckupReport;
  try {
    const { resolveAccountByName } = await import("./identity.js");
    let id: { puuid?: string; name?: string } = {};
    if (opts.who) {
      const m = await resolveAccountByName(opts.who);
      if (!m.matches.length) return `没找到「${opts.who}」——${m.note}`;
      id = { puuid: m.matches[0].puuid, name: m.matches[0].name };
    }
    r = await checkup(id);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }

  const out: string[] = [];
  out.push(`=== ${r.name} · 海斗体检 ===`);
  out.push(`整体：${r.games} 把，胜率 ${r.winRate.toFixed(1)}%`);
  out.push("");
  out.push(r.note);
  out.push("");

  if (r.items.length) {
    out.push("按值得看的程度排序：");
    r.items.forEach((x, i) => {
      out.push(`  ${i + 1}. 【${x.area}】${x.finding}`);
    });
  } else {
    out.push("没有任何维度跑出结论（样本普遍不足）——先多打几把或跑 archive:sync。");
  }

  if (r.skipped.length) {
    out.push("", `本次没跑出结论的维度（${r.skipped.length} 个，都是样本不够）：`);
    for (const s of r.skipped) out.push(`  · ${s}`);
  }
  return out.join("\n");
}
