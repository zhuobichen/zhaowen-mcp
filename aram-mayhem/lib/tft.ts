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
import { getSummoner, lcuGet, type LcuSummoner } from "./lcu.js";
import { loadData } from "./store.js";

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

/** 客户端自带的队列 id → 中文名（带内存缓存） */
let queueCache: Map<number, string> | null = null;
export async function queueNames(): Promise<Map<number, string>> {
  if (queueCache) return queueCache;
  const map = new Map<number, string>();
  try {
    const raw: any = await lcuGet<any>("/lol-game-data/assets/v1/queues.json");
    const list: any[] = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    for (const q of list) {
      if (q && typeof q.id === "number") map.set(q.id, String(q.name ?? q.shortName ?? q.id).trim());
    }
  } catch {
    /* 拿不到就退回队列 id 显示 */
  }
  queueCache = map;
  return map;
}

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
  const { clientStatus } = await import("./lcu.js");
  const status = await clientStatus();
  if (!status.reachable) {
    return `读不到云顶战绩：${status.error}\n（需要游戏客户端正在运行。）`;
  }

  let target: { name: string; puuid: string | null; label: string };
  if (args.friend) {
    const { findFriend } = await import("./friends.js");
    const hits = await findFriend(args.friend);
    if (!hits.length) return `好友列表里没找到「${args.friend}」。`;
    if (hits.length > 1) {
      return `「${args.friend}」匹配到多个好友：${hits.slice(0, 6).map((f) => `${f.gameName}#${f.gameTag}`).join("、")}`;
    }
    target = { name: hits[0].gameName, puuid: hits[0].puuid, label: `好友 ${hits[0].gameName}#${hits[0].gameTag}` };
  } else {
    const me: LcuSummoner = await getSummoner();
    target = {
      name: me.displayName || me.gameName || "未知账号",
      puuid: me.puuid ?? null,
      label: `我（${me.displayName || me.gameName || "未命名"}）`,
    };
  }
  if (!target.puuid) return `拿不到 ${target.name} 的 puuid，读不到云顶战绩。`;

  const games = (await getTftGames(target.puuid)).sort((a, b) => b.gameCreation - a.gameCreation);
  if (!games.length) return `${target.label} 的云顶对局记录是空的（客户端只保留最近若干局，没打过就查不到）。`;

  const qnames = await queueNames();
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
  const byQueue = new Map<number, number>();
  for (const r of rows) byQueue.set(r.game.queueId ?? 0, (byQueue.get(r.game.queueId ?? 0) ?? 0) + 1);
  const queueLines = [...byQueue.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, c]) => `  · ${qnames.get(id) ?? `队列 ${id}`}：${c} 局`);

  // 官方中文名（来自 CloudDragon 的云顶数据，refresh 时只留了最近几个赛季；取不到就退回内部标识）
  const names = loadData().tftNames;
  const cn = (map: Record<string, string>, id?: string) =>
    id ? map[id] ?? id.replace(/^TFT\d+_/, "").replace(/^TFT_Item_/, "") : "?";
  const traitCn = (id: string) => cn(names.traits, id);
  const champCn = (id?: string) => cn(names.champions, id);
  const itemCn = (id?: string) => cn(names.items, id);

  const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "short" });
  const detail = rows
    .slice(0, args.limit ?? 10)
    .map((r) => {
      const mins = Math.round((r.game.game_length ?? 0) / 60);
      const q = qnames.get(r.game.queueId ?? 0) ?? `队列 ${r.game.queueId}`;
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
    `本地客户端保留的最近 ${rows.length} 局（${fmtTime(times[0])} ~ ${fmtTime(times[times.length - 1])}）`,
    "",
    `平均名次：${avg.toFixed(2)}｜吃鸡 ${first} 次（${n ? ((first / n) * 100).toFixed(0) : 0}%）｜前四 ${top4} 局（${n ? ((top4 / n) * 100).toFixed(0) : 0}%）｜后四 ${bottom4} 局`,
    "",
    "名次分布：",
    ...distLines,
    "",
    "队列分布：",
    ...queueLines,
    "",
    `最近 ${Math.min(args.limit ?? 10, rows.length)} 局明细：`,
    ...detail,
    "",
    `⚠ 边界：云顶的对局接口最多只给**最近 ${TFT_HISTORY_CAP} 局**（count 参数给多大都一样，也没有可用的翻页参数），` +
      "所以这是窗口快照、不是生涯总场次。羁绊/棋子中文名取自官方云顶数据（CloudDragon）。",
  ].join("\n");
}
