/**
 * B站 WBI 签名。
 *
 * 背景：B站从 2023 起给一批接口（搜索、用户空间作品等）加了 wbi 签名校验，
 * 不带签名直接 412 或 code -352 风控失败。签名的密钥来自 nav 接口的
 * wbi_img.img_url / sub_url —— **实测未登录（isLogin:false）也会返回**，
 * 所以这些接口不需要用户 cookie 就能用。
 *
 * 算法：
 *   1. 从两个 url 里各取文件名（去掉扩展名），拼成 64 字符
 *   2. 按固定的 mixinKeyEncTab 重排，取前 32 位 = mixin_key
 *   3. 参数加 wts（秒级时间戳），按 key 排序，滤掉 !'()* 字符，拼成 query
 *   4. w_rid = md5(query + mixin_key)
 *
 * 密钥会过期（服务端轮换），所以带 30 分钟缓存 + 失败重取。
 */
import { createHash } from "node:crypto";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let cached: { key: string; at: number } | null = null;
const TTL_MS = 30 * 60 * 1000;

function fileNameOf(url: string): string {
  const base = url.split("/").pop() ?? "";
  return base.split(".")[0];
}

function mixinKey(imgUrl: string, subUrl: string): string {
  const raw = fileNameOf(imgUrl) + fileNameOf(subUrl);
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += raw[MIXIN_KEY_ENC_TAB[i]] ?? "";
  }
  return out;
}

async function loadKey(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.key;
  const r = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/" },
  });
  const d: any = await r.json();
  const img = d?.data?.wbi_img?.img_url;
  const sub = d?.data?.wbi_img?.sub_url;
  if (!img || !sub) {
    throw new Error("拿不到 wbi 密钥（nav 接口没返回 wbi_img）");
  }
  const key = mixinKey(img, sub);
  cached = { key, at: Date.now() };
  return key;
}

/** 清掉缓存的密钥，签名失败时调用。 */
export function invalidateWbiKey(): void {
  cached = null;
}

/**
 * 给参数加上 wts + w_rid，返回可直接拼到 URL 上的 query string。
 */
export async function signParams(
  params: Record<string, string | number>
): Promise<string> {
  const key = await loadKey();
  const all: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) all[k] = String(v);
  all["wts"] = String(Math.floor(Date.now() / 1000));

  const query = Object.keys(all)
    .sort()
    .map((k) => {
      // B站要求滤掉这几个字符再编码，不滤会导致签名对不上
      const v = all[k].replace(/[!'()*]/g, "");
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join("&");

  const wRid = createHash("md5").update(query + key).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

/** UA 常量导出，给别的模块复用，避免两处不一致。 */
export const BILI_UA = UA;
