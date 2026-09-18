/**
 * WeGame / Pallas 战绩接口 —— **不需要启动英雄联盟客户端**的那条路。
 *
 * 背景：WeGame 客户端的「我的战绩」是个内嵌网页（`https://www.wegame.com.cn/helper/lol/v2/index.html`），
 * 它调的是 Pallas 网关：
 *   POST https://www.wegame.com.cn/api/v1/wegame.pallas.game.LolBattle/{Method}
 *        SearchPlayer · GetSummonerInfo · GetBattleList · GetPlayerRecentStat · GetBattleReport · GetBattleDetail
 *   POST https://www.wegame.com.cn/api/v1/wegame.pallas.game.TftBattle/{Method}
 *        GetGameCareer · GetBattleList · GetBattleReport · GetBattleDetail
 * 实测（无登录态）：端点在线，返回 `error_code: 8000102`（登录态错误）—— 所以**只缺一个 WeGame 登录 cookie**。
 *
 * 与 SGP 路线对比：
 *   · 优点：不用开 LoL 客户端；理论上还能查别人的战绩
 *   · 缺点：**翻页能力与历史深度都没验证过**（大概率不如 SGP），而且需要你自己去浏览器里取一次 cookie
 *
 * Cookie 获取：浏览器登录 https://www.wegame.com.cn 后，F12 → Network → 任意请求 → 复制 Cookie 头；
 * 存到 data/wegame-cookie.txt（已 gitignore）或设成环境变量 MAYHEM_WEGAME_COOKIE。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
export const WEGAME_COOKIE_FILE = path.join(DATA_DIR, "wegame-cookie.txt");
const BASE = "https://www.wegame.com.cn/api/v1/wegame.pallas.game";

export interface WgResponse {
  httpStatus: number;
  json: any | null;
  raw: string;
}

export function loadWegameCookie(): { cookie: string | null; source: string } {
  const env = process.env.MAYHEM_WEGAME_COOKIE?.trim();
  if (env) return { cookie: env, source: "环境变量 MAYHEM_WEGAME_COOKIE" };
  if (existsSync(WEGAME_COOKIE_FILE)) {
    const t = readFileSync(WEGAME_COOKIE_FILE, "utf8").trim();
    if (t) return { cookie: t, source: `文件 ${path.relative(process.cwd(), WEGAME_COOKIE_FILE)}` };
  }
  return { cookie: null, source: "（没有找到 cookie）" };
}

export async function wgPost(service: "LolBattle" | "TftBattle", method: string, body: unknown, cookie: string): Promise<WgResponse> {
  const res = await fetch(`${BASE}.${service}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "https://www.wegame.com.cn",
      referer: "https://www.wegame.com.cn/helper/lol/v2/index.html",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 原文 */
  }
  return { httpStatus: res.status, json, raw: text.slice(0, 800) };
}

/** 把响应翻成一句人话 */
export function diagnoseWg(r: WgResponse): string {
  const code = r.json?.result?.error_code ?? r.json?.error_code ?? r.json?.code;
  if (code === 8000102) return "❌ 需要 WeGame 登录态（cookie 无效或已过期）";
  if (code === 0 || r.json?.result?.error_code === undefined && r.json?.result) return "✅ 通了";
  if (code) return `❓ 返回码 ${code}：${String(r.json?.result?.error_message ?? r.json?.msg ?? "").slice(0, 120)}`;
  return `❓ HTTP ${r.httpStatus}：${r.raw.slice(0, 160)}`;
}

/**
 * 可行性探针：确认 cookie 是否可用、接口是否返回数据、以及字段结构。
 * 目的同 mlol 探针 —— 看清卡在哪一步，不猜参数。
 */
export async function wegameProbe(nickname?: string): Promise<string> {
  const { cookie, source } = loadWegameCookie();
  const out: string[] = ["=== WeGame / Pallas 战绩接口探针（不需要开 LoL 客户端）==="];
  out.push(`Cookie 来源：${source}`);
  if (!cookie) {
    out.push("");
    out.push("还没有 cookie。获取方式：");
    out.push("  1) 浏览器打开 https://www.wegame.com.cn 并登录（QQ/微信扫码）；");
    out.push("  2) F12 → Network → 随便点一个请求 → 复制 Request Headers 里的 Cookie 整行；");
    out.push("  3) 存到 data/wegame-cookie.txt（已 gitignore）或设环境变量 MAYHEM_WEGAME_COOKIE；");
    out.push("  4) 再跑一次本探针。");
    out.push("");
    out.push("对比：SGP 路线（npm run sgp:probe）不需要你手动取 cookie —— 它用本机客户端的登录态，");
    out.push("      但要求先把游戏客户端开着登录。两条路选一条即可。");
    return out.join("\n");
  }
  out.push(`Cookie 长度：${cookie.length} 字符`);

  const attempts: Array<{ label: string; service: "LolBattle" | "TftBattle"; method: string; body: any }> = [
    { label: "LolBattle/GetSummonerInfo（空 body，看鉴权）", service: "LolBattle", method: "GetSummonerInfo", body: {} },
    { label: "LolBattle/GetBattleList（空 body）", service: "LolBattle", method: "GetBattleList", body: {} },
    { label: "TftBattle/GetBattleList（空 body）", service: "TftBattle", method: "GetBattleList", body: {} },
  ];
  if (nickname) {
    attempts.unshift({
      label: `LolBattle/SearchPlayer（昵称 ${nickname}）`,
      service: "LolBattle",
      method: "SearchPlayer",
      body: { nickname },
    });
  }

  for (const a of attempts) {
    try {
      const r = await wgPost(a.service, a.method, a.body, cookie);
      out.push("");
      out.push(`— ${a.label}`);
      out.push(`  HTTP ${r.httpStatus} · ${diagnoseWg(r)}`);
      out.push(`  原文：${r.raw.replace(/\s+/g, " ").slice(0, 360)}`);
    } catch (e: any) {
      out.push("");
      out.push(`— ${a.label}`);
      out.push(`  请求失败：${e?.message ?? e}`);
    }
  }

  out.push("");
  out.push("判读：");
  out.push("  · 全是 8000102 → cookie 没取对或已过期（重新登一次再复制）；");
  out.push("  · 出现「参数不对 / 缺参数」→ cookie 已通过，把参数补齐即可（我会照响应把参数写出来）；");
  out.push("  · 返回数据 → 通了；接着我会核对它能翻多深，再决定是否接进归档。");
  return out.join("\n");
}
