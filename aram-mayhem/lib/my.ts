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
import { analyzeMayhemGames } from "./analysis.js";
import {
  clientStatus,
  getMatchHistory,
  getRecentGames,
  getSummoner,
  isMayhemGame,
  myParticipantId,
  type LcuGameSummary,
  type LcuSummoner,
} from "./lcu.js";
import { cleanDesc, loadData, normalize } from "./store.js";

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
    summonerName: s.displayName || s.gameName || "(未命名)",
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
    out.push(`  账号：${s.displayName || s.gameName || "(未命名)"}`);
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
  // 一次多要一些，顺便把「本地一共能查到多少把」也报出来
  const { games, total } = await getMatchHistory(Math.max(limit, 200));
  if (!games.length) return "客户端返回的最近对局是空的（可能刚登录、或对局记录还没同步）。";

  const onlyMayhem = args.only_mayhem !== false;
  const allMayhem = games.filter(isMayhemGame);
  const filtered = onlyMayhem ? allMayhem : games;
  const modes = [...new Set(games.map((g) => String(g.gameMode)))].join("、");
  const rows = filtered.slice(0, limit).map((g) => {
    const pid = myParticipantId(g, { puuid: me.puuid, name: (me.displayName || me.gameName || "").split("#")[0] });
    return gameLine(g, pid);
  });

  // 时间跨度：让人一眼看出本地记录覆盖到什么时候
  const times = games.map((g) => g.gameCreation).filter(Boolean).sort((a, b) => a - b);
  const fmt = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short" });
  const span = times.length ? `${fmt(times[0])} ~ ${fmt(times[times.length - 1])}` : "未知";

  const out = [
    `账号：${me.displayName || me.gameName || "(未命名)"}`,
    `本地客户端记录里共 ${total} 把对局，其中海斗 ${allMayhem.length} 把；时间跨度 ${span}`,
    `（客户端返回的模式标识：${modes}）`,
    `⚠ 「共 ${total} 把」是**本地客户端缓存**的数量，不是账号历史总场次：实测把翻页参数放大到 2000 也只返回同一批，` +
      "更早的对局官方接口对海斗是封的（match-v5 403），所以查不到更远的历史。",
    "",
    ...(filtered.length > limit ? [`（下面只列最近 ${limit} 把，共 ${filtered.length} 把；要更多传 limit）`] : []),
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
    return `读不到对局记录：${status.error}
（需要游戏客户端正在运行。）`;
  }
  const me = await getSummoner();
  const hist = await getMatchHistory(Math.max(limit, 200));
  return await analyzeMayhemGames(hist.games, {
    ownerPuuid: me.puuid ?? null,
    ownerName: me.displayName || me.gameName || "",
    subject: `我（${me.displayName || me.gameName || "未命名"}）`,
    cachedTotal: hist.total,
  });
}

/** 供 get_champion_guide 打辅助：把「我的常玩英雄」映射成本地英雄记录 id */
export async function myChampionIds(limit = 20): Promise<string[]> {
  const status = await clientStatus();
  if (!status.reachable) return [];
  const me = await getSummoner();
  const games = (await getRecentGames(limit)).filter(isMayhemGame);
  const count = new Map<number, number>();
  for (const g of games) {
    const pid = myParticipantId(g, { puuid: me.puuid, name: (me.displayName || me.gameName || "").split("#")[0] });
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
