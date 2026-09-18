/**
 * 出装分析：从对局记录里统计「你出过哪些装备、胜率如何」。
 *
 * 数据来源：对局参与者的 item0..item6（SGP 提供）。注意这是**背包槽位**而不是购买顺序，
 * 所以这里统计的是「这件装备在你背包里出现过的局」的胜率，不声称是「第几件出」。
 * 消耗品/饰品（魄罗佳肴、药水、控制守卫等）会被过滤掉，不算出装。
 */
import { loadLolGames } from "./games.js";
import { resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export interface ItemStat {
  id: number;
  name: string;
  price: number;
  games: number;
  wins: number;
  winRate: number;
}

export interface BuildReport {
  name: string;
  games: number;
  /** 统计到的装备（≥minGames 次） */
  items: ItemStat[];
  note: string;
}

function isEquipment(it?: { price: number; categories: string[]; inStore: boolean }): boolean {
  if (!it) return false;
  if (it.categories.includes("Trinket") || it.categories.includes("Consumable")) return false;
  // 魄罗佳肴这类：既不在售、又没有价格、也没有类别 —— 不是出装
  return it.inStore || it.price > 0 || it.categories.length > 0;
}

export async function analyzeBuilds(opts: { games?: number; minGames?: number } = {}): Promise<BuildReport> {
  const d = loadData();
  const me = await resolveMe();
  if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");

  const res = await loadLolGames(me.puuid, opts.games ?? 2000, me.name);
  const games = res.games.filter(isMayhemGame);
  const stat = new Map<number, { games: number; wins: number }>();
  let counted = 0;

  for (const g of games) {
    const p = (g.participants ?? []).find((x: any) => x.puuid === me.puuid);
    if (!p?.stats) continue;
    counted++;
    const win = (p.stats as any).win === true;
    const seen = new Set<number>();
    for (let i = 0; i <= 6; i++) {
      const id = Number((p.stats as any)[`item${i}`] ?? 0);
      if (!id || seen.has(id)) continue;
      if (!isEquipment(d.items[String(id)])) continue;
      seen.add(id);
      const c = stat.get(id) ?? { games: 0, wins: 0 };
      c.games++;
      if (win) c.wins++;
      stat.set(id, c);
    }
  }

  const minGames = opts.minGames ?? 8;
  const items: ItemStat[] = [...stat.entries()]
    .filter(([, v]) => v.games >= minGames)
    .map(([id, v]) => {
      const it = d.items[String(id)];
      return {
        id,
        name: it?.name ?? `装备#${id}`,
        price: it?.price ?? 0,
        games: v.games,
        wins: v.wins,
        winRate: v.games ? (v.wins / v.games) * 100 : 0,
      };
    })
    .sort((a, b) => b.games - a.games);

  return {
    name: me.name,
    games: counted,
    items,
    note: `${games.length} 把海斗中 ${counted} 把读到了出装数据；只统计同局出现过的装备（≥${minGames} 次）`,
  };
}

/** 文本输出 */
export async function buildsText(opts: { minGames?: number } = {}): Promise<string> {
  let r: BuildReport;
  try {
    r = await analyzeBuilds(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const out: string[] = [`${r.name} · 出装分析`, r.note, ""];
  const byGames = r.items.slice(0, 15);
  out.push("最常出的装备（按出现局数）：");
  for (const it of byGames) out.push(`  · ${it.name}（${it.price} 金）：${it.games} 把 · 胜率 ${it.winRate.toFixed(0)}%`);

  const strong = [...r.items].filter((x) => x.games >= 10).sort((a, b) => b.winRate - a.winRate).slice(0, 6);
  if (strong.length) {
    out.push("", "出了它胜率最高（≥10 把）：");
    for (const it of strong) out.push(`  · ${it.name}：${it.games} 把 ${it.winRate.toFixed(0)}%`);
  }
  const weak = [...r.items].filter((x) => x.games >= 15).sort((a, b) => a.winRate - b.winRate).slice(0, 6);
  if (weak.length) {
    out.push("", "出得多但胜率偏低（≥15 把，可以考虑换）：");
    for (const it of weak) out.push(`  · ${it.name}：${it.games} 把 ${it.winRate.toFixed(0)}%`);
  }
  out.push("", "说明：装备按「在你背包里出现过」统计（数据是槽位不是购买顺序），消耗品与饰品不计入。");
  return out.join("\n");
}
