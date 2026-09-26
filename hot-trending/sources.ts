/**
 * 各平台热榜的抓取与归一化。
 *
 * 设计原则：一个平台一个函数，各自解析成统一的 HotItem，调用方不用关心差异。
 * 所有请求显式带 User-Agent 和 Referer —— 这几家都会按 UA 拦，裸请求会被
 * 403 或返回空数据（这不是权限问题，是礼貌性伪装）。
 *
 * 知乎是特例：它的热榜接口（api/v3/feed/topstory/hot-lists）实测 401
 * "身份未经过验证"，连匿名 d_c0 都不行；免登录只剩 api/v4/search/top_search，
 * 而且那个接口时好时坏（同一请求一次 200 一次 code 10003）。所以知乎要
 * 有效 cookie 才能稳定用，没有就给明确的提示而不是返回空列表。
 */

export interface HotItem {
  rank: number;
  title: string;
  hot?: string;      // 热度，有的平台是数字有的没有，统一成字符串
  url?: string;
  desc?: string;     // 摘要/说明
  tag?: string;      // 平台的角标（爆/热/新 之类）
}

export interface Board {
  id: string;
  name: string;
  needsAuth: boolean;
  note: string;
}

export const BOARDS: Board[] = [
  { id: "bilibili", name: "B站热搜", needsAuth: false, note: "api.bilibili.com 搜索广场" },
  { id: "weibo", name: "微博热搜", needsAuth: false, note: "weibo.com/ajax/side/hotSearch" },
  { id: "tieba", name: "贴吧热议", needsAuth: false, note: "tieba.baidu.com/hottopic 话题榜" },
  { id: "zhihu", name: "知乎热榜", needsAuth: true, note: "需要提供登录 cookie（ZHIHU_COOKIE）" },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface FetchOpts {
  limit: number;
  zhihuCookie?: string;
}

async function getJson(url: string, referer: string, cookie?: string): Promise<any> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: referer,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
  if (cookie) headers["Cookie"] = cookie;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export class BoardError extends Error {}

function asStr(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  return String(v);
}

// --------------------------------------------------------------------------- //

async function bilibili(limit: number): Promise<HotItem[]> {
  const d = await getJson(
    `https://api.bilibili.com/x/web-interface/search/square?limit=${limit}`,
    "https://www.bilibili.com/"
  );
  if (d?.code !== 0) throw new BoardError(`B站返回 code=${d?.code} ${d?.message ?? ""}`);
  const list: any[] = d?.data?.trending?.list ?? [];
  if (!list.length) throw new BoardError("B站返回了空列表（可能是风控）");
  return list.map((it, i) => ({
    rank: i + 1,
    title: asStr(it.show_name) ?? asStr(it.keyword) ?? "",
    hot: asStr(it.heat_score),
    url: it.keyword
      ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(it.keyword)}`
      : undefined,
  }));
}

async function weibo(limit: number): Promise<HotItem[]> {
  const d = await getJson("https://weibo.com/ajax/side/hotSearch", "https://weibo.com/");
  const list: any[] = d?.data?.realtime ?? [];
  if (!list.length) throw new BoardError("微博返回了空列表（可能是风控）");
  return list.slice(0, limit).map((it, i) => ({
    // 用数组下标而不是 realpos —— 微博的 realpos 会并列（实测第 4 名出现两次），
    // 直接显示会造成"排名重复"的观感，而列表顺序本来就是它给的次序。
    rank: i + 1,
    title: asStr(it.note) ?? asStr(it.word) ?? "",
    hot: asStr(it.num),
    tag: asStr(it.label_name) ?? asStr(it.icon_desc),
    url: it.word ? `https://s.weibo.com/weibo?q=${encodeURIComponent(it.word)}` : undefined,
  }));
}

async function tieba(limit: number): Promise<HotItem[]> {
  const d = await getJson(
    "https://tieba.baidu.com/hottopic/browse/topicList",
    "https://tieba.baidu.com/"
  );
  const list: any[] = d?.data?.bang_topic?.topic_list ?? [];
  if (!list.length) throw new BoardError("贴吧返回了空列表（可能是风控）");
  return list.slice(0, limit).map((it, i) => ({
    rank: i + 1,
    title: asStr(it.topic_name) ?? "",
    hot: asStr(it.discuss_num),
    desc: asStr(it.topic_desc),
    url: asStr(it.topic_url) ?? (it.topic_id
      ? `https://tieba.baidu.com/hottopic/browse/hottopic?topic_id=${it.topic_id}`
      : undefined),
  }));
}

async function zhihu(limit: number, cookie?: string): Promise<HotItem[]> {
  if (!cookie) {
    throw new BoardError(
      "知乎热榜需要登录 cookie。设置环境变量 ZHIHU_COOKIE（浏览器里复制 z_c0 那一段即可），" +
        "否则接口稳定返回 401 身份未经过验证。"
    );
  }
  const d = await getJson(
    `https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=${limit}`,
    "https://www.zhihu.com/hot",
    cookie
  );
  if (d?.error) throw new BoardError(`知乎返回错误: ${d.error.message ?? JSON.stringify(d.error)}`);
  const list: any[] = d?.data ?? [];
  if (!list.length) {
    throw new BoardError("知乎返回了空列表 —— cookie 可能已过期，或触发了风控");
  }
  return list.map((it, i) => {
    const t = it?.target ?? {};
    const qid = t.id;
    return {
      rank: i + 1,
      title: asStr(t.title) || asStr(it?.card_label?.text) || "",
      desc: asStr(t.excerpt),
      hot: asStr(t.detail_text),
      url: qid ? `https://www.zhihu.com/question/${qid}` : undefined,
    };
  });
}

// --------------------------------------------------------------------------- //

export async function fetchHot(boardId: string, opts: FetchOpts): Promise<HotItem[]> {
  const limit = Math.max(1, Math.min(opts.limit || 20, 100));
  switch (boardId) {
    case "bilibili":
      return bilibili(limit);
    case "weibo":
      return weibo(limit);
    case "tieba":
      return tieba(limit);
    case "zhihu":
      return zhihu(limit, opts.zhihuCookie);
    default:
      throw new BoardError(
        `不认识的平台: ${boardId}。可用: ${BOARDS.map((b) => b.id).join(", ")}`
      );
  }
}
