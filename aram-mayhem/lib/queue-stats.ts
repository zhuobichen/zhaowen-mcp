/**
 * 按队列拆开看：海斗其实不止一个队列（2400 海克斯大乱斗 / 2410 巅峰赛 /
 * 2450 经典模式版 / 4310 官方没给名字的那个），混在一起统计会把不同规则的局搅在一起。
 *
 * 这里把对局按 queueId 分桶，给出各自的场次、胜率、时长、英雄集中度，
 * 并如实标注：样本少的队列不下结论、参数未知的队列直接说「官方无名称」。
 *
 * 只读；数据来自 loadLolGames / loadTftGames（客户端 ∪ SGP ∪ 归档）。
 */
import { loadLolGames, loadTftGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { isRankedQueue, QUEUE_FALLBACK, queueName } from "./queues.js";
import { loadData } from "./store.js";

export interface QueueBucket {
  queueId: number;
  name: string;
  /** 名字是内置兜底表给的还是客户端官方本地化给的 */
  nameSource: "client" | "fallback" | "unknown";
  games: number;
  wins: number;
  winRate: number;
  /** 平均时长（分钟） */
  avgMinutes: number;
  kda: number;
  /** 玩过的不同英雄数 */
  champions: number;
  /** 云顶：平均名次 */
  avgPlacement: number | null;
  ranked: boolean;
  firstPlayed: number | null;
  lastPlayed: number | null;
  /** 样本是否够下结论 */
  enough: boolean;
}

export interface QueueStatsReport {
  name: string;
  kind: "lol" | "tft";
  totalGames: number;
  buckets: QueueBucket[];
  note: string;
}

export async function queueStats(
  opts: { who?: string; kind?: "lol" | "tft"; minGames?: number } = {}
): Promise<QueueStatsReport> {
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

  const kind = opts.kind ?? "lol";
  const d = loadData();
  const clientNames = await (await import("./queues.js")).clientQueueNames();

  interface Acc {
    games: number;
    wins: number;
    minutes: number;
    k: number;
    dd: number;
    a: number;
    placeSum: number;
    placeN: number;
    champs: Set<string>;
    first: number | null;
    last: number | null;
  }
  const map = new Map<number, Acc>();

  const touch = (q: number, t: number): Acc => {
    let c = map.get(q);
    if (!c) {
      c = { games: 0, wins: 0, minutes: 0, k: 0, dd: 0, a: 0, placeSum: 0, placeN: 0, champs: new Set(), first: null, last: null };
      map.set(q, c);
    }
    c.first = c.first == null ? t : Math.min(c.first, t);
    c.last = c.last == null ? t : Math.max(c.last, t);
    return c;
  };

  if (kind === "tft") {
    const res = await loadTftGames(puuid, name);
    for (const g of res.games) {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      if (!p?.placement) continue;
      const c = touch(g.queueId ?? 0, g.gameCreation ?? 0);
      c.games++;
      if (Number(p.placement) === 1) c.wins++;
      c.placeSum += Number(p.placement);
      c.placeN++;
      c.minutes += Math.round((g.gameDuration ?? 0) / 60);
    }
  } else {
    const res = await loadLolGames(puuid, 2000, name);
    for (const g of res.games) {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      const s: any = p?.stats ?? {};
      if (s.win === undefined) continue;
      const c = touch(g.queueId ?? 0, g.gameCreation ?? 0);
      c.games++;
      if (s.win === true) c.wins++;
      c.minutes += Math.round((g.gameDuration ?? 0) / 60);
      c.k += Number(s.kills ?? 0);
      c.dd += Number(s.deaths ?? 0);
      c.a += Number(s.assists ?? 0);
      const cid = d.championIds[String(p?.championId)];
      if (cid) c.champs.add(cid.id);
    }
  }

  const minGames = opts.minGames ?? 10;
  const totalGames = [...map.values()].reduce((s, c) => s + c.games, 0);
  const buckets: QueueBucket[] = [...map.entries()]
    .map(([queueId, c]) => {
      const fromClient = clientNames.get(queueId);
      const fromFallback = QUEUE_FALLBACK[queueId];
      return {
        queueId,
        name: fromClient ?? fromFallback ?? `未登记队列 ${queueId}`,
        nameSource: (fromClient ? "client" : fromFallback ? "fallback" : "unknown") as "client" | "fallback" | "unknown",
        games: c.games,
        wins: c.wins,
        winRate: c.games ? (c.wins / c.games) * 100 : 0,
        avgMinutes: c.games ? c.minutes / c.games : 0,
        kda: (c.k + c.a) / Math.max(c.dd, 1),
        champions: c.champs.size,
        avgPlacement: c.placeN ? c.placeSum / c.placeN : null,
        ranked: isRankedQueue(queueId, fromClient),
        firstPlayed: c.first,
        lastPlayed: c.last,
        enough: c.games >= minGames,
      };
    })
    .sort((a, b) => b.games - a.games);

  const unknown = buckets.filter((b) => b.nameSource === "unknown");
  return {
    name,
    kind,
    totalGames,
    buckets,
    note:
      `${totalGames} 局分布在 ${buckets.length} 个队列上。` +
      `样本 <${minGames} 局的队列照样列出，但不下胜率结论。` +
      (unknown.length
        ? `⚠ 其中 ${unknown.map((b) => `${b.queueId}`).join("、")} 号队列客户端与内置表都没有名字（新队列或已下线），只按 id 显示。`
        : ""),
  };
}

/** 文本输出 */
export async function queueStatsText(opts: { who?: string; kind?: "lol" | "tft"; minGames?: number } = {}): Promise<string> {
  let r: QueueStatsReport;
  try {
    r = await queueStats(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const fmtDate = (t: number | null) =>
    t ? new Date(t).toLocaleDateString("zh-CN", { year: "2-digit", month: "2-digit", day: "2-digit" }) : "—";

  const out: string[] = [];
  out.push(`${r.name} · 按队列拆分（${r.kind === "tft" ? "云顶" : "英雄联盟"}）`);
  out.push(r.note);
  out.push("");

  for (const b of r.buckets) {
    const flag = b.enough ? "" : "  ← 样本少，不作结论";
    out.push(
      `${b.name}${b.ranked ? "（排位）" : ""}${b.nameSource === "unknown" ? "（官方无名称）" : ""}` +
        ` [${b.queueId}]：${b.games} 局`
    );
    out.push(
      b.avgPlacement != null
        ? `    平均名次 ${b.avgPlacement.toFixed(2)} · 吃鸡 ${b.wins} 次 · 平均时长 ${b.avgMinutes.toFixed(0)} 分`
        : `    胜率 ${b.winRate.toFixed(1)}% · KDA ${b.kda.toFixed(2)} · 平均时长 ${b.avgMinutes.toFixed(0)} 分 · ${b.champions} 个英雄`
    );
    out.push(`    ${fmtDate(b.firstPlayed)} ~ ${fmtDate(b.lastPlayed)}${flag}`);
  }

  const thin = r.buckets.filter((b) => !b.enough);
  if (thin.length) {
    out.push(
      "",
      `说明：${thin.map((b) => b.name).join("、")} 都不到 ${opts.minGames ?? 10} 局，所以只报数字不下结论。`,
      "为什么要拆开：不同队列的规则与数值并不一样（海斗的巅峰赛、经典模式版，和普通海斗是两个池子），",
      "混在一起算胜率会把它们搅在一起；而且一个队列打了 1~2 把的胜率本身也没有意义。"
    );
  }
  return out.join("\n");
}

/** 只把队列分布压成一行（给报告页脚之类用） */
export function queueSummaryLine(buckets: QueueBucket[]): string {
  return buckets
    .filter((b) => b.games >= 2)
    .map((b) => `${b.name} ${b.games} 局`)
    .join(" · ");
}
