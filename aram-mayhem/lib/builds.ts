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
import { isBuildItem, loadData } from "./store.js";

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

export async function analyzeBuilds(
  opts: { games?: number; minGames?: number; puuid?: string; name?: string } = {}
): Promise<BuildReport> {
  const d = loadData();
  // 调用方（例如报告）可以直接给身份；不给才退回「当前登录账号」
  const me = opts.puuid ? { puuid: opts.puuid, name: opts.name ?? "" } : await resolveMe();
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
      if (!isBuildItem(d.items[String(id)])) continue;
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
    note: `${games.length} 把海斗中 ${counted} 把读到了出装数据；只统计**成装与二级鞋**（≥${minGames} 次）—— 散件不算，` +
      `散件留在最终背包多半只说明那局结束得早，不是你的出装选择。`,
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

  // 这两段都是**从 N 条里挑最大值**，和 get_augment_pairs 那处是同一类问题 ——
  // 「出了它胜率最高」在几十件装备里挑最高，光噪声就能造出不小的极差。
  // 门槛扫描量过（npm run thresholds:sweep）：门槛 5→15→30 时榜首的样本 / 倍数是
  // 6 局 83.3%（2.2 倍）→ 18 局 77.8%（2.8 倍）→ 69 局 59.4%（1.6 倍）——
  // 也就是说「≥10 把」这一档的榜首多半只有十来局，2 倍出头正是「挑最大」能造出的水平。
  // 所以两段都带上候选数、噪声尺度、以及逐条的倍数。
  const seOf = (it: ItemStat) => Math.sqrt(Math.max(it.winRate * (100 - it.winRate), 1) / Math.max(it.games, 1));
  const kOf = (it: ItemStat) => (seOf(it) > 0 ? Math.abs(it.winRate - 50) / seOf(it) : 0);
  /** N 条里挑最大时，纯噪声能造出的最大偏离（百分点），按 √(2·ln N) × 中等标准误估 */
  const noiseCeil = (list: ItemStat[]) => {
    const ses = list.map(seOf).sort((a, b) => a - b);
    if (!ses.length) return 0;
    return ses[Math.floor(ses.length / 2)] * Math.sqrt(2 * Math.log(Math.max(list.length, 2)));
  };
  const fmt = (it: ItemStat) => `${it.name}：${it.games} 把 ${it.winRate.toFixed(0)}%（约是噪声的 ${kOf(it).toFixed(1)} 倍）`;

  const strongPool = r.items.filter((x) => x.games >= 10);
  const strong = [...strongPool].sort((a, b) => b.winRate - a.winRate).slice(0, 6);
  if (strong.length) {
    const ceil = noiseCeil(strongPool);
    const over = Math.abs(strong[0].winRate - 50) >= ceil;
    out.push(
      "",
      `出了它胜率最高（≥10 把，候选 ${strongPool.length} 件）：` +
        (over
          ? "最高的一件超过了噪声能造出的水平，但逐条看各自的倍数更可靠。"
          : `**都还在噪声范围内** —— 从 ${strongPool.length} 件里挑最高，光噪声就能造出约 ${ceil.toFixed(1)} 个百分点的差距，先当线索。`)
    );
    for (const it of strong) out.push(`  · ${fmt(it)}`);
  }
  const weakPool = r.items.filter((x) => x.games >= 15);
  const weak = [...weakPool].sort((a, b) => a.winRate - b.winRate).slice(0, 6);
  if (weak.length) {
    const ceil = noiseCeil(weakPool);
    const under = Math.abs(weak[0].winRate - 50) >= ceil;
    out.push(
      "",
      `出得多但胜率偏低（≥15 把，候选 ${weakPool.length} 件）：` +
        (under
          ? "可以考虑换。"
          : // 全在噪声里时不能再说「可以考虑换」—— 那是在让人照着噪声改出装。
            `**不要据此换装**：这一档全都还在噪声范围内（从 ${weakPool.length} 件里挑最低，` +
            `光噪声就能造出约 ${ceil.toFixed(1)} 个百分点的差距），下面这些「偏低」跟 50% 分不开。`)
    );
    for (const it of weak) out.push(`  · ${fmt(it)}`);
  }
  out.push("", "说明：装备按「在你背包里出现过」统计（数据是槽位不是购买顺序）；只算成装与二级鞋，散件、消耗品与饰品都不计入。");
  return out.join("\n");
}
