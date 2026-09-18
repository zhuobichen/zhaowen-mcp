/**
 * 对面阵容 → 赢的人出什么装备。
 *
 * 问题：海斗里「对面肉多 / 刺客多」时该怎么出装？社区攻略给的是主观建议，
 * 这里换个问法：**在归档的真实对局里，面对这种阵容时，赢的那一方最终出的是什么。**
 *
 * 样本用的是全部参与者的行（不只你自己），所以量够大（几万行）。
 * 但必须讲清楚这是**相关性**：出装和英雄、定位、流派强相关 ——
 * 法师本来就不会出无尽，所以「打坦克时无尽胜率低」可能只是因为拿无尽的都是刺客。
 * 输出里会写明，并且只列样本足够大的装备。
 *
 * 只读本地归档。
 */
import { archivedGamesFor } from "./archive.js";
import { isMayhemGame } from "./lcu.js";
import { ROLE_CN } from "./comps.js";
import { isFinishedItem, loadData } from "./store.js";

export interface ItemAdvice {
  itemId: number;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  /** 相对该阵容分组整体的胜率（百分点） */
  delta: number;
}

export interface CompBucket {
  /** 分组标识，如 "tank2"（对面 ≥2 个坦克标签） */
  key: string;
  label: string;
  games: number;
  winRate: number;
  /** 该分组下胜率最高的装备 */
  best: ItemAdvice[];
  /** 该分组下胜率最低的装备（出得多但拖后腿） */
  worst: ItemAdvice[];
}

export interface CounterReport {
  games: number;
  rows: number;
  /** 全局基准（所有参与者行的胜率，理论 50%） */
  baseWinRate: number;
  buckets: CompBucket[];
  note: string;
}

/** 分组定义：对面带某标签的人数达到阈值，就算「对面主打这一路」 */
const BUCKETS: Array<{ key: string; role: string; min: number }> = [
  { key: "tank2", role: "tank", min: 2 },
  { key: "fighter2", role: "fighter", min: 2 },
  { key: "assassin2", role: "assassin", min: 2 },
  { key: "mage3", role: "mage", min: 3 },
  { key: "marksman2", role: "marksman", min: 2 },
];

export async function analyzeCounters(
  opts: { minItemGames?: number; minBucketGames?: number } = {}
): Promise<CounterReport> {
  const d = loadData();
  const games = (await archivedGamesFor("lol")).filter(isMayhemGame);

  const rolesOf = (championId: number): string[] => {
    const cid = d.championIds[String(championId)];
    if (!cid) return [];
    return d.championById.get(cid.id)?.roles ?? [];
  };

  const minItemGames = opts.minItemGames ?? 150;
  const minBucket = opts.minBucketGames ?? 300;

  // 分组 → 装备 → 计数
  const bucketItem = new Map<string, Map<number, { g: number; w: number }>>();
  const bucketAll = new Map<string, { g: number; w: number }>();
  let rows = 0;
  let rowWins = 0;

  for (const g of games) {
    const parts = g.participants ?? [];
    if (parts.length < 2) continue;
    // 先按队伍把「对面阵容」算出来：teamId → 该队带各标签的人数
    const byTeam = new Map<number, Record<string, number>>();
    for (const p of parts) {
      if (!p.championId) continue;
      const t = Number((p as any).teamId ?? 0);
      const cur = byTeam.get(t) ?? {};
      for (const r of new Set(rolesOf(Number(p.championId)))) cur[r] = (cur[r] ?? 0) + 1;
      byTeam.set(t, cur);
    }

    for (const p of parts) {
      const s: any = p.stats ?? {};
      if (s.win === undefined) continue;
      rows++;
      if (s.win === true) rowWins++;

      const t = Number((p as any).teamId ?? 0);
      // 对面 = 另一个 teamId
      const foeTeam = [...byTeam.keys()].find((k) => k !== t);
      if (foeTeam == null) continue;
      const foe = byTeam.get(foeTeam) ?? {};

      const hitBuckets = BUCKETS.filter((b) => (foe[b.role] ?? 0) >= b.min);
      if (!hitBuckets.length) continue;

      const seen = new Set<number>();
      const items: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const id = Number(s[`item${i}`] ?? 0);
        if (!id || seen.has(id) || !isFinishedItem(d.items[String(id)])) continue;
        seen.add(id);
        items.push(id);
      }

      for (const b of hitBuckets) {
        const all = bucketAll.get(b.key) ?? { g: 0, w: 0 };
        all.g++;
        if (s.win === true) all.w++;
        bucketAll.set(b.key, all);

        const m = bucketItem.get(b.key) ?? new Map<number, { g: number; w: number }>();
        for (const id of items) {
          const c = m.get(id) ?? { g: 0, w: 0 };
          c.g++;
          if (s.win === true) c.w++;
          m.set(id, c);
        }
        bucketItem.set(b.key, m);
      }
    }
  }

  const base = rows ? (rowWins / rows) * 100 : 0;

  const buckets: CompBucket[] = BUCKETS.map((b) => {
    const all = bucketAll.get(b.key) ?? { g: 0, w: 0 };
    const total = all.g ? (all.w / all.g) * 100 : 0;
    const items: ItemAdvice[] = [...(bucketItem.get(b.key) ?? new Map()).entries()]
      .filter(([, v]) => v.g >= minItemGames)
      .map(([itemId, v]) => {
        const wr = (v.w / v.g) * 100;
        return {
          itemId,
          name: d.items[String(itemId)]?.name ?? `未知装备#${itemId}`,
          games: v.g,
          wins: v.w,
          winRate: wr,
          delta: wr - total,
        };
      })
      .sort((x, y) => y.winRate - x.winRate || y.games - x.games);
    return {
      key: b.key,
      label: `对面 ≥${b.min} 个${ROLE_CN[b.role] ?? b.role}标签`,
      games: all.g,
      winRate: total,
      best: items.slice(0, 5),
      worst: items.slice(-5).reverse(),
    } satisfies CompBucket;
  }).filter((b) => b.games >= minBucket);

  return {
    games: games.length,
    rows,
    baseWinRate: base,
    buckets,
    note:
      `样本：归档里 ${games.length} 把海斗的全部参与者行（${rows} 行，含对手与路人，不只你自己），` +
      `全员整体胜率 ${base.toFixed(1)}%。` +
      `只统计**成装**（价格 ≥2000，排除散件与鞋）—— 散件留在最终背包多半说明那局结束得早，` +
      `直接统计会得到「打坦克时出短剑胜率最高」这种反向因果的假结论。` +
      `每个分组只保留凑够 ${minBucket} 局、且单件装备出现 ≥${minItemGames} 次的，避免小样本。` +
      `⚠ 这是**相关性不是因果**：出装和英雄/定位强相关（法师不会出无尽），` +
      `所以「打坦克时某件装备胜率低」可能只是因为出它的都是另一类英雄。只能当参考，不能当配装公式。`,
  };
}

/** 文本输出 */
export async function countersText(opts: { minItemGames?: number; minBucketGames?: number } = {}): Promise<string> {
  let r: CounterReport;
  try {
    r = await analyzeCounters(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const out: string[] = [];
  out.push("对面阵容 → 赢的人出什么装备");
  out.push(r.note);
  out.push("");
  if (!r.buckets.length) {
    out.push("归档里没有样本够的分组（多同步几局再来）。");
    return out.join("\n");
  }

  for (const b of r.buckets) {
    out.push(`${b.label}：${b.games} 行，这一组整体胜率 ${b.winRate.toFixed(1)}%`);
    out.push(`  出这些的胜率靠前：`);
    for (const it of b.best) {
      out.push(`    · ${it.name}：${it.games} 次 ${it.winRate.toFixed(1)}%（比组内基准 ${it.delta >= 0 ? "+" : ""}${it.delta.toFixed(1)}）`);
    }
    out.push(`  这些偏高但胜率靠后：`);
    for (const it of b.worst) {
      out.push(`    · ${it.name}：${it.games} 次 ${it.winRate.toFixed(1)}%（${it.delta >= 0 ? "+" : ""}${it.delta.toFixed(1)}）`);
    }
    out.push("");
  }
  out.push(
    "读法：把「对面肉多」时赢家手里的装备当成一个**待验证的假设**，不是结论 ——",
    "先看它是不是本来就跟你的英雄搭，再决定要不要改出装。"
  );
  return out.join("\n");
}
