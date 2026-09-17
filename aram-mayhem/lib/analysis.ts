/**
 * 对局分析（本人与好友共用）。
 *
 * 输入本地客户端读到的对局列表，输出：胜率、常玩英雄、符文使用统计（对照版本榜）、
 * 实际拿过的「陷阱」符文、还没拿过的「神级」符文。
 *
 * 诚实边界：符文字段（playerAugment1..6）读不到时报读不到，不做任何推测填充。
 */
import {
  augmentIdsOf,
  getGameDetail,
  isMayhemGame,
  myParticipantId,
  type LcuGameSummary,
} from "./lcu.js";
import { loadData } from "./store.js";
import type { Augment } from "./types.js";

export interface AnalyzeOptions {
  /** 统计对象在客户端里的 puuid（用于定位「本人」在 10 个参与者里的位置） */
  ownerPuuid: string | null;
  /** 统计对象的显示名（兜底匹配用） */
  ownerName?: string | null;
  /** 标题里的称呼，如「我」/「好友 自己的丁ding」 */
  subject: string;
  /** 本次取到的对局总数（接口声明值，用于说明数据边界） */
  cachedTotal: number;
  /** 数据边界说明（本人与好友的口径不同，由调用方传入） */
  dataNote?: string;
}

export async function analyzeMayhemGames(
  allGames: LcuGameSummary[],
  opts: AnalyzeOptions
): Promise<string> {
  const games = allGames.filter(isMayhemGame);
  const who = opts.subject;
  if (!games.length) {
    return `本地记录里没有识别到${who}的海斗对局，无法统计。`;
  }

  const d = loadData();
  const championName = (numericId: number | null | undefined): string | null => {
    if (numericId == null) return null;
    const cid = d.championIds[String(numericId)];
    if (!cid) return `英雄#${numericId}`;
    return d.championById.get(cid.id)?.name ?? cid.name;
  };
  const augmentByOfficialId = (numericId: number): Augment | null =>
    d.augments.find((a) => a.officialId === numericId) ?? null;

  const pidOf = (g: LcuGameSummary) =>
    myParticipantId(g, { puuid: opts.ownerPuuid ?? undefined, name: (opts.ownerName ?? "").split("#")[0] });

  interface Row {
    augments: number[];
    win: boolean | null;
    championNumber: number | null;
  }
  const rows: Row[] = [];
  let augmentFieldSeen = false;

  for (const g of games) {
    const pid = pidOf(g);
    let ids = augmentIdsOf(g, pid);
    if (!ids.length) {
      // 摘要里没有就试详情接口（符文有时只在详情里）
      try {
        const detail = await getGameDetail(g.gameId);
        ids = augmentIdsOf(detail, pid ?? myParticipantId(detail, { puuid: opts.ownerPuuid ?? undefined }));
      } catch {
        /* 详情拿不到就按没有处理，下面会如实说明 */
      }
    }
    if (ids.length) augmentFieldSeen = true;
    const me2 = (g.participants ?? []).find((p) => p.participantId === pid) ?? (g.participants ?? [])[0];
    rows.push({
      augments: ids,
      win: me2?.stats?.win ?? null,
      championNumber: me2?.championId ?? null,
    });
  }

  if (!augmentFieldSeen) {
    return [
      `${who}的 ${games.length} 把海斗对局里，这次没有读到符文字段（playerAugment1..6），统计不出符文选择。`,
      "",
      "常见原因（按可能性排序）：",
      "  · 对局记录刚同步，部分早期对局的详情还没拉全 —— 稍后再试通常就好；",
      "  · 客户端版本差异（实测国服 26.x 是上报的）；",
      "  · 这些对局确实没选到符文（秒退/极端短局）。",
      "本工具不会用猜测的符文填充统计 —— 读不到就报读不到。",
    ].join("\n");
  }

  // 符文使用与胜率
  const stat = new Map<number, { games: number; wins: number }>();
  for (const r of rows) {
    for (const id of r.augments) {
      const cur = stat.get(id) ?? { games: 0, wins: 0 };
      cur.games += 1;
      if (r.win === true) cur.wins += 1;
      stat.set(id, cur);
    }
  }
  const ranked = [...stat.entries()].sort((a, b) => b[1].games - a[1].games);
  const decided = rows.filter((r) => r.win !== null);
  const wins = decided.filter((r) => r.win === true).length;

  // 常玩英雄
  const champCount = new Map<string, { name: string; games: number; wins: number }>();
  for (const r of rows) {
    const name = championName(r.championNumber);
    if (!name) continue;
    const cur = champCount.get(name) ?? { name, games: 0, wins: 0 };
    cur.games += 1;
    if (r.win === true) cur.wins += 1;
    champCount.set(name, cur);
  }
  const topChamps = [...champCount.values()].sort((a, b) => b.games - a.games).slice(0, 5);

  // 实际拿过的「陷阱」符文（社区站按英雄×符文标注）
  const trapHits: string[] = [];
  for (const r of rows) {
    const champName = championName(r.championNumber);
    const numeric = r.championNumber;
    if (!champName || numeric == null) continue;
    const cid = d.championIds[String(numeric)];
    if (!cid) continue;
    for (const id of r.augments) {
      const aug = augmentByOfficialId(id);
      if (!aug) continue;
      const card = d.comboCards.find(
        (c) => c.championId === cid.id && c.augmentId === aug.id && c.types.includes("陷阱")
      );
      if (card) {
        trapHits.push(`${champName} 拿 ${aug.name}${card.desc ? ` —— ${card.desc}` : ""}`);
      }
    }
  }

  const out: string[] = [
    `${who}：统计 ${rows.length} 把海斗（本次共取到 ${opts.cachedTotal} 把对局记录）`,
    `胜率：${wins}/${decided.length}${decided.length ? ` (${Math.round((wins / decided.length) * 100)}%)` : ""}`,
  ];
  if (topChamps.length) {
    out.push(
      `常玩英雄：${topChamps.map((v) => `${v.name}(${v.games}把${v.wins ? `/${v.wins}胜` : ""})`).join("、")}`
    );
  }

  out.push("", "拿过的符文（按出现次数；「版本名次」是社区站强度榜）：");
  for (const [id, s] of ranked.slice(0, 20)) {
    const a = augmentByOfficialId(id);
    if (!a) {
      out.push(`  · 未知符文 id ${id}：出现 ${s.games} 把${s.wins ? `，赢 ${s.wins}` : ""}（本地符文库没有，可能是新符文或已下架）`);
      continue;
    }
    out.push(
      `  · ${a.name}：出现 ${s.games} 把，赢 ${s.wins} 把` +
        `${a.stats?.rank ? ` · 版本第 ${a.stats.rank} 名` : " · 未进版本榜单"}` +
        `${a.stats?.winRate ? `（版本胜率 ${a.stats.winRate}）` : ""}`
    );
  }

  const known = ranked
    .map(([id, s]) => ({ a: augmentByOfficialId(id), s }))
    .filter((x): x is { a: Augment; s: { games: number; wins: number } } => !!x.a);
  const weak = known.filter((x) => (x.a.stats?.rank ?? 0) > 100);
  if (weak.length) {
    out.push("", "其中版本榜名次偏后的（>100 名）：");
    for (const x of weak.slice(0, 8)) out.push(`  · ${x.a.name}（第 ${x.a.stats?.rank} 名，拿了 ${x.s.games} 把）`);
  }

  if (trapHits.length) {
    out.push("", `⚠ 实际拿过的「陷阱」符文（社区站按英雄×符文标注，共 ${trapHits.length} 次）：`);
    for (const t of [...new Set(trapHits)].slice(0, 8)) out.push(`  · ${t}`);
  }

  // 常玩英雄里还没拿过的「神级」符文
  const takenIds = new Set(
    ranked.map(([id]) => augmentByOfficialId(id)?.id).filter((x): x is string => !!x)
  );
  const suggestions: string[] = [];
  for (const v of topChamps) {
    const local = d.champions.find((c) => c.name === v.name);
    if (!local) continue;
    for (const card of d.cardsByChampion.get(local.id) ?? []) {
      if (!card.types.includes("神级") || takenIds.has(card.augmentId)) continue;
      const aug = d.augmentById.get(card.augmentId);
      if (!aug || aug.availability !== "live") continue;
      suggestions.push(`${card.championName} 拿 ${aug.name}（${card.desc ?? "社区站列为神级"}）`);
    }
  }
  if (suggestions.length) {
    out.push("", "常玩英雄里还没拿过的「神级」符文（可以留意）：");
    for (const s of [...new Set(suggestions)].slice(0, 6)) out.push(`  · ${s}`);
  }

  out.push(
    "",
    opts.dataNote ??
      "说明：场次来自客户端对局记录，不是生涯总场次；样本量小时胜率没有统计意义。",
    "符文 id 取自本地对局记录（playerAugment1..6），与官方符文库 id 对照。"
  );
  return out.join("\n");
}
