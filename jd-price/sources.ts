/**
 * 京东商品信息读取。
 *
 * ## 为什么走移动端页面
 * 桌面端 `search.jd.com` / `item.jd.com` 对非浏览器请求返回风控页或通用页；
 * 移动端 `item.m.jd.com/product/<sku>.html` 实测 **200 且返回真实商品数据**
 * （商品名 / 店铺 / 品牌都在 HTML 里的 JSON 片段中）。
 *
 * ## 价格必须登录
 * 未登录时页面里是这样的：
 *     "jdPrice": "1??9"
 *     "priceLoginText": "登录查看价格"
 * 价格被**打码**了 —— 注意这是京东的业务策略，不是反爬检测。
 *
 * 解出真价只需要 **`flash` 这一个 cookie**（2026-09-27 实测，4 个 SKU 复现）：
 *     匿名            → "jdPrice":"1??9"
 *     只带 flash      → "jdPrice":"1759.00"   ✓
 * 它长约 180 字符，以 `flash=` 开头。
 *
 * ⚠️ 社区文档里到处写的 `pt_key` + `pt_pin` **在本机实测的京东网页端登录态里根本不存在**，
 *    也不是这条路径需要的东西。照抄那套会一直拿到 `1??9` 却查不出原因。
 *
 * ⚠️ `priceLoginText` 即使已登录也照样是「登录查看价格」（它是个静态文案）。
 *    **不要拿它判断登录态** —— 要看 `jdPrice` 里有没有 `?`。
 *
 * ## 没有的东西
 * - **历史价格**（降价曲线）：京东不提供。第三方比价站（慢慢买 / 购物党）要登录，
 *   什么值得买的搜索与跳转链接都是 JS 挑战（202 + probe.js），实测纯 HTTP 拿不到。
 * - **搜索**：全部不通 —— `so.m.jd.com` 403、`api.m.jd.com` 返回
 *   `{"code":"1","echo":"no access"}`（它校验的是 app 签名，补 Origin/Referer 也没用）、
 *   `m.jd.com/search/search.html` 是 JS 空壳。
 *   所以这个服务的输入是 **SKU 或商品链接**，不是关键词。
 * - **经典价格 API** `p.3.cn/prices/mgets`：本机 DNS 对 `p.3.cn` 返回内网地址
 *   （10.x / 172.x），**公共 DNS 223.5.5.5 返回的也是同一批内网地址**，因此根本连不上。
 */
import { UA } from "./constants.js";

export class JdError extends Error {}

export interface JdItem {
  skuId: string;
  name: string;
  shop: string;
  brand: string;
  price: string;        // 未登录时会是打码值 "1??9"
  priceMasked: boolean; // 价格是否被打码
  url: string;
}

/** 从 SKU、`item.jd.com/xxx.html`、`item.m.jd.com/product/xxx.html` 里抠出 SKU。 */
export function parseSku(input: string): string {
  const s = (input ?? "").trim();
  if (!s) throw new JdError("需要 SKU 或京东商品链接");
  if (/^\d{6,}$/.test(s)) return s;
  const m = /(?:product\/|\/)(\d{6,})(?:\.html)?/.exec(s);
  if (m) return m[1];
  throw new JdError(`从「${s.slice(0, 60)}」里认不出 SKU。可以给纯数字 SKU，或商品链接`);
}

async function fetchItemPage(sku: string, cookie: string): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://m.jd.com/",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
  if (cookie) headers["Cookie"] = cookie;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(`https://item.m.jd.com/product/${sku}.html`, {
      headers, signal: ctl.signal,
    });
    if (!r.ok) throw new JdError(`HTTP ${r.status}（SKU ${sku} 可能不存在，或被风控）`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function getItem(skuOrUrl: string, cookie: string): Promise<JdItem> {
  const sku = parseSku(skuOrUrl);
  const html = await fetchItemPage(sku, cookie);

  const pick = (re: RegExp): string => {
    const m = re.exec(html);
    return m ? m[1] : "";
  };
  const name = pick(/"skuName"\s*:\s*"([^"]{2,120})"/);
  if (!name) {
    throw new JdError(
      `拿不到 SKU ${sku} 的商品名 —— 可能是下架商品，或页面结构变了。` +
        `（如果浏览器里能打开，多半是我这边的抓取被拦）`
    );
  }
  const price = pick(/"jdPrice"\s*:\s*"([^"]{1,24})"/) || pick(/"price"\s*:\s*"([^"]{1,24})"/);
  // 打码形态长得像 1??9 / ????，只要含 ? 就认为被打码
  const masked = !price || price.includes("?");

  return {
    skuId: sku,
    name,
    shop: pick(/"shopName"\s*:\s*"([^"]{1,60})"/),
    brand: pick(/"brandName"\s*:\s*"([^"]{1,40})"/),
    price: masked ? "" : price,
    priceMasked: masked,
    url: `https://item.jd.com/${sku}.html`,
  };
}

/** 批量取多个 SKU，用于比价。逐个取，某个失败不影响其他。 */
export async function compareItems(
  skus: string[], cookie: string
): Promise<{ items: JdItem[]; failed: { sku: string; error: string }[] }> {
  const items: JdItem[] = [];
  const failed: { sku: string; error: string }[] = [];
  for (const raw of skus.slice(0, 20)) {
    try {
      items.push(await getItem(raw, cookie));
    } catch (e: any) {
      failed.push({ sku: String(raw).slice(0, 40), error: e?.message ?? String(e) });
    }
  }
  return { items, failed };
}
