/**
 * 云顶之弈深化分析：棋子与装备维度。
 *
 * 数据来自对局里记录的**最终阵容**（units: character_id / 星级 / 装备）。
 * 所以这里算的是「你最后带着它收场时名次如何」，不是「拿了它就能赢」——
 * 倒推因果要把追卡、抢装备的过程算进去，那不是这份数据能回答的。
 * 输出里会写明这一点，并按样本量下限过滤，避免两三局就当结论。
 *
 * 只读；数据来自 SGP ∪ 客户端 ∪ 归档（loadTftGames）。
 */
import { loadTftGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { tftName } from "./store.js";

/**
 * 占位/非实物条目：云顶的棋子装备槽里会塞一些内部占位（`EmptyBag` 之类），
 * 它们不是玩家出的装备。不过滤的话「平均名次 1.20、前四 100%」会霸榜，把真装备挤下去。
 */
const PLACEHOLDER = /^(emptybag|empty|placeholder|tft_item_emptybag)$/i;

/** 内部标识 → 中文名；查不到就原样显示，并去掉赛季前缀让它至少可读 */
function displayName(kind: "champions" | "items", id: string | undefined): string {
  if (!id) return "?";
  return tftName(kind, id) ?? id.replace(/^TFT\d+_/i, "").replace(/^TFT_Item_/i, "");
}

export interface TftEntryStat {
  name: string;
  /** 出现在最终阵容里的局数 */
  games: number;
  /** 平均名次（越小越好，1 最大） */
  avgPlacement: number;
  /** 前四局数与占比 */
  top4: number;
  top4Rate: number;
  /** 吃鸡局数 */
  first: number;
  /** 相对你的整体平均名次好了多少（名次单位，正数=名次更小=更好） */
  delta: number;
}

export interface TftDetailReport {
  name: string;
  games: number;
  avgPlacement: number;
  /** 每个棋子的统计（≥minGames） */
  units: TftEntryStat[];
  /** 每件装备的统计（≥minGames） */
  items: TftEntryStat[];
  /** 追到三星的棋子（只统计出现次数，不做胜率结论） */
  threeStars: Array<{ name: string; games: number }>;
  note: string;
}

type Acc = { games: number; placeSum: number; top4: number; first: number };

function tally(map: Map<string, Acc>, key: string, place: number) {
  const c = map.get(key) ?? { games: 0, placeSum: 0, top4: 0, first: 0 };
  c.games++;
  c.placeSum += place;
  if (place <= 4) c.top4++;
  if (place === 1) c.first++;
  map.set(key, c);
}

function toStats(map: Map<string, Acc>, base: number, minGames: number): TftEntryStat[] {
  return [...map.entries()]
    .filter(([, v]) => v.games >= minGames)
    .map(([name, v]) => {
      const avg = v.placeSum / v.games;
      return {
        name,
        games: v.games,
        avgPlacement: avg,
        top4: v.top4,
        top4Rate: (v.top4 / v.games) * 100,
        first: v.first,
        delta: base - avg,
      };
    })
    .sort((a, b) => b.delta - a.delta || b.games - a.games);
}

export async function tftDetail(
  opts: { who?: string; minGames?: number } = {}
): Promise<TftDetailReport> {
  let puuid: string;
  let name: string;
  if (opts.who) {
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

  const res = await loadTftGames(puuid, name);

  const unitMap = new Map<string, Acc>();
  const itemMap = new Map<string, Acc>();
  const threeMap = new Map<string, number>();
  let n = 0;
  let placeSum = 0;
  // 每局同一棋子/装备只记一次（避免一个英雄带两件同装备被重复计数）
  for (const g of res.games) {
    const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
    if (!p) continue;
    const place = Number(p.placement ?? 0);
    if (!place) continue;
    n++;
    placeSum += place;

    const seenUnits = new Set<string>();
    const seenItems = new Set<string>();
    for (const u of p.units ?? []) {
      const key = displayName("champions", u.character_id);
      if (!seenUnits.has(key)) {
        seenUnits.add(key);
        tally(unitMap, key, place);
      }
      if ((u.tier ?? 0) >= 3) threeMap.set(key, (threeMap.get(key) ?? 0) + 1);
      for (const it of u.itemNames ?? []) {
        if (PLACEHOLDER.test(String(it))) continue;
        const ik = displayName("items", it);
        if (seenItems.has(ik)) continue;
        seenItems.add(ik);
        tally(itemMap, ik, place);
      }
    }
  }

  const base = n ? placeSum / n : 0;
  const minGames = opts.minGames ?? 12;
  return {
    name,
    games: n,
    avgPlacement: base,
    units: toStats(unitMap, base, minGames),
    items: toStats(itemMap, base, minGames),
    threeStars: [...threeMap.entries()]
      .map(([k, v]) => ({ name: k, games: v }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 12),
    note:
      `${n} 局里有你的阵容记录，整体平均名次 ${base.toFixed(2)}。` +
      `只列出现 ≥${minGames} 局的棋子/装备。这是**最终阵容**的统计 —— ` +
      `回答的是「你最后带着它收场时名次如何」，不是「拿了它就能赢」：` +
      `追不追得到、抢不抢得到装备，本身就和当局运气与运营绑定。`,
  };
}

/** 文本输出 */
export async function tftDetailText(opts: { who?: string; minGames?: number } = {}): Promise<string> {
  let r: TftDetailReport;
  try {
    r = await tftDetail(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const out: string[] = [`${r.name} · 云顶棋子与装备`, r.note, ""];

  const show = (label: string, rows: TftEntryStat[], top: number, bottom: number) => {
    if (!rows.length) {
      out.push(`${label}：样本不足，没有出现 ≥ 阈值的条目。`, "");
      return;
    }
    out.push(`${label}（平均名次越小越好，你的基准 ${r.avgPlacement.toFixed(2)}）：`);
    for (const x of rows.slice(0, top)) {
      out.push(
        `  · ${x.name}：${x.games} 局 · 平均名次 ${x.avgPlacement.toFixed(2)}（比基准好 ${x.delta.toFixed(2)}）· 前四 ${x.top4Rate.toFixed(0)}%`
      );
    }
    const worst = rows.slice(-bottom).reverse();
    if (worst.length && worst[0].name !== rows[0].name) {
      out.push(`  反过来看（带着它们收场时名次偏差）：`);
      for (const x of worst) {
        out.push(`    · ${x.name}：${x.games} 局 · 平均名次 ${x.avgPlacement.toFixed(2)}（比基准差 ${(-x.delta).toFixed(2)}）`);
      }
    }
    out.push("");
  };

  show("棋子里最顺手的", r.units, 12, 6);
  show("装备里最顺手的", r.items, 10, 5);

  if (r.threeStars.length) {
    out.push(`追到过三星的棋子（只列次数，不下强弱结论 —— 能追到三星本身说明那局经济顺）：`);
    out.push(`  ${r.threeStars.map((x) => `${x.name}×${x.games}`).join("、")}`);
  }
  return out.filter((x) => x !== undefined).join("\n");
}
