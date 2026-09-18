/**
 * WeGame / Pallas 接口面枚举器 —— 摸清「有哪些方法存在」。
 *
 * 实测结论（2026-09-18，务必先读）：
 *   · 空 body → 一律 `8000119 illegal body format`（**格式校验在路由之前**）；
 *   · 非空 body（哪怕 `{"nickname":"test"}`）→ 真方法与**瞎编的方法**都返回同一个
 *     `8000102`（需要登录态）—— 说明**鉴权也在路由之前**。
 *   因此：**没有有效 cookie 时，无法判定方法是否存在**（网关不告诉你）。
 *   带上 cookie 之后才有区分度：真方法返回数据，假方法会返回「方法不存在」类错误。
 *
 * 也就是说：这个枚举器的价值在**你有 cookie 之后**（用来勾出完整接口清单），
 * 无 cookie 时它只能告诉你「网关是鉴权优先」。
 *
 * 用法：
 *   npm run wegame:enum                       # 枚举内置候选清单
 *   npm run wegame:enum -- LolBattle GetSkin  # 追加自定义 Service / Method
 *   npm run wegame:enum -- --cookie           # 带上 data/wegame-cookie.txt 再跑（拿真实结构）
 */
import { loadWegameCookie, wgPost } from "./wegame.js";

/** 候选清单：来自社区在维护的实现（LeagueAkari / LOLegendsUID）与命名习惯 */
const CANDIDATES: Record<string, string[]> = {
  LolBattle: [
    "SearchPlayer",
    "GetSummonerInfo",
    "GetBattleList",
    "GetBattleReport",
    "GetBattleDetail",
    "GetPlayerRecentStat",
    "GetPlayerProfile",
    "GetPlayerLabel",
    "GetUserLabel",
    "GetUserSnapshot",
    "GetChampion",
    "GetSkin",
    "GetRank",
    "GetPlayerRank",
    "GetHonor",
    "GetTeamInfo",
  ],
  TftBattle: [
    "GetGameCareer",
    "GetBattleList",
    "GetBattleReport",
    "GetBattleDetail",
    "GetPlayerProfile",
    "GetSeasonInfo",
    "GetRank",
  ],
  LolSummoner: ["GetSummonerInfo", "SearchPlayer", "GetProfile", "GetLevel"],
  WegameUser: ["GetUserInfo", "GetProfile", "GetBindInfo"],
};

type Verdict = "存在" | "不存在" | "未知";

/** 默认 body：必须非空才能过前端的格式校验（空 body 会被 8000119 挡掉） */
const DEFAULT_BODY = { page: 1, pageSize: 20 };

function classify(httpStatus: number, json: any, raw: string, authed: boolean): Verdict {
  const code = json?.result?.error_code ?? json?.error_code ?? json?.code;
  if (code === 8000119) return "未知"; // 格式不合法，换 body
  if (code === 8000102 || code === 8000101 || code === 1001) return "未知"; // 鉴权优先，无法判定
  if (httpStatus === 404) return "不存在";
  if (/not\s*found|no\s*such|method.*(not|invalid)|undefined method/i.test(raw)) return "不存在";
  if (httpStatus === 200 && json) return authed ? "存在" : "未知";
  return "未知";
}

export async function wegameEnum(extra: string[] = [], useCookie = false): Promise<string> {
  const { cookie } = loadWegameCookie();
  const useCookieValue = useCookie && cookie ? cookie : "";
  const out: string[] = [];
  out.push("=== WeGame / Pallas 接口面枚举 ===");
  out.push(useCookieValue ? "模式：带登录态（可以真正区分方法是否存在）" : "模式：无登录态（⚠ 网关鉴权优先，方法存在性无法判定）");
  out.push(`请求 body：${JSON.stringify(DEFAULT_BODY)}（空 body 会被 8000119 挡掉）`);
  out.push("");

  const plan: Array<[string, string]> = [];
  for (const [service, methods] of Object.entries(CANDIDATES)) {
    for (const m of methods) plan.push([service, m]);
  }
  // 追加自定义：npm run wegame:enum -- LolBattle MyMethod
  for (let i = 0; i + 1 < extra.length; i += 2) {
    if (extra[i].startsWith("-")) break;
    plan.push([extra[i], extra[i + 1]]);
  }

  const results: Array<{ service: string; method: string; verdict: Verdict; note: string }> = [];
  for (const [service, method] of plan) {
    try {
      const r = await wgPost(service as any, method, DEFAULT_BODY, useCookieValue);
      const verdict = classify(r.httpStatus, r.json, r.raw, !!useCookieValue);
      const note = r.json?.result?.error_message ?? r.json?.msg ?? r.raw.slice(0, 80).replace(/\s+/g, " ");
      results.push({ service, method, verdict, note: String(note).slice(0, 90) });
      process.stdout.write(
        `  ${verdict === "存在" ? "✅" : verdict === "不存在" ? "❌" : "❓"} ${service}/${method}\n`
      );
    } catch (e: any) {
      results.push({ service, method, verdict: "未知", note: String(e?.message ?? e).slice(0, 90) });
      process.stdout.write(`  ❓ ${service}/${method}（请求失败）\n`);
    }
    await new Promise((r) => setTimeout(r, 250)); // 温柔一点，别把网关打毛
  }

  out.push("");
  out.push("=== 汇总 ===");
  if (!useCookieValue) {
    const codes = new Set(results.map((r) => r.note));
    out.push("⚠ 本次没有 cookie：所有请求都被鉴权挡在路由之前，所以下面的「未知」是**预期结果**，");
    out.push("   不代表方法不存在。要真正枚举，请先把 cookie 放进 data/wegame-cookie.txt 再跑 --cookie。");
    out.push(`   实测到的返回码：${[...codes].slice(0, 3).join(" / ")}`);
    out.push("");
  }
  const exists = results.filter((r) => r.verdict === "存在");
  const missing = results.filter((r) => r.verdict === "不存在");
  const unknown = results.filter((r) => r.verdict === "未知");
  out.push(`存在 ${exists.length} 个 · 不存在 ${missing.length} 个 · 未知 ${unknown.length} 个`);
  out.push("");
  out.push("存在的接口（卡在登录态，补上 cookie 就能取数据）：");
  for (const r of exists) out.push(`  · ${r.service}/${r.method} —— ${r.note}`);
  if (missing.length) {
    out.push("");
    out.push(`不存在的：${missing.map((r) => `${r.service}/${r.method}`).join("、")}`);
  }
  if (unknown.length) {
    out.push("");
    out.push("未知（需要人工看原文）：");
    for (const r of unknown) out.push(`  · ${r.service}/${r.method} —— ${r.note}`);
  }
  out.push("");
  out.push("下一步：把 cookie 放进 data/wegame-cookie.txt 再跑 `npm run wegame:enum -- --cookie`，");
  out.push("就能看到每个方法的真实返回结构；我据此写解析并接进归档。");
  return out.join("\n");
}
