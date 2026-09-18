/**
 * 本地对局归档。
 *
 * 为什么需要：客户端接口给的是**滑动窗口**（海斗最多最近 200 局、云顶最多最近 20 局），
 * 关掉客户端更是啥都读不到。这里把每次读到的对局按 gameId 并入本地归档：
 *   · 归档只增不减 —— 攒得越久，覆盖的时间跨度越长（能超过接口窗口上限）；
 *   · 客户端没开时也能用归档做分析（输出里会如实标注数据来源与截止时间）；
 *   · 只保留分析需要的字段，并把体积压住（英雄/海斗只留自己那行；云顶额外留自己那局的羁绊与棋子）。
 *
 * 文件：data/archive/lol-matches.json、data/archive/tft-matches.json
 * （可用环境变量 MAYHEM_ARCHIVE_DIR 覆盖目录，便于测试）
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIR = fileURLToPath(new URL("../data/archive/", import.meta.url));
const MAX_GAMES = 5000; // 归档上限，超出按时间淘汰最老的

export type ArchiveKind = "lol" | "tft";

/** 归档里的一局（两种模式共用，缺的字段就是该模式没有） */
export interface ArchivedGame {
  gameId: number;
  gameCreation: number;
  gameDuration: number;
  gameMode: string;
  queueId: number;
  /** 这局是替哪个账号存的（我们的查询目标） */
  puuid?: string | null;
  /** 查询目标当时的显示名（离线时用来认人） */
  puuidName?: string | null;
  /** 这局是从哪来的：lcu=本地客户端；mlol=掌盟（后续接入）；其它来源按名字标 */
  source?: string;
  participants: Array<{
    participantId: number;
    puuid?: string | null;
    championId?: number;
    teamId?: number;
    /** 英雄联盟：分析用得到的统计字段子集 */
    stats?: Record<string, unknown>;
    /** 云顶：名次/等级等（只对目标账号保留羁绊与棋子） */
    placement?: number;
    level?: number;
    gold_left?: number;
    last_round?: number;
    players_eliminated?: number;
    total_damage_to_players?: number;
    traits?: Array<{ name: string; num_units: number; style: number }>;
    units?: Array<{ character_id?: string; tier?: number; rarity?: number; itemNames?: string[] }>;
  }>;
}

interface ArchiveFile {
  updatedAt: string;
  games: Record<string, ArchivedGame>;
}

export function archiveDir(): string {
  return process.env.MAYHEM_ARCHIVE_DIR || DEFAULT_DIR;
}

function fileOf(kind: ArchiveKind): string {
  return path.join(archiveDir(), kind === "lol" ? "lol-matches.json" : "tft-matches.json");
}

const LOL_STAT_KEYS = [
  "win",
  "kills",
  "deaths",
  "assists",
  "goldEarned",
  "totalDamageDealtToChampions",
  "totalDamageTaken",
  "totalHeal",
  "visionScore",
  "champLevel",
  "playerAugment1",
  "playerAugment2",
  "playerAugment3",
  "playerAugment4",
  "playerAugment5",
  "playerAugment6",
  "playerSubteamId",
];

/** 客户端返回的一局 → 归档形态（kind 决定裁哪些字段） */
export function slimGame(
  raw: any,
  kind: ArchiveKind,
  puuid?: string | null,
  puuidName?: string | null,
  source: string = "lcu"
): ArchivedGame {
  const isTarget = (p: any) => !!puuid && p?.puuid === puuid;
  const participants = (raw?.participants ?? []).map((p: any) => {
    const base: ArchivedGame["participants"][number] = {
      participantId: p?.participantId ?? 0,
      puuid: p?.puuid ?? null,
    };
    if (kind === "lol") {
      base.championId = p?.championId;
      base.teamId = p?.teamId;
      const st: Record<string, unknown> = {};
      for (const k of LOL_STAT_KEYS) if (p?.stats?.[k] !== undefined) st[k] = p.stats[k];
      base.stats = st;
    } else {
      base.championId = undefined;
      base.placement = p?.placement;
      base.level = p?.level;
      base.gold_left = p?.gold_left;
      base.last_round = p?.last_round;
      base.players_eliminated = p?.players_eliminated;
      base.total_damage_to_players = p?.total_damage_to_players;
      // 只给目标账号留羁绊/棋子（否则 8 个人 × 20 局会太占地方）
      if (isTarget(p)) {
        base.traits = (p?.traits ?? []).map((t: any) => ({
          name: t?.name,
          num_units: t?.num_units,
          style: t?.style,
        }));
        base.units = (p?.units ?? []).map((u: any) => ({
          character_id: u?.character_id,
          tier: u?.tier,
          rarity: u?.rarity,
          itemNames: u?.itemNames,
        }));
      }
    }
    return base;
  });

  return {
    gameId: raw?.gameId,
    gameCreation: raw?.gameCreation ?? Number(raw?.game_datetime ?? 0),
    gameDuration: Math.round(raw?.gameDuration ?? raw?.game_length ?? 0),
    gameMode: String(raw?.gameMode ?? (kind === "tft" ? "TFT" : "")),
    queueId: Number(raw?.queueId ?? 0),
    puuid: puuid ?? null,
    puuidName: puuidName ?? null,
    source,
    participants,
  };
}

/** 归档形态 → 客户端对局摘要形态（让上层分析代码不用区分来源） */
export function expandGame(g: ArchivedGame): any {
  return {
    gameId: g.gameId,
    gameCreation: g.gameCreation,
    gameDuration: g.gameDuration,
    gameMode: g.gameMode,
    queueId: g.queueId,
    participants: g.participants.map((p) => ({
      participantId: p.participantId,
      championId: p.championId ?? 0,
      teamId: p.teamId ?? 0,
      puuid: p.puuid,
      stats: p.stats ?? {},
      placement: p.placement,
      level: p.level,
      gold_left: p.gold_left,
      last_round: p.last_round,
      players_eliminated: p.players_eliminated,
      total_damage_to_players: p.total_damage_to_players,
      traits: p.traits,
      units: p.units,
    })),
    participantIdentities: g.participants.map((p) => ({
      participantId: p.participantId,
      player: { puuid: p.puuid ?? undefined },
    })),
  };
}

async function readArchive(kind: ArchiveKind): Promise<ArchiveFile> {
  const f = fileOf(kind);
  if (!existsSync(f)) return { updatedAt: "", games: {} };
  try {
    return JSON.parse(await readFile(f, "utf8")) as ArchiveFile;
  } catch {
    return { updatedAt: "", games: {} };
  }
}

export interface MergeResult {
  added: number;
  known: number;
  total: number;
}

/** 并入归档（同 gameId 不覆盖，保留首次写入的那份） */
export async function mergeIntoArchive(
  kind: ArchiveKind,
  games: any[],
  puuid?: string | null,
  puuidName?: string | null,
  source: string = "lcu"
): Promise<MergeResult> {
  const cur = await readArchive(kind);
  let added = 0;
  let known = 0;
  for (const g of games ?? []) {
    if (!g?.gameId) continue;
    const key = String(g.gameId);
    const incoming = slimGame(g, kind, puuid, puuidName, source);
    const existing = cur.games[key];
    if (existing) {
      known++;
      // 已有记录若缺符文（SGP 摘要没有 playerAugment），而这次带来了，就用这份更全的覆盖
      const hasAug = (x: ArchivedGame) => x.participants?.some((pp) => pp.stats && pp.stats.playerAugment1);
      if (!hasAug(existing) && hasAug(incoming) && !(existing.source === "lcu")) {
        cur.games[key] = incoming;
        added++;
      }
      continue;
    }
    cur.games[key] = incoming;
    added++;
  }
  const entries = Object.entries(cur.games);
  if (entries.length > MAX_GAMES) {
    entries.sort((a, b) => b[1].gameCreation - a[1].gameCreation);
    cur.games = Object.fromEntries(entries.slice(0, MAX_GAMES));
  }
  if (added > 0) {
    cur.updatedAt = new Date().toISOString();
    await mkdir(archiveDir(), { recursive: true });
    await writeFile(fileOf(kind), JSON.stringify(cur), "utf8");
  }
  return { added, known, total: Object.keys(cur.games).length };
}

/** 归档里属于该账号的对局（时间倒序，已展开成客户端摘要形态） */
export async function archivedGamesFor(kind: ArchiveKind, puuid?: string | null): Promise<any[]> {
  const a = await readArchive(kind);
  const games = Object.values(a.games).filter((g) => !puuid || g.puuid === puuid);
  return games.sort((x, y) => y.gameCreation - x.gameCreation).map(expandGame);
}

export interface ArchiveStats {
  kind: ArchiveKind;
  total: number;
  updatedAt: string;
  from: number | null;
  to: number | null;
  byMode: Record<string, number>;
  byQueue: Record<string, number>;
  /** 归档里出现过的账号（puuid → 名字与局数），离线时用来认人 */
  accounts: Array<{ puuid: string; name: string | null; games: number }>;
  /** 按来源统计（lcu / mlol / …） */
  bySource: Record<string, number>;
}

export async function archiveStats(kind: ArchiveKind, puuid?: string | null): Promise<ArchiveStats> {
  const a = await readArchive(kind);
  const games = Object.values(a.games).filter((g) => !puuid || g.puuid === puuid);
  const times = games.map((g) => g.gameCreation).filter(Boolean).sort((x, y) => x - y);
  const byMode: Record<string, number> = {};
  const byQueue: Record<string, number> = {};
  const acc = new Map<string, { puuid: string; name: string | null; games: number }>();
  const bySource: Record<string, number> = {};
  for (const g of games) {
    const src = g.source ?? "lcu";
    bySource[src] = (bySource[src] ?? 0) + 1;
    byMode[g.gameMode || "?"] = (byMode[g.gameMode || "?"] ?? 0) + 1;
    const q = String(g.queueId ?? "?");
    byQueue[q] = (byQueue[q] ?? 0) + 1;
    if (g.puuid) {
      const cur = acc.get(g.puuid) ?? { puuid: g.puuid, name: g.puuidName ?? null, games: 0 };
      cur.games++;
      if (!cur.name && g.puuidName) cur.name = g.puuidName;
      acc.set(g.puuid, cur);
    }
  }
  return {
    kind,
    total: games.length,
    updatedAt: a.updatedAt,
    from: times[0] ?? null,
    to: times[times.length - 1] ?? null,
    byMode,
    byQueue,
    accounts: [...acc.values()].sort((a, b) => b.games - a.games),
    bySource,
  };
}
