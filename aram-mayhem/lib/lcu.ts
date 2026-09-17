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

/** 从正在运行的客户端进程命令行里取端口与 token（最可靠，客户端在跑就一定有） */
async function fromProcess(): Promise<LcuAuth | null> {
  const cmd =
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -First 1 -ExpandProperty CommandLine";
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { timeout: 10_000, windowsHide: true }
    );
    const line = stdout.trim();
    if (!line) return null;
    const port = /--app-port=(\d+)/.exec(line)?.[1];
    const token = /--remoting-auth-token=([\w-]+)/.exec(line)?.[1];
    if (!port || !token) return null;
    return { port: Number(port), token, source: "进程命令行" };
  } catch {
    return null;
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

/** 找到可用凭据；客户端没开时返回 null */
export async function findLcuAuth(): Promise<LcuAuth | null> {
  const envPort = process.env.MAYHEM_LCU_PORT;
  const envToken = process.env.MAYHEM_LCU_TOKEN;
  if (envPort && envToken) {
    return { port: Number(envPort), token: envToken, source: "环境变量" };
  }
  return (await fromProcess()) ?? fromDisk();
}

/** 调一次 LCU 接口（本地自签名证书，需要跳过校验） */
export async function lcuGet<T>(path: string, auth?: LcuAuth | null): Promise<T> {
  const a = auth ?? (await findLcuAuth());
  if (!a) throw new Error("找不到客户端凭据：游戏客户端可能没有运行");
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
            reject(new Error(`LCU ${path} 返回 ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error(`LCU ${path} 返回内容不是 JSON: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("LCU 请求超时（客户端可能正在进游戏或未完全启动）"));
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
  const list = await lcuGet<LcuMatchList>(
    `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${Math.max(1, limit)}`
  );
  return list.games?.games ?? [];
}

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
  const processFound = auth.source === "进程命令行" || auth.source === "环境变量";
  try {
    const s = await getSummoner();
    return {
      processFound,
      credentialSource: auth.source,
      port: auth.port,
      reachable: true,
      summonerName: s.displayName ?? s.gameName ?? null,
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

/** 海斗在客户端里的模式标识（Riot 内部代号 KIWI，国服可能沿用） */
export const MAYHEM_MODES = ["KIWI", "ARAM_MAYHEM", "MAYHEM"];

export function isMayhemGame(game: LcuGameSummary): boolean {
  const mode = String(game.gameMode ?? "").toUpperCase();
  return MAYHEM_MODES.includes(mode);
}
