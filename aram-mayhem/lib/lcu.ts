/**
 * LCU（League Client Update，本地客户端）接口封装。
 *
 * 用途：读取**本机登录的国服账号**与其最近对局，用来做个性化推荐
 * （我最近拿了哪些符文、胜率如何）。走本地回环地址 + 客户端自己写的临时凭据，
 * 不需要官方 API key，也不发往任何外部服务器。
 *
 * 前提：游戏客户端（WeGame 或 Riot 客户端启动都行）必须正在运行。
 * 凭据来源优先级：
 *   1. 环境变量 MAYHEM_LCU_PORT / MAYHEM_LCU_TOKEN（自己填）
 *   2. 正在运行的 LeagueClientUx.exe 命令行里的 --app-port / --remoting-auth-token
 *   3. MAYHEM_LOCKFILE 指定的 lockfile，或常见安装目录下的 LeagueClient/lockfile
 */
import { execFile } from "node:child_process";
import { MAYHEM_QUEUE_IDS } from "./queues.js";
import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LcuAuth {
  port: number;
  token: string;
  /** 凭据是从哪拿到的，便于排查 */
  source: string;
}

export interface LcuStatus {
  /** 是否确认存在客户端进程（凭据来自进程命令行时才算确认，来自 lockfile 只是文件在） */
  processFound: boolean;
  /** 凭据来源说明 */
  credentialSource: string | null;
  /** 尝试连接的端口 */
  port: number | null;
  /** 接口是否真的可用 */
  reachable: boolean;
  summonerName: string | null;
  error: string | null;
}

/** 常见安装位置（国服 WeGame 版与直装版的默认目录） */
const LOCKFILE_CANDIDATES = [
  "D:/英雄联盟/英雄联盟(26)/LeagueClient/lockfile",
  "D:/League/League/LeagueClient/lockfile",
  "C:/Riot Games/League of Legends/lockfile",
  "D:/WeGameApps/英雄联盟/LeagueClient/lockfile",
  "C:/Program Files/Tencent/LeagueClient/lockfile",
];

/** lockfile 内容格式: 名称:pid:端口:密码:协议 */
function parseLockfile(text: string): LcuAuth | null {
  const parts = text.trim().split(":");
  if (parts.length < 5) return null;
  const port = Number(parts[2]);
  if (!Number.isFinite(port)) return null;
  return { port, token: parts[3], source: "lockfile" };
}

/**
 * 从正在运行的客户端进程命令行里取端口与 token。
 * 关键点：无响应退出的旧客户端进程会残留（端口已经没人监听），所以**按启动时间倒序**取最新的那个。
 */
async function fromProcesses(): Promise<LcuAuth[]> {
  const cmd =
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | " +
    "Where-Object { $_.CommandLine -match '--app-port' } | " +
    "Sort-Object CreationDate -Descending | " +
    "ForEach-Object { $_.CommandLine }";
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { timeout: 10_000, windowsHide: true }
    );
    const out: LcuAuth[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const port = /--app-port=(\d+)/.exec(line)?.[1];
      const token = /--remoting-auth-token=([\w-]+)/.exec(line)?.[1];
      if (port && token) out.push({ port: Number(port), token, source: "进程命令行（最新）" });
    }
    return out;
  } catch {
    return [];
  }
}

function fromDisk(): LcuAuth | null {
  const files = [process.env.MAYHEM_LOCKFILE, ...LOCKFILE_CANDIDATES].filter((x): x is string => !!x);
  for (const f of files) {
    try {
      if (!existsSync(f)) continue;
      const text = readFileSync(f, "utf8");
      if (!text.trim()) continue; // 客户端异常退出会留下 0 字节的 lockfile
      const parsed = parseLockfile(text);
      if (parsed) return { ...parsed, source: `lockfile: ${f}` };
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

/** 所有候选凭据，按可信度排序（新进程 > 旧进程 > lockfile） */
export async function findLcuAuthCandidates(): Promise<LcuAuth[]> {
  const list: LcuAuth[] = [];
  const envPort = process.env.MAYHEM_LCU_PORT;
  const envToken = process.env.MAYHEM_LCU_TOKEN;
  if (envPort && envToken) list.push({ port: Number(envPort), token: envToken, source: "环境变量" });
  list.push(...(await fromProcesses()));
  const disk = fromDisk();
  if (disk) list.push(disk);
  // 同一端口可能被重复列出（多个进程共享端口），去重但保持顺序
  const seen = new Set<number>();
  return list.filter((a) => (seen.has(a.port) ? false : (seen.add(a.port), true)));
}

/** 找到可用凭据（取最新进程）；客户端没开时返回 null */
export async function findLcuAuth(): Promise<LcuAuth | null> {
  const list = await findLcuAuthCandidates();
  return list[0] ?? null;
}

/** 调一次 LCU 接口（本地自签名证书，需要跳过校验） */
export async function lcuGet<T>(path: string, auth?: LcuAuth | null): Promise<T> {
  if (auth) return await lcuGetOnce<T>(path, auth);
  // 没指定凭据时逐个候选试：旧进程可能残留、lockfile 可能过期
  const candidates = await findLcuAuthCandidates();
  if (!candidates.length) throw new Error("找不到客户端凭据：游戏客户端可能没有运行");
  const errors: string[] = [];
  for (const a of candidates) {
    try {
      return await lcuGetOnce<T>(path, a);
    } catch (e: any) {
      errors.push(`127.0.0.1:${a.port}（${a.source}）：${e?.message ?? e}`);
    }
  }
  throw new Error(`所有候选凭据都连不上 —— ${errors.join("；")}`);
}

/**
 * 往 LCU 发一个 POST（写操作，谨慎使用）。
 * 目前只用于「往选人频道发一条消息」这种明确由用户指定的动作。
 */
export async function lcuPost<T = any>(path: string, body: unknown, auth?: LcuAuth | null): Promise<T> {
  const a = auth ?? (await findLcuAuth());
  if (!a) throw new Error("找不到客户端凭据：游戏客户端可能没有运行");
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
  const payload = JSON.stringify(body ?? {});
  return await new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port: a.port,
        path,
        method: "POST",
        agent,
        headers: {
          authorization: "Basic " + Buffer.from(`riot:${a.token}`).toString("base64"),
          accept: "application/json",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`POST ${path} 返回 ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve((text ? JSON.parse(text) : {}) as T);
          } catch {
            resolve({} as T);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("LCU POST 超时")));
    req.on("error", reject);
    req.end(payload);
  });
}

async function lcuGetOnce<T>(path: string, a: LcuAuth): Promise<T> {
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
  return await new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port: a.port,
        path,
        method: "GET",
        agent,
        headers: {
          authorization: "Basic " + Buffer.from(`riot:${a.token}`).toString("base64"),
          accept: "application/json",
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`返回 ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error(`返回内容不是 JSON: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("请求超时（客户端可能正在进游戏或未完全启动）"));
    });
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------- 数据类型（只覆盖用到的字段）

export interface LcuSummoner {
  displayName?: string;
  gameName?: string;
  tagLine?: string;
  summonerId?: number;
  puuid?: string;
  summonerLevel?: number;
  profileIconId?: number;
}

export interface LcuGameSummary {
  gameId: number;
  gameCreation: number;
  gameDuration: number;
  gameMode: string;
  queueId: number;
  participantIdentities?: Array<{ participantId: number; player?: { summonerName?: string; puuid?: string; accountId?: number } }>;
  participants?: Array<{
    participantId: number;
    championId: number;
    teamId: number;
    stats?: Record<string, unknown> & {
      win?: boolean;
      kills?: number;
      deaths?: number;
      assists?: number;
      gameMode?: string;
      playerAugment1?: number;
      playerAugment2?: number;
      playerAugment3?: number;
      playerAugment4?: number;
      playerAugment5?: number;
      playerAugment6?: number;
      playerSubteamId?: number;
    };
  }>;
}

export interface LcuMatchList {
  games?: {
    gameCount?: number;
    games?: LcuGameSummary[];
  };
}

// ---------------------------------------------------------------- 高层封装

export async function getSummoner(): Promise<LcuSummoner> {
  return await lcuGet<LcuSummoner>("/lol-summoner/v1/current-summoner");
}

/** 最近对局摘要（默认取最近 20 把，含全部模式） */
export async function getRecentGames(limit = 20): Promise<LcuGameSummary[]> {
  return (await getMatchHistory(limit)).games;
}

/**
 * 对局记录（含客户端声明的总数）。
 *
 * ⚠ 两条路径差别很大，实测（国服 26.x）：
 *   · `…/matches?…` 用 **puuid** 查 → 服务端返回，最多 **200 把**（更早的翻不出来：begIndex 被忽略）；
 *   · `…/current-summoner/matches` 这种别名查 → 只给**本地已缓存**的一小部分（本机实测只有 21 把）。
 * 所以这里一律用 puuid 路径 —— 这才是「完整」的那份（仍然止于最近 200 场，不是生涯总场次）。
 */
export async function getMatchHistory(
  limit = 200,
  puuid?: string | null
): Promise<{ games: LcuGameSummary[]; total: number }> {
  const target = puuid ?? (await getSummoner()).puuid;
  if (!target) throw new Error("拿不到 puuid，无法查询对局记录");
  const list = await lcuGet<LcuMatchList>(
    `/lol-match-history/v1/products/lol/${encodeURIComponent(target)}/matches?begIndex=0&endIndex=${Math.max(1, Math.min(limit, 200))}`
  );
  const games = list.games?.games ?? [];
  return { games, total: list.games?.gameCount ?? games.length };
}

/** 客户端对局记录每次最多给这么多把（接口上限，不是本地缓存） */
export const MATCH_HISTORY_CAP = 200;

/** 单局详情（含更完整的 stats 与会话数据） */
export async function getGameDetail(gameId: number): Promise<LcuGameSummary> {
  return await lcuGet<LcuGameSummary>(`/lol-match-history/v1/games/${gameId}`);
}

/** 从一局里取出「我」这个参与者的 id（按 puuid / 召唤师名匹配） */
export function myParticipantId(game: LcuGameSummary, me: { puuid?: string; name?: string }): number | null {
  const ids = game.participantIdentities ?? [];
  for (const it of ids) {
    const p = it.player;
    if (!p) continue;
    if (me.puuid && p.puuid && p.puuid === me.puuid) return it.participantId;
    if (me.name && p.summonerName && p.summonerName.split("#")[0] === me.name) return it.participantId;
  }
  return null;
}

/** 从对局里提取符文 id 列表（LCU 里叫 playerAugment1..6，官方 cherry-augments.json 的 id 一致） */
export function augmentIdsOf(game: LcuGameSummary, participantId: number | null): number[] {
  const ps = game.participants ?? [];
  const target = participantId != null ? ps.find((p) => p.participantId === participantId) : ps[0];
  const s = target?.stats;
  if (!s) return [];
  const out: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const v = (s as Record<string, unknown>)[`playerAugment${i}`];
    if (typeof v === "number" && v > 0) out.push(v);
  }
  return out;
}

/**
 * 客户端状态：能不能连上、当前登录的是谁。
 * 连不上时把原因说清楚（没开客户端 / 进程在但接口没起 / 凭据过期），不猜。
 */
export async function clientStatus(): Promise<LcuStatus> {
  const auth = await findLcuAuth();
  if (!auth) {
    return {
      processFound: false,
      credentialSource: null,
      port: null,
      reachable: false,
      summonerName: null,
      error:
        "没找到客户端凭据：游戏客户端没有运行（如果你的安装目录不常见，可用环境变量 MAYHEM_LOCKFILE 指明 lockfile 路径）",
    };
  }
  const processFound = /^进程命令行|^环境变量/.test(auth.source);
  try {
    const s = await getSummoner();
    return {
      processFound,
      credentialSource: auth.source,
      port: auth.port,
      reachable: true,
      summonerName: s.displayName || s.gameName || null,
      error: null,
    };
  } catch (e: any) {
    return {
      processFound,
      credentialSource: auth.source,
      port: auth.port,
      reachable: false,
      summonerName: null,
      error: `拿到凭据（${auth.source}）但 127.0.0.1:${auth.port} 连不上：${e?.message ?? e}`,
    };
  }
}

/**
 * 海斗在客户端里的模式标识。
 * 实测国服 26.x 会出现三种：KIWI、KIWI_JADE、JADE（对应官方符文池 KIWI / KIWI_JADE），
 * 以及 ARAM_MAYHEM / MAYHEM 这类兜底写法。
 */
export const MAYHEM_MODES = ["KIWI", "KIWI_JADE", "JADE", "ARAM_MAYHEM", "MAYHEM"];

export function isMayhemGame(game: LcuGameSummary): boolean {
  const mode = String(game.gameMode ?? "").toUpperCase();
  if (MAYHEM_MODES.includes(mode)) return true;
  // 队列 id 兜底：SGP 记录里 gameMode 可能为空，但 queueId 一定在
  // （2400 普通 / 2410 巅峰赛 / 2450 经典模式版 / 3270 自定义）
  return MAYHEM_QUEUE_IDS.includes(Number(game.queueId ?? 0));
}
