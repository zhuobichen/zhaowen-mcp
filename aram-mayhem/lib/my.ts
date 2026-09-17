/**
 * 「我的账号」相关工具：通过本地客户端（LCU）绑定本机登录的国服账号，
 * 读最近对局，并基于此做个性化分析。
 *
 * 重要前提与诚实边界：
 *   · 需要**游戏客户端正在运行**；没开时工具会明确说“客户端没开”，不会编数据。
 *   · 海斗对局里“我当时选了哪些符文”能否从本地对局记录里读到，取决于客户端是否上报
 *     （LCU 里的字段名是 playerAugment1..6）。读不到时工具会直说，并给出实际看到的字段，
 *     不做推测填充。
 *   · 数据不离开本机：只走 127.0.0.1 的本地回环接口。
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  augmentIdsOf,
  clientStatus,
  getGameDetail,
  getRecentGames,
  getSummoner,
  isMayhemGame,
  myParticipantId,
  type LcuGameSummary,
  type LcuSummoner,
} from "./lcu.js";
import { cleanDesc, loadData, normalize } from "./store.js";
import type { Augment } from "./types.js";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
const PROFILE_FILE = path.join(DATA_DIR, "profile.json");

export interface Profile {
  summonerName: string;
  puuid: string | null;
  summonerId: number | null;
  level: number | null;
  updatedAt: string;
}

export function loadProfile(): Profile | null {
  if (!existsSync(PROFILE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PROFILE_FILE, "utf8")) as Profile;
  } catch {
    return null;
  }
}

async function saveProfile(s: LcuSummoner): Promise<Profile> {
  const p: Profile = {
    summonerName: s.displayName ?? s.gameName ?? "(未命名)",
    puuid: s.puuid ?? null,
    summonerId: s.summonerId ?? null,
    level: s.summonerLevel ?? null,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PROFILE_FILE, JSON.stringify(p, null, 2), "utf8");
  return p;
}

/** 数字英雄 id → 中文名（来自官方 champion-summary） */
function championNameById(numericId: number): string {
  const d = loadData();
  const hit = d.championIds[String(numericId)];
  if (!hit) return `英雄#${numericId}`;
  const c = d.championById.get(hit.id);
  return c ? c.name : hit.name;
}

/** 数字符文 id → 本地符文记录（官方 id 在 refresh 时已存进 officialId） */
function augmentByOfficialId(numericId: number): Augment | null {
  const d = loadData();
  return d.augments.find((a) => a.officialId === numericId) ?? null;
}

const MODE_CN: Record<string, string> = {
  KIWI: "海克斯大乱斗",
  CHERRY: "斗魂竞技场",
  CLASSIC: "召唤师峡谷",
  ARAM: "极地大乱斗",
};

function gameLine(g: LcuGameSummary, participantId: number | null): string {
  const me = (g.participants ?? []).find((p) => p.participantId === participantId) ??
    (g.participants ?? [])[0];
  const s = me?.stats ?? {};
  const champ = me ? championNameById(me.championId) : "未知英雄";
  const win = s.win === true ? "胜" : s.win === false ? "负" : "?";
  const kda = `${s.kills ?? "?"}/${s.deaths ?? "?"}/${s.assists ?? "?"}`;
  const mins = Math.round((g.gameDuration ?? 0) / 60);
  const when = new Date(g.gameCreation ?? 0).toLocaleString("zh-CN", { hour12: false });
  const mode = MODE_CN[String(g.gameMode).toUpperCase()] ?? g.gameMode;
  return `${when} · ${mode} · ${champ} · ${win} · ${kda} · ${mins} 分钟`;
}

// ---------------------------------------------------------------- 工具实现

export async function myAccountStatus(args: { pin?: boolean } = {}): Promise<string> {
  const status = await clientStatus();
  const saved = loadProfile();
  const out: string[] = [];

  if (status.reachable) {
    const s = await getSummoner();
    const p = args.pin === false ? null : await saveProfile(s);
    out.push("✅ 已连上本地客户端");
    out.push(`  账号：${s.displayName ?? s.gameName ?? "(未命名)"}`);
    if (s.summonerLevel) out.push(`  等级：${s.summonerLevel}`);
    if (s.puuid) out.push(`  puuid：${s.puuid}`);
    out.push(`  凭据来源：${status.credentialSource}`);
    if (p) out.push(`  已固定到 ${path.relative(process.cwd(), PROFILE_FILE)}（下次客户端没开也能知道是你）`);
    out.push("", "可以接着用：get_my_recent_games 看最近对局，analyze_my_augments 看你最近拿了哪些符文。");
  } else {
    out.push("❌ 没连上本地客户端");
    out.push(`  原因：${status.error}`);
    if (status.processFound) {
      out.push(
        "  客户端进程确实在跑，但它的本地接口还没起来 —— 常见于：还在登录/更新界面、或正在进游戏。" +
          "进到大厅（能看到好友列表那一屏）再试通常就好了。"
      );
    } else {
      out.push("  需要先把英雄联盟客户端打开并登录（WeGame 启动也行），我才能读你账号的对局记录。");
    }
    if (saved) {
      out.push(
        "",
        `已固定的账号（上次连接时保存，${saved.updatedAt}）：${saved.summonerName}${saved.level ? ` · ${saved.level} 级` : ""}`
      );
      out.push("  这只说明“是谁”，对局记录仍然要客户端在线才能读。");
    } else {
      out.push("", "还没有固定过账号（data/profile.json 不存在）。");
    }
  }
  return out.join("\n");
}

export async function myRecentGames(args: { limit?: number; only_mayhem?: boolean } = {}): Promise<string> {
  const limit = Math.min(Math.max(args.limit ?? 15, 1), 50);
  const status = await clientStatus();
  if (!status.reachable) {
    return `读不到对局记录：${status.error}\n（需要游戏客户端正在运行。可以先跑 get_my_account_status 看状态。）`;
  }
  const me = await getSummoner();
  const games = await getRecentGames(limit);
  if (!games.length) return "客户端返回的最近对局是空的（可能刚登录、或对局记录还没同步）。";

  const onlyMayhem = args.only_mayhem !== false;
  const filtered = onlyMayhem ? games.filter(isMayhemGame) : games;
  const modes = [...new Set(games.map((g) => String(g.gameMode)))].join("、");
  const rows = filtered.map((g) => {
    const pid = myParticipantId(g, { puuid: me.puuid, name: (me.displayName ?? "").split("#")[0] });
    return gameLine(g, pid);
  });

  const out = [
    `账号：${me.displayName ?? me.gameName ?? "(未命名)"}`,
    `最近 ${games.length} 把里${onlyMayhem ? "海斗" : ""}对局 ${filtered.length} 把${onlyMayhem ? "" : "（未过滤模式）"}`,
    `（客户端返回的模式标识：${modes}）`,
    "",
    ...rows,
  ];
  if (onlyMayhem && !filtered.length) {
    out.push(
      "",
      `⚠ 最近 ${games.length} 把里没有识别到海斗对局。如果你确实打了海斗，说明客户端上报的模式标识不是 KIWI 之一 ——` +
        "把上面括号里的模式标识发我，我把筛选条件补上（也可以传 only_mayhem=false 先看全部对局）。"
    );
  }
  return out.join("\n");
}

export async function analyzeMyAugments(args: { limit?: number } = {}): Promise<string> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  const status = await clientStatus();
  if (!status.reachable) {
    return `读不到对局记录：${status.error}\n（需要游戏客户端正在运行。）`;
  }
  const me = await getSummoner();
  const games = (await getRecentGames(limit)).filter(isMayhemGame);
  if (!games.length) {
    return `最近 ${limit} 把里没有识别到海斗对局，无法统计符文。（可先用 get_my_recent_games 看看客户端上报的模式标识。）`;
  }

  interface Row {
    game: LcuGameSummary;
    augments: number[];
    win: boolean | null;
  }
  const rows: Row[] = [];
  let augmentFieldSeen = false;
  const pidOf = (g: LcuGameSummary) =>
    myParticipantId(g, { puuid: me.puuid, name: (me.displayName ?? "").split("#")[0] });

  for (const g of games) {
    const pid = pidOf(g);
    let ids = augmentIdsOf(g, pid);
    if (!ids.length) {
      // 摘要里没有就试详情接口（符文有时只在详情里）
      try {
        const detail = await getGameDetail(g.gameId);
        ids = augmentIdsOf(detail, pid ?? myParticipantId(detail, { puuid: me.puuid }));
      } catch {
        /* 详情拿不到就按没有处理，下面会如实说明 */
      }
    }
    if (ids.length) augmentFieldSeen = true;
    const me2 = (g.participants ?? []).find((p) => p.participantId === pid) ?? (g.participants ?? [])[0];
    rows.push({ game: g, augments: ids, win: me2?.stats?.win ?? null });
  }

  if (!augmentFieldSeen) {
    return [
      `最近 ${games.length} 把海斗对局里，客户端没有提供符文字段，所以统计不了“我拿了哪些符文”。`,
      "",
      "已核对过的实际情况：",
      "  · Riot 对海斗模式的官方对局接口是**主动封禁**的（match-v5 返回 403，RiotGames/developer-relations issue #1109，",
      "    官方回复为 intended，即新轮换模式的对局数据不再公开）。",
      "  · 本地客户端（LCU）的公开接口里没有海斗对局符文端点：对局中三选一是游戏进程直接下发的，不走 LCU。",
      "  · 因此 /lol-match-history/... 返回的 stats 里没有 playerAugment1..6 字段。",
      "这不是本工具少写了逻辑，也不是凭据问题 —— 所以这里如实报告“读不到”，不编数据。",
      "",
      "仍然可用的个性化能力：",
      "  · get_my_recent_games：最近玩了哪些英雄、胜负（能读到的话就是可信的）",
      "  · get_champion_guide：针对你常玩的英雄给推荐符文与陷阱提示",
    ].join("\n");
  }

  // 统计符文使用与胜率
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
  const local = rows.filter((r) => r.win !== null);
  const localWins = local.filter((r) => r.win === true).length;

  const out: string[] = [
    `账号：${me.displayName ?? me.gameName ?? "(未命名)"} · 统计最近 ${rows.length} 把海斗`,
    `近期胜率：${localWins}/${local.length}${local.length ? ` (${Math.round((localWins / local.length) * 100)}%)` : ""}`,
    "",
    "你拿过的符文（按出现次数；「版本名次」是社区站强度榜，用来对照你拿的是不是强势符文）：",
  ];
  for (const [id, s] of ranked.slice(0, 20)) {
    const a = augmentByOfficialId(id);
    if (!a) {
      out.push(`  · 未知符文 id ${id}：出现 ${s.games} 把${s.wins ? `，赢 ${s.wins}` : ""}（本地符文库没有这个 id，可能是新符文或已下架）`);
      continue;
    }
    out.push(
      `  · ${a.name}：出现 ${s.games} 把，赢 ${s.wins} 把` +
        `${a.stats?.rank ? ` · 版本第 ${a.stats.rank} 名` : " · 未进版本榜单"}` +
        `${a.stats?.winRate ? `（版本胜率 ${a.stats.winRate}）` : ""}`
    );
  }

  // 对照：你常拿的符文里有没有版本弱势的
  const known = ranked
    .map(([id, s]) => ({ a: augmentByOfficialId(id), s }))
    .filter((x): x is { a: Augment; s: { games: number; wins: number } } => !!x.a);
  const weak = known.filter((x) => (x.a.stats?.rank ?? 0) > 100);
  if (weak.length) {
    out.push("", "其中版本榜名次偏后的（>100 名，可考虑换个拿法）：");
    for (const x of weak.slice(0, 8)) out.push(`  · ${x.a.name}（第 ${x.a.stats?.rank} 名，你拿了 ${x.s.games} 把）`);
  }

  out.push("", "说明：样本量小的时候胜率没有统计意义；符文 id 来自客户端上报，与官方符文库的 id 对照。");
  return out.join("\n");
}

/** 供 get_champion_guide 打辅助：把「我的常玩英雄」映射成本地英雄记录 id */
export async function myChampionIds(limit = 20): Promise<string[]> {
  const status = await clientStatus();
  if (!status.reachable) return [];
  const me = await getSummoner();
  const games = (await getRecentGames(limit)).filter(isMayhemGame);
  const count = new Map<number, number>();
  for (const g of games) {
    const pid = myParticipantId(g, { puuid: me.puuid, name: (me.displayName ?? "").split("#")[0] });
    const p = (g.participants ?? []).find((x) => x.participantId === pid);
    if (p) count.set(p.championId, (count.get(p.championId) ?? 0) + 1);
  }
  const d = loadData();
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cid]) => {
      const name = championNameById(cid);
      const c = d.champions.find((x) => normalize(x.name) === normalize(name) || normalize(x.epithet) === normalize(name));
      return c?.id ?? "";
    })
    .filter(Boolean);
}

export { cleanDesc };
