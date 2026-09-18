/**
 * 掌上英雄联盟（掌盟）战绩接口客户端 —— 目标是拿到**比本地客户端更长的历史**。
 *
 * 现状（已实测）：`/go/battle_info/get_battle_list` 与 `get_battle_detail` 两个路由确实存在，
 * 未登录时返回 `{"err_msg":"cookie userid empty","msg":"登录态失效","result":1001}`；
 * **闸口之后是否还需要签名（sig/nonce/timestamp）目前未知** —— 本模块的探针就是用来验证这件事的。
 *
 * Cookie 从哪来：掌盟 App 的 WebView 会往 H5 注入 openid/uin/acctype/userId/clientType 等 cookie，
 * 需要在手机（或模拟器）上抓包取出。本模块**不做登录**，只负责带着你提供的 cookie 发请求。
 *
 * 用法：
 *   # 把 cookie 放进环境变量或 data/mlol-cookie.txt（该文件已被 .gitignore 排除）
 *   npm run mlol:probe
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
export const COOKIE_FILE = path.join(DATA_DIR, "mlol-cookie.txt");
const BASE = "https://mlol.qt.qq.com";

export interface MlolResponse {
  httpStatus: number;
  /** 原始响应文本（截断到 800 字，便于看错误） */
  raw: string;
  /** 解析后的 JSON（解析失败则为 null） */
  json: any | null;
}

/** 读取 cookie：环境变量优先，其次 data/mlol-cookie.txt */
export function loadCookie(): { cookie: string | null; source: string } {
  const env = process.env.MAYHEM_MLOL_COOKIE?.trim();
  if (env) return { cookie: env, source: "环境变量 MAYHEM_MLOL_COOKIE" };
  if (existsSync(COOKIE_FILE)) {
    const text = readFileSync(COOKIE_FILE, "utf8").trim();
    if (text) return { cookie: text, source: `文件 ${path.relative(process.cwd(), COOKIE_FILE)}` };
  }
  return { cookie: null, source: "（没有找到 cookie）" };
}

/** 发一个掌盟请求（POST JSON） */
export async function mlolPost(pathname: string, body: unknown, cookie: string): Promise<MlolResponse> {
  const res = await fetch(BASE + pathname, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // 掌盟 H5 走 App WebView，这里尽量贴近它的 UA
      "user-agent":
        "Mozilla/5.0 (Linux; Android 13; SM-S9180 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
      cookie,
      referer: "https://mlol.qt.qq.com/",
      origin: "https://mlol.qt.qq.com",
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 不是 JSON 就只回原文 */
  }
  return { httpStatus: res.status, raw: text.slice(0, 800), json };
}

/** 从响应里判断关卡在哪一步，给人看得懂的结论 */
export function diagnose(r: MlolResponse): string {
  const j = r.json;
  if (!j) return `响应不是 JSON（HTTP ${r.httpStatus}）：${r.raw.slice(0, 160)}`;
  const code = j.result ?? j.code ?? j.ret;
  const msg = String(j.msg ?? j.err_msg ?? "");
  if (code === 1001 || /登录态|userid empty/i.test(msg)) return "❌ 卡在登录态：cookie 无效或缺少 userid";
  if (/sign|签名|sig/i.test(msg)) return "⚠️ 要求签名：闸口之后还有签名校验（这条路成本会明显上升）";
  if (/param|参数/i.test(msg)) return `⚠️ 参数不对（好消息：说明 cookie 过了）：${msg}`;
  if (code === 0) return "✅ 通了：cookie 有效且无需额外签名";
  return `❓ 未识别的返回：result=${code} msg=${msg}`;
}

/**
 * 可行性探针：用几种参数形状各打一次，打印原始返回。
 * 目的不是"猜对参数"，而是看清**闸口在哪一步**（cookie / 参数 / 签名）。
 */
export async function mlolProbe(): Promise<string> {
  const { cookie, source } = loadCookie();
  const out: string[] = [];
  out.push("=== 掌盟接口可行性探针 ===");
  out.push(`Cookie 来源：${source}`);
  if (!cookie) {
    out.push("");
    out.push("还没有 cookie。获取方式（需要你操作，我不碰你的账号凭据）：");
    out.push("  1) 手机上安装掌盟 App 并登录；");
    out.push("  2) 手机 Wi-Fi 设代理指向本机 mitmproxy/Charles（需要装证书）；");
    out.push("  3) 在掌盟里打开战绩页，抓 https://mlol.qt.qq.com/go/battle_info/* 的请求，复制它的 Cookie 头；");
    out.push("  4) 把 cookie 存到 data/mlol-cookie.txt（已被 .gitignore 排除）或设成环境变量 MAYHEM_MLOL_COOKIE。");
    out.push("");
    out.push("拿不到 cookie 时，这条路走不通 —— 我不会伪造或绕过你的登录态。");
    return out.join("\n");
  }
  out.push(`Cookie 长度：${cookie.length} 字符`);

  const attempts: Array<{ label: string; path: string; body: any }> = [
    { label: "battle_list · area_id+page", path: "/go/battle_info/get_battle_list", body: { area_id: "1", page: 1 } },
    { label: "battle_list · area_id+page+type", path: "/go/battle_info/get_battle_list", body: { area_id: "1", page: 1, type: "1" } },
    { label: "battle_list · 空 body", path: "/go/battle_info/get_battle_list", body: {} },
    { label: "battle_detail · 空 body", path: "/go/battle_info/get_battle_detail", body: {} },
  ];

  for (const a of attempts) {
    try {
      const r = await mlolPost(a.path, a.body, cookie);
      out.push("");
      out.push(`— ${a.label}`);
      out.push(`  HTTP ${r.httpStatus} · ${diagnose(r)}`);
      out.push(`  原文：${r.raw.replace(/\s+/g, " ").slice(0, 400)}`);
    } catch (e: any) {
      out.push("");
      out.push(`— ${a.label}`);
      out.push(`  请求失败：${e?.message ?? e}`);
    }
  }

  out.push("");
  out.push("判读指南：");
  out.push("  · 如果全部是「卡在登录态」→ cookie 没取对（或已过期），换一个再试；");
  out.push("  · 如果变成「要求签名」→ 掌盟接口有二次校验，需要真机抓包分析签名算法，成本另算；");
  out.push("  · 如果变成「参数不对」→ 好消息，cookie 已通过，把参数补齐即可；");
  out.push("  · 如果 result=0 → 通了，接下来我可以把它接进归档，历史覆盖就能远超本地客户端。");
  return out.join("\n");
}
