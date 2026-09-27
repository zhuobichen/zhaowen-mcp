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
 * ── 2026-09 实测补全（有 cookie 后验证通过，参数如下）────────────────────────
 * 取到 cookie 后**必须**用这套 body，字段名不对会返回 `8000101 ILLEGAL_REQ`：
 *   SearchPlayer      {"nickname":"<游戏内昵称>"}          → players[].openid
 *   GetBattleList     {"account_type":2,"area":1,"id":"<openid>","from_src":"lol_helper"[,"offset":N]}
 *   GetBattleDetail   {"account_type":2,"area":1,"id":"<openid>","game_id":"<gid>","from_src":"lol_helper"}
 * 要点：
 *   · `id` 是 **openid**（base64，形如 `xsyJ7Yj7YTMxrc733LSRyw==`），**不是** QQ 号；
 *     可从任意一局 GetBattleDetail 的 player_details[].openid 里拿到别人的。
 *   · 是 `area`（不是 area_id）、必须带 `from_src`；body 为 `{}` 会报 8000119 illegal body format。
 *   · 分页参数是 **offset**（每页固定 10 局），page / page_num / start 都无效。
 *   · 无需别的 header，但带上 `trpc-caller: wegame.pallas.web.LolBattle` 更稳。
 *
 * 关键字段（player_details[] 里，共 115 个）：
 *   · gameScore      官方评分原始分（10 万量级，均值约 9.4 万）—— 页面上的「评价 6.6」是前端换算的，接口里没有
 *   · battleHonour.isMvp / isSvp   全场最佳 / 败方最佳（实测：MVP=胜方 gameScore 最高 500/500；SVP=败方最高 499/500）
 *   · team_made_size 组队人数（GetBattleList 层），**含自己**：1 = 单排、2~5 = 开黑人数
 *   · was_mvp / was_svp / win（"Win"/"Fail"/"LeaverFail"，注意 LeaverFail 是挂机判负，非布尔）
 *
 * 历史深度：**只有 500 局**（offset 到 520 返回空就到底），约最近 3.7 个月 —— 比 SGP 的 1000+ 局浅得多，
 * 所以 WeGame 只能当**补充源**（换官方评分/MVP/SVP/组队人数），长期规律仍以 SGP 归档为准。
 *
 * 与 SGP 路线对比：
 *   · 优点：不用开 LoL 客户端；能查别人的战绩；有官方 game_score / MVP / SVP / 组队人数
 *   · 缺点：历史只有 500 局；需要你自己去浏览器里取一次 cookie
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

/* ── 正式能力（2026-09 实测通过后新增）──────────────────────────────
 * 参数细节见文件头。这里只做「按正确字段名发请求 + 取有效载荷」，
 * 解析（评分/名次/组队人数等语义）留给调用方，避免把口径写死。
 */

/** Pallas 的 `id` 参数要的是 openid；用游戏内昵称先查出来 */
export async function wgFindPlayer(
  nickname: string,
  cookie?: string
): Promise<{ openid: string; level?: number; tagNum?: number } | null> {
  const ck = cookie ?? loadWegameCookie().cookie;
  if (!ck) return null;
  const r = await wgPost("LolBattle", "SearchPlayer", { nickname }, ck);
  const p = r.json?.players?.[0];
  if (!p?.openid) return null;
  return { openid: p.openid, level: p.level, tagNum: p.tag_num };
}

/** 拉一页战绩列表（每页固定 10 局）。offset 从 0 递增；返回空数组表示到底 */
export async function wgListBattles(openid: string, offset = 0, cookie?: string): Promise<any[]> {
  const ck = cookie ?? loadWegameCookie().cookie;
  if (!ck) return [];
  const r = await wgPost(
    "LolBattle",
    "GetBattleList",
    { account_type: 2, area: 1, id: openid, from_src: "lol_helper", offset },
    ck
  );
  return r.json?.battles ?? [];
}

/** 拉单局详情：player_details 含 10 人 × 115 字段（gameScore / battleHonour / team_made_size 等） */
export async function wgBattleDetail(
  openid: string,
  gameId: string | number,
  cookie?: string
): Promise<any | null> {
  const ck = cookie ?? loadWegameCookie().cookie;
  if (!ck) return null;
  const r = await wgPost(
    "LolBattle",
    "GetBattleDetail",
    { account_type: 2, area: 1, id: openid, game_id: String(gameId), from_src: "lol_helper" },
    ck
  );
  return r.json?.battle_detail ?? null;
}

/**
 * 自动翻页拉全量历史。
 * WeGame 深度上限约 500 局 —— offset 到 520 附近会连续返回空，此时判定到底。
 * 不传 maxPages 时用 60 页（600 局）兜底，防止接口行为变化导致死循环。
 */
export async function wgPullAll(
  openid: string,
  opts: { maxPages?: number; delayMs?: number; cookie?: string } = {}
): Promise<{ battles: any[]; pages: number; stopped: string }> {
  const ck = opts.cookie ?? loadWegameCookie().cookie;
  if (!ck) throw new Error("没有 WeGame cookie：见 lib/wegame.ts 文件头的获取说明");
  const maxPages = opts.maxPages ?? 60;
  const delay = opts.delayMs ?? 220;

  const seen = new Map<string, any>();
  let emptyStreak = 0;
  let pages = 0;
  for (let p = 0; p < maxPages; p++) {
    const battles = await wgListBattles(openid, p * 10, ck);
    pages++;
    if (!battles.length) {
      if (++emptyStreak >= 3) return { battles: [...seen.values()], pages, stopped: "到底（连续 3 页为空）" };
    } else {
      emptyStreak = 0;
      for (const b of battles) seen.set(String(b.game_id), b);
    }
    await new Promise((res) => setTimeout(res, delay));
  }
  return { battles: [...seen.values()], pages, stopped: "达到页数上限" };
}

/** 把响应翻成一句人话 */
export function diagnoseWg(r: WgResponse): string {
  const code = r.json?.result?.error_code ?? r.json?.error_code ?? r.json?.code;
  // 8000102 = 没有/无效登录态；8025004 = cookie 曾经有效但已过期（实测遇到过）
  if (code === 8000102) return "❌ 需要 WeGame 登录态（没找到 cookie 或无效）";
  if (code === 8025004) return "❌ WeGame 登录态已过期 —— 重新登录后取一份新 cookie";
  if (code === 8000101) return "❌ 请求参数不对（WG_COMM_ERR_ILLEGAL_REQ）—— 检查 area / id / from_src 字段名";
  if (code === 8000119) return "❌ body 格式非法（不能是空对象）";
  if (code === 0 || (r.json?.result?.error_code === undefined && r.json?.result)) return "✅ 通了";
  if (code) return `❓ 返回码 ${code}：${String(r.json?.result?.error_message ?? r.json?.msg ?? "").slice(0, 120)}`;
  return `❓ HTTP ${r.httpStatus}：${r.raw.slice(0, 160)}`;
}

/** cookie 是否还能用（跑一次 SearchPlayer 看返回码），用于给出明确报错 */
export async function wgCheckCookie(cookie?: string): Promise<{ ok: boolean; detail: string }> {
  const ck = cookie ?? loadWegameCookie().cookie;
  if (!ck) return { ok: false, detail: "没有 cookie" };
  const r = await wgPost("LolBattle", "SearchPlayer", { nickname: "__probe__" }, ck);
  const d = diagnoseWg(r);
  // 搜索不到人（8000004 Empty）说明鉴权是过的
  const code = r.json?.result?.error_code;
  if (code === 8000004 || code === 0) return { ok: true, detail: "cookie 可用" };
  return { ok: false, detail: d };
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
