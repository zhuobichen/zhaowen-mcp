/**
 * 云顶之弈（TFT）战绩。
 *
 * 与海斗的区别（实测，国服 26.x）：
 *   · 接口是 `/lol-match-history/v1/products/tft/{puuid}/matches?count=N`，
 *     参数是 `count`（不是海斗那套 begIndex/endIndex，传了就 400）；
 *   · **最多只返回最近 20 局**（count=100/500 也仍然 20，且没有任何翻页参数能用）；
 *   · 数据比海斗详细：名次(placement)、等级、最后回合、羁绊(traits)、棋子(units)、剩余金币、对玩家伤害。
 *
 * 队列中文名取自客户端自带的 `/lol-game-data/assets/v1/queues.json`（官方本地化，非第三方）。
 */
import { loadTftGames } from "./games.js";
import { getSummoner, lcuGet, type LcuSummoner } from "./lcu.js";
import { clientQueueNames, isRankedQueue, QUEUE_FALLBACK } from "./queues.js";
import { tftName } from "./store.js";

export interface TftGame {
  gameId: number;
  gameCreation: number;
  game_length?: number;
  queueId?: number;
  tft_set_number?: number;
  tft_set_core_name?: string;
  participants?: Array<{
    puuid: string;
    placement?: number;
    level?: number;
    last_round?: number;
    gold_left?: number;
    players_eliminated?: number;
    total_damage_to_players?: number;
    win?: boolean;
    riotIdGameName?: string;
    traits?: Array<{ name: string; num_units: number; style: number; tier_current: number; tier_total: number }>;
    units?: Array<{ character_id?: string; tier?: number; name?: string }>;
  }>;
}

/** 队列 id → 中文名（客户端优先，离线退回内置对照表），见 lib/queues.ts */
export { clientQueueNames as queueNames } from "./queues.js";

/** TFT 对局（最多最近 20 局 —— 这是接口上限，不是筛选结果） */
export async function getTftGames(puuid: string): Promise<TftGame[]> {
  const r: any = await lcuGet<any>(
    `/lol-match-history/v1/products/tft/${encodeURIComponent(puuid)}/matches?count=20`
  );
  const games: any[] = r?.games ?? [];
  return games.map((x: any) => x?.json ?? x) as TftGame[];
}

export const TFT_HISTORY_CAP = 20;

// ---------------------------------------------------------------- 工具实现

function myPart(game: TftGame, puuid: string) {
  return (game.participants ?? []).find((p) => p.puuid === puuid) ?? null;
}

const placementCn = (n: number) => (n === 1 ? "第 1 名 🥇" : `第 ${n} 名`);

export async function tftStats(args: { friend?: string; limit?: number } = {}): Promise<string> {
  const { resolveAccountByName, archivedAccounts, resolveMe } = await import("./identity.js");

  let target: { name: string; puuid: string; label: string };
  if (args.friend) {
    const r = await resolveAccountByName(args.friend);
    if (!r.matches.length) {
      const archived = await archivedAccounts();
      return [
        `没找到「${args.friend}」——${r.note}。`,
        archived.length
          ? `本地归档里能查的账号：${archived.slice(0, 6).map((a) => `${a.name}（${a.games} 局）`).join("、")}`
          : "本地归档里也没有账号记录（打开客户端查过一次就会被记下来）。",
      ].join("\n");
    }
    if (r.matches.length > 1) {
      return `「${args.friend}」匹配到多个账号，请指明：${r.matches
        .slice(0, 6)
        .map((m) => `${m.name}（${m.source}）`)
        .join("、")}`;
    }
    target = { name: r.matches[0].name, puuid: r.matches[0].puuid, label: `好友 ${r.matches[0].name}` };
  } else {
    const me = await resolveMe();
    if (!me) return "不知道要查谁：客户端没开，也没有固定过账号（先在线跑一次 get_my_account_status）。";
    target = { name: me.name, puuid: me.puuid, label: `我（${me.name}）` };
  }

  const res = await loadTftGames(target.puuid, target.name);
  const games = res.games as TftGame[];
  if (!games.length) return `${target.label} 的云顶对局记录是空的（${res.note}）。`;

  const qnames = await clientQueueNames();
  const rows = games
    .map((g) => {
      const p = myPart(g, target.puuid!);
      return p ? { game: g, p } : null;
    })
    .filter((x): x is { game: TftGame; p: NonNullable<ReturnType<typeof myPart>> } => !!x);

  const placements = rows.map((r) => r.p.placement ?? 0).filter((n) => n > 0);
  const n = placements.length;
  const avg = n ? placements.reduce((a, b) => a + b, 0) / n : 0;
  const first = placements.filter((x) => x === 1).length;
  const top4 = placements.filter((x) => x <= 4).length;
  const bottom4 = placements.filter((x) => x >= 5).length;

  // 名次分布
  const dist = new Map<number, number>();
  for (const p of placements) dist.set(p, (dist.get(p) ?? 0) + 1);
  const maxCount = Math.max(1, ...dist.values());
  const distLines = [...dist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([place, c]) => {
      const bar = "█".repeat(Math.max(1, Math.round((c / maxCount) * 24)));
      return `  第 ${place} 名 ${bar} ${c} 局`;
    });

  // 队列分布
  const byQueue = new Map<number, { count: number; last: number }>();
  for (const r of rows) {
    const q = r.game.queueId ?? 0;
    const cur = byQueue.get(q) ?? { count: 0, last: 0 };
    cur.count++;
    cur.last = Math.max(cur.last, r.game.gameCreation);
    byQueue.set(q, cur);
  }
  // 「排位」判定：国服队列名里直接带「排位」；另外兜底几个已知的排位 queueId
  const qname = (q: number) => qnames.get(q) ?? QUEUE_FALLBACK[q] ?? `队列 ${q}`;
  const isRanked = (q: number) => isRankedQueue(q, qnames.get(q));
  const rankedRows = rows.filter((r) => isRanked(r.game.queueId ?? 0));
  const fmtShort = (t: number) =>
    new Date(t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "short" });
  const queueLines = [...byQueue.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(
      ([id, c]) =>
        `  · ${qname(id)}：${c.count} 局${isRanked(id) ? "（排位）" : ""} · 最近一次 ${fmtShort(c.last)}`
    );

  // 「上次排位是什么时候」单独一行给出来（这是最常被问的问题）
  const lastRanked = rankedRows.length ? Math.max(...rankedRows.map((r) => r.game.gameCreation)) : null;
  const rankedLine = lastRanked
    ? `上次排位：${fmtShort(lastRanked)}（${
        qname(rankedRows.find((r) => r.game.gameCreation === lastRanked)?.game.queueId ?? 0)
      }，本窗口内排位共 ${rankedRows.length} 局）`
    : "上次排位：本次窗口里没有排位对局（国服排位队列名带「排位」，如「云顶之弈 (自然之力 排位 BETA测试)」）";

  // 官方中文名（来自 CloudDragon 的云顶数据，refresh 时只留了最近几个赛季；取不到就退回内部标识）
  // 对局记录里的标识是小写的（tft16_atakhan），官方文件里是 TFT16_Atakhan，
  // 所以走 tftName() 的大小写无关查找，而不是直接查表（直查会整片落空）。
  const cn = (kind: "traits" | "champions" | "items", id?: string) => {
    if (!id) return "?";
    return tftName(kind, id) ?? id.replace(/^TFT\d+_/i, "").replace(/^TFT_Item_/i, "");
  };
  const traitCn = (id: string) => cn("traits", id);
  const champCn = (id?: string) => cn("champions", id);
  const itemCn = (id?: string) => cn("items", id);

  const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "short" });
  const detail = rows
    .slice(0, args.limit ?? 10)
    .map((r) => {
      const mins = Math.round((r.game.game_length ?? 0) / 60);
      const q = qname(r.game.queueId ?? 0);
      // 成型羁绊（style>=2 表示已激活的高阶羁绊），按强度排序
      const traits = (r.p.traits ?? [])
        .filter((t) => t.style >= 2)
        .sort((a, b) => b.style - a.style || b.num_units - a.num_units)
        .slice(0, 3)
        .map((t) => `${traitCn(t.name)}(${t.num_units})`)
        .join(" ");
      // 主力棋子：星级高的优先，其次费用(稀有度)高的
      const units = (r.p.units ?? [])
        .slice()
        .sort((a: any, b: any) => (b.tier ?? 0) - (a.tier ?? 0) || (b.rarity ?? 0) - (a.rarity ?? 0))
        .slice(0, 3)
        .map((u: any) => {
          const items = (u.itemNames ?? []).slice(0, 2).map(itemCn);
          return `${champCn(u.character_id)}${u.tier ?? ""}★${items.length ? `[${items.join("+")}]` : ""}`;
        })
        .join(" ");
      return (
        `  ${fmtTime(r.game.gameCreation)} · ${q} · ${placementCn(r.p.placement ?? 0)} · Lv${r.p.level ?? "?"} · ` +
        `${mins} 分 · 金币 ${r.p.gold_left ?? "?"}` +
        `${traits ? `
      羁绊：${traits}` : ""}${units ? `
      主力：${units}` : ""}`
      );
    });

  const times = rows.map((r) => r.game.gameCreation).sort((a, b) => a - b);

  return [
    `${target.label} · 云顶之弈战绩`,
    `本次统计 ${rows.length} 局（${fmtTime(times[0])} ~ ${fmtTime(times[times.length - 1])}）`,
    `数据来源：${res.note}`,
    "",
    `平均名次：${avg.toFixed(2)}｜吃鸡 ${first} 次（${n ? ((first / n) * 100).toFixed(0) : 0}%）｜前四 ${top4} 局（${n ? ((top4 / n) * 100).toFixed(0) : 0}%）｜后四 ${bottom4} 局`,
    "",
    "名次分布：",
    ...distLines,
    "",
    rankedLine,
    "",
    "队列分布（含每个队列最近一次）：",
    ...queueLines,
    "",
    `最近 ${Math.min(args.limit ?? 10, rows.length)} 局明细：`,
    ...detail,
    "",
    `⚠ 边界：云顶的对局接口最多只给**最近 ${TFT_HISTORY_CAP} 局**（count 参数给多大都一样，也没有可用的翻页参数），` +
      "所以这是窗口快照、不是生涯总场次。羁绊/棋子中文名取自官方云顶数据（CloudDragon）。",
  ].join("\n");
}
