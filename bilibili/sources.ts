/**
 * B站 API 封装。
 *
 * 实测边界（2026-09-26，本机网络）：
 *   免登录可用   视频信息、评论列表、热门视频、热搜、搜索
 *   需要登录     用户空间作品列表（x/space/wbi/arc/search 恒 412）
 *   需要 SESSDATA+bili_jct  点赞/投币/收藏/发评论（写操作）
 *
 * 两个必须踩对的地方：
 *  1. **Referer 是硬门槛**。搜索接口用 www.bilibili.com 做 referer 能过，
 *     用 search.bilibili.com 反而 412 —— 和直觉相反，实测如此。
 *  2. **WAF 抖动**。同一请求同一 header，第一次 412 第二次 200 是常态。
 *     所以所有请求都走 requestJson() 带重试，别把单次 412 当结论。
 */
import { BILI_UA, signParams, invalidateWbiKey } from "./wbi.js";

export class BiliError extends Error {}

const REFERER = "https://www.bilibili.com/";

export interface BiliOpts {
  cookie?: string;   // 有则带上（SESSDATA 等），没有也能跑只读部分
}

async function requestJson(
  url: string,
  opts: BiliOpts = {},
  retries = 3
): Promise<any> {
  let last = "";
  for (let i = 0; i <= retries; i++) {
    const headers: Record<string, string> = {
      "User-Agent": BILI_UA,
      Referer: REFERER,
      Accept: "application/json, text/plain, */*",
    };
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    try {
      const r = await fetch(url, { headers });
      const t = await r.text();
      if (r.status === 412) {
        last = "HTTP 412（风控拦截）";
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        continue;   // WAF 抖动，退避重试
      }
      let d: any;
      try {
        d = JSON.parse(t);
      } catch {
        throw new BiliError(`返回不是 JSON（HTTP ${r.status}）: ${t.slice(0, 80)}`);
      }
      return d;
    } catch (e: any) {
      last = e?.message ?? String(e);
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new BiliError(`请求失败（重试 ${retries} 次）: ${last}`);
}

function check(d: any, what: string): any {
  if (d?.code === 0) return d.data;
  const msg = d?.message ?? "未知错误";
  if (d?.code === -101) throw new BiliError(`${what}需要登录（code -101）`);
  if (d?.code === -352) throw new BiliError(`${what}被风控拦截（code -352），可能需要登录`);
  throw new BiliError(`${what}失败: code ${d?.code} ${msg}`);
}

// --------------------------------------------------------------------------- //

export interface VideoInfo {
  bvid: string;
  aid: number;
  title: string;
  author: string;
  mid: number;
  duration: number;
  desc: string;
  view: number;
  like: number;
  coin: number;
  favorite: number;
  reply: number;
  pubdate: number;
  url: string;
}

export async function getVideo(bvid: string, o: BiliOpts): Promise<VideoInfo> {
  const d = await requestJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    o
  );
  const v = check(d, "获取视频信息");
  if (!v?.bvid) throw new BiliError(`找不到视频 ${bvid}`);
  const s = v.stat ?? {};
  return {
    bvid: v.bvid, aid: v.aid, title: v.title, author: v.owner?.name ?? "",
    mid: v.owner?.mid ?? 0, duration: v.duration ?? 0,
    desc: (v.desc ?? "").slice(0, 200),
    view: s.view ?? 0, like: s.like ?? 0, coin: s.coin ?? 0,
    favorite: s.favorite ?? 0, reply: s.reply ?? 0,
    pubdate: v.pubdate ?? 0, url: `https://www.bilibili.com/video/${v.bvid}`,
  };
}

export interface SearchItem {
  bvid: string;
  title: string;
  author: string;
  play: number;
  duration: string;
  url: string;
}

export async function searchVideos(
  keyword: string, limit: number, o: BiliOpts
): Promise<SearchItem[]> {
  const qs = `search_type=video&keyword=${encodeURIComponent(keyword)}&page=1&page_size=${limit}`;
  const d = await requestJson(
    `https://api.bilibili.com/x/web-interface/search/type?${qs}`, o
  );
  const data = check(d, "搜索");
  // B站 的 search/type 不认 page_size（实测传 3 仍返回 20 条），
  // 所以在这里客户端截断，别指望服务端。
  const list: any[] = (data?.result ?? []).slice(0, limit);
  return list.map((v) => ({
    bvid: v.bvid,
    title: String(v.title ?? "").replace(/<[^>]+>/g, ""),
    author: v.author ?? "",
    play: v.play ?? 0,
    duration: v.duration ?? "",
    url: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

export async function listPopular(limit: number, o: BiliOpts): Promise<SearchItem[]> {
  const d = await requestJson(
    `https://api.bilibili.com/x/web-interface/popular?ps=${limit}&pn=1`, o
  );
  const data = check(d, "获取热门");
  const list: any[] = data?.list ?? [];
  return list.map((v) => ({
    bvid: v.bvid, title: v.title, author: v.owner?.name ?? "",
    play: v.stat?.view ?? 0, duration: String(v.duration ?? ""),
    url: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

export interface Comment {
  user: string;
  content: string;
  like: number;
  ctime: number;
}

export async function getComments(
  bvid: string, limit: number, o: BiliOpts
): Promise<Comment[]> {
  const info = await getVideo(bvid, o);
  const d = await requestJson(
    `https://api.bilibili.com/x/v2/reply?type=1&oid=${info.aid}&sort=2&pn=1&ps=${limit}`,
    o
  );
  const data = check(d, "获取评论");
  const list: any[] = data?.replies ?? [];
  if (!list.length) return [];
  return list.map((c) => ({
    user: c.member?.uname ?? "",
    content: String(c.content?.message ?? "").slice(0, 200),
    like: c.like ?? 0,
    ctime: c.ctime ?? 0,
  }));
}

export async function getUserVideos(
  mid: number, limit: number, o: BiliOpts
): Promise<SearchItem[]> {
  // 这个接口实测恒 412，即使带签名；先试，失败就给明确提示
  const qs = await signParams({ mid, ps: limit, pn: 1 });
  const d = await requestJson(
    `https://api.bilibili.com/x/space/wbi/arc/search?${qs}`, o
  ).catch((e: any) => {
    invalidateWbiKey();
    throw new BiliError(
      `${e.message} —— 用户空间作品列表是 B站 风控最严的接口之一，` +
        `实测未登录恒 412，需要配置 BILI_COOKIE（含 SESSDATA）`
    );
  });
  const data = check(d, "获取用户作品");
  const list: any[] = data?.list?.vlist ?? [];
  return list.map((v) => ({
    bvid: v.bvid, title: v.title, author: "",
    play: v.play ?? 0, duration: String(v.length ?? ""),
    url: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

export interface LoginStatus {
  loggedIn: boolean;
  uname?: string;
  mid?: number;
  vip?: string;
  cookieConfigured: boolean;
}

export async function checkLogin(o: BiliOpts): Promise<LoginStatus> {
  const d = await requestJson("https://api.bilibili.com/x/web-interface/nav", o);
  const data = d?.data ?? {};
  return {
    loggedIn: !!data.isLogin,
    uname: data.uname,
    mid: data.mid,
    vip: data.vipStatus === 1 ? (data.vip_label?.text ?? "大会员") : undefined,
    cookieConfigured: !!o.cookie,
  };
}

// --------------------------------------------------------------------------- //
//  个人向（都需要 cookie）
// --------------------------------------------------------------------------- //

function needCookie(o: BiliOpts, what: string): string {
  if (!o.cookie) throw new BiliError(`${what}需要登录 —— 请配置 BILI_COOKIE（含 SESSDATA）`);
  return o.cookie;
}

/**
 * 拿当前登录账号的 mid。
 * 个人向工具（收藏夹、关注、历史…）都要 mid，但让用户每次手填太蠢 ——
 * 不传就自动从 nav 取，这也顺便当了"cookie 还有效吗"的兜底检查。
 */
export async function resolveMid(o: BiliOpts): Promise<number> {
  needCookie(o, "此操作");
  const s = await checkLogin(o);
  if (!s.loggedIn || !s.mid) {
    throw new BiliError("cookie 已失效或不是有效登录态，请重新获取 BILI_COOKIE");
  }
  return s.mid;
}

export interface FavFolder {
  id: number;
  title: string;
  count: number;
  isDefault: boolean;
}

export async function listFavFolders(mid: number, o: BiliOpts): Promise<FavFolder[]> {
  needCookie(o, "查看收藏夹");
  const d = await requestJson(
    `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`, o
  );
  const data = check(d, "获取收藏夹列表");
  const list: any[] = data?.list ?? [];
  if (!list.length) return [];
  return list.map((f) => ({
    id: f.id,
    title: f.title ?? "",
    count: f.media_count ?? 0,
    isDefault: (f.title ?? "").includes("默认"),
  }));
}

export interface FavItem {
  title: string;
  up: string;
  play: number;
  bvid: string;
  url: string;
  favTime: number;
}

export async function listFavorites(
  mediaId: number, limit: number, o: BiliOpts
): Promise<FavItem[]> {
  needCookie(o, "查看收藏夹内容");
  const d = await requestJson(
    `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}` +
      `&ps=${limit}&pn=1&platform=web`, o
  );
  const data = check(d, "获取收藏夹内容");
  const medias: any[] = data?.medias ?? [];
  if (!medias.length) {
    // 收藏夹是空的、或已被设为私密
    throw new BiliError(
      `收藏夹 ${mediaId} 里没有内容 —— 可能是空收藏夹，或已被设为私密（私密收藏夹需要 cookie 里的相应权限）`
    );
  }
  return medias.map((m) => {
    const bvid = m.bvid ?? m.bv_id ?? "";
    return {
      title: m.title ?? "",
      up: m.upper?.name ?? "",
      play: m.cnt_info?.play ?? 0,
      bvid,
      url: bvid ? `https://www.bilibili.com/video/${bvid}` : (m.link ?? ""),
      favTime: m.fav_time ?? 0,
    };
  });
}

export interface UserBrief {
  mid: number;
  uname: string;
  sign: string;
  url: string;
}

export async function listRelation(
  mid: number, kind: "followings" | "fans", limit: number, o: BiliOpts
): Promise<UserBrief[]> {
  needCookie(o, kind === "fans" ? "查看粉丝" : "查看关注");
  const d = await requestJson(
    `https://api.bilibili.com/x/relation/${kind}?vmid=${mid}&ps=${limit}&pn=1`, o
  );
  const data = check(d, "获取关系列表");
  const list: any[] = data?.list ?? [];
  const nameKey = kind === "fans" ? "uname" : "uname";
  return list.map((u) => ({
    mid: u.mid ?? 0,
    uname: u[nameKey] ?? u.uname ?? "",
    sign: (u.sign ?? "").slice(0, 60),
    url: `https://space.bilibili.com/${u.mid}`,
  }));
}

export interface HistoryItem {
  title: string;
  up: string;
  progress: number;
  duration: number;
  bvid: string;
  url: string;
  viewedAt: number;
}

export async function getHistory(limit: number, o: BiliOpts): Promise<HistoryItem[]> {
  needCookie(o, "查看观看历史");
  const d = await requestJson(
    `https://api.bilibili.com/x/web-interface/history/cursor?ps=${limit}`, o
  );
  const data = check(d, "获取观看历史");
  const list: any[] = data?.list ?? [];
  return list.map((h) => ({
    title: h.title ?? "",
    up: h.author_name ?? "",
    progress: h.progress ?? 0,
    duration: h.duration ?? 0,
    // bvid 不在顶层，在 history 子对象里（实测）；顶层那个 uri 就是完整链接，
    // 直接用它可以同时覆盖普通视频和番剧/直播等非 archive 内容。
    bvid: h.history?.bvid ?? "",
    url: h.uri ?? (h.history?.bvid
      ? `https://www.bilibili.com/video/${h.history.bvid}` : ""),
    viewedAt: h.view_at ?? 0,
  }));
}

export async function listToView(limit: number, o: BiliOpts): Promise<SearchItem[]> {
  needCookie(o, "查看稍后再看");
  const d = await requestJson("https://api.bilibili.com/x/v2/history/toview", o);
  const data = check(d, "获取稍后再看");
  const list: any[] = data?.list ?? [];
  return list.slice(0, limit).map((v) => ({
    bvid: v.bvid ?? "",
    title: v.title ?? "",
    author: v.owner?.name ?? "",
    play: v.stat?.view ?? 0,
    duration: String(v.duration ?? ""),
    url: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

export interface DailyWatch {
  date: string;        // YYYY-MM-DD（本地时区）
  videos: number;      // 当天打开过几个视频
  seconds: number;     // 估算观看秒数 = 各视频 progress 之和
  finished: number;    // 其中看完的
}

export interface WatchTimeReport {
  days: DailyWatch[];
  totalSeconds: number;
  pagesFetched: number;
  truncated: boolean;  // 翻页到上限还没取完
}

/**
 * 按天统计观看时长。
 *
 * ⚠️ 这是**估算**，不是精确值 —— 要说清楚它偏在哪：
 *  - B站 没有公开的"每日观看时长"接口（实测几个候选全是 404/-403/-400），
 *    所以只能拿历史记录里的 progress 字段累加。
 *  - progress 是"看到了第几秒"，不是"实际播放了多少秒"。拖进度条、倍速、
 *    重复看同一段都会让它偏。
 *  - 历史只记录**打开过**的视频，所以这是下限而非全量。
 *  - 短片段（打开就退）也会计入，会把数字抬一点。
 * 两头的误差方向相反，不保证互相抵消 —— 报告里会标注这是估算。
 */
export async function getWatchTime(
  days: number, o: BiliOpts, maxPages = 30
): Promise<WatchTimeReport> {
  needCookie(o, "查看观看时长");

  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  const sinceTs = Math.floor(since.getTime() / 1000);

  const byDay = new Map<string, DailyWatch>();
  let cursorViewAt = "";
  let cursorMax = "";
  let pages = 0;
  let truncated = false;

  while (pages < maxPages) {
    const q = cursorViewAt
      ? `&view_at=${cursorViewAt}&max=${cursorMax}`
      : "";
    const d = await requestJson(
      `https://api.bilibili.com/x/web-interface/history/cursor?ps=30${q}`, o
    );
    const data = check(d, "获取观看历史");
    const list: any[] = data?.list ?? [];
    if (!list.length) break;
    pages++;

    let reachedOld = false;
    for (const h of list) {
      const ts = h.view_at ?? 0;
      if (ts < sinceTs) { reachedOld = true; continue; }
      const dt = new Date(ts * 1000);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      const cur = byDay.get(key) ?? { date: key, videos: 0, seconds: 0, finished: 0 };
      cur.videos++;
      // progress 超过时长时按全长算（有些内容 duration 为 0，跳过不累加）
      const prog = Math.min(h.progress ?? 0, h.duration || h.progress || 0);
      cur.seconds += prog;
      if (h.is_finish) cur.finished++;
      byDay.set(key, cur);
    }
    if (reachedOld) break;

    const c = data?.cursor ?? {};
    if (!c.view_at || !c.max) break;
    cursorViewAt = String(c.view_at);
    cursorMax = String(c.max);
  }
  if (pages >= maxPages) truncated = true;

  const out = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
  return {
    days: out,
    totalSeconds: out.reduce((s, d) => s + d.seconds, 0),
    pagesFetched: pages,
    truncated,
  };
}

// --------------------------------------------------------------------------- //
//  视频维度扩展
// --------------------------------------------------------------------------- //

export interface SubtitleCue { from: number; to: number; text: string }
export interface SubtitleResult {
  lang: string;
  label: string;
  cues: SubtitleCue[];
}

/**
 * 拿视频字幕全文。
 *
 * 这是这个服务里对「看视频学习」最有用的一条：B站 上很多知识区视频有
 * 人工/AI 字幕，抽出来就是带时间戳的全文，可以直接喂给模型做总结。
 *
 * 两步：先问播放器信息拿字幕轨列表（要 wbi 签名），再单独下载字幕 JSON。
 * 字幕文件在 aisubtitle.hdslb.com，URL 是 // 开头的协议相对地址。
 * 没有字幕的视频（实测不少，比如一些 AI 科普）返回到轨道列表为空 —— 这不是错误。
 */
export async function getSubtitles(
  bvid: string, o: BiliOpts, preferLang = ""
): Promise<{ tracks: { lang: string; label: string }[]; picked: SubtitleResult | null }> {
  const info = await getVideo(bvid, o);
  const qs = await signParams({ bvid: info.bvid, cid: (await getCid(info.bvid, o)) });
  const d = await requestJson(
    `https://api.bilibili.com/x/player/wbi/v2?${qs}`, o
  ).catch(async (e: any) => {
    invalidateWbiKey();
    throw e;
  });
  const data = check(d, "获取播放器信息");
  const subs: any[] = data?.subtitle?.subtitles ?? [];
  const tracks = subs.map((s) => ({ lang: s.lan ?? "", label: s.lan_doc ?? "" }));
  if (!subs.length) return { tracks: [], picked: null };

  // 选轨：优先用户指定的语言，否则中文优先，再否则第一条
  const pick =
    (preferLang && subs.find((s) => s.lan === preferLang)) ||
    subs.find((s) => s.lan === "zh-CN") ||
    subs.find((s) => (s.lan ?? "").startsWith("zh")) ||
    subs[0];

  let url: string = pick.subtitle_url ?? "";
  if (url.startsWith("//")) url = "https:" + url;
  const r = await fetch(url, {
    headers: { "User-Agent": BILI_UA, Referer: "https://www.bilibili.com/" },
  });
  const sjson: any = await r.json();
  const cues: SubtitleCue[] = (sjson?.body ?? []).map((b: any) => ({
    from: b.from ?? 0, to: b.to ?? 0, text: b.content ?? "",
  }));
  return {
    tracks,
    picked: { lang: pick.lan ?? "", label: pick.lan_doc ?? "", cues },
  };
}

/** 取视频的 cid（第一个分P）。字幕和播放器接口都要它。 */
export async function getCid(bvid: string, o: BiliOpts): Promise<number> {
  const d = await requestJson(
    `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`, o
  );
  const data = check(d, "获取分P列表");
  const list: any[] = Array.isArray(data) ? data : (data?.list ?? []);
  if (!list.length) throw new BiliError(`拿不到 ${bvid} 的分P（cid）`);
  return list[0].cid;
}

export interface Part { page: number; cid: number; title: string; duration: number }

export async function getParts(bvid: string, o: BiliOpts): Promise<Part[]> {
  const d = await requestJson(
    `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`, o
  );
  const data = check(d, "获取分P列表");
  const list: any[] = Array.isArray(data) ? data : (data?.list ?? []);
  return list.map((p) => ({
    page: p.page ?? 0, cid: p.cid ?? 0,
    title: p.part ?? "", duration: p.duration ?? 0,
  }));
}

export async function getRelated(bvid: string, limit: number, o: BiliOpts): Promise<SearchItem[]> {
  const d = await requestJson(
    `https://api.bilibili.com/x/web-interface/archive/related?bvid=${encodeURIComponent(bvid)}`, o
  );
  // related 直接返回数组，不是 {code,data}
  const list: any[] = Array.isArray(d?.data) ? d.data : [];
  return list.slice(0, limit).map((v) => ({
    bvid: v.bvid ?? "", title: v.title ?? "",
    author: v.owner?.name ?? "", play: v.stat?.view ?? 0,
    duration: String(v.duration ?? ""),
    url: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

/** 排行榜。rid 是分区 id：0=全站，其他见 B站 分区表。 */
export async function getRanking(limit: number, o: BiliOpts, rid = 0): Promise<SearchItem[]> {
  const d = await requestJson(
    `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}`, o
  );
  const data = check(d, "获取排行榜");
  const list: any[] = data?.list ?? [];
  return list.slice(0, limit).map((v) => ({
    bvid: v.bvid ?? "", title: v.title ?? "",
    author: v.owner?.name ?? "", play: v.stat?.view ?? 0,
    duration: String(v.duration ?? ""),
    url: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

/**
 * 每周必看。
 *
 * 两个接口分工不同（实测）：
 *   series/list  → 只给期号和主题（{number, subject, name}），**不含视频**
 *   series/one   → 给该期的视频列表，但**必须带 wbi 签名**，不签名恒 -352 风控
 * 所以流程是：先 list 拿期号，再签名后请求 one。
 */
export async function listWeekly(
  limit: number, o: BiliOpts, number?: number
): Promise<{ items: SearchItem[]; number: number; subject: string }> {
  let num = number;
  let subject = "";
  if (!num) {
    const l = await requestJson(
      "https://api.bilibili.com/x/web-interface/popular/series/list", o);
    const first = l?.data?.list?.[0];
    if (!first?.number) throw new BiliError("拿不到每周必看的期号列表");
    num = first.number;
    subject = first.subject ?? "";
  }
  const qs = await signParams({ number: num });
  const d = await requestJson(
    `https://api.bilibili.com/x/web-interface/popular/series/one?${qs}`, o
  ).catch((e: any) => {
    invalidateWbiKey();
    throw new BiliError(
      `${e.message} —— 每周必看的 series/one 接口必须带 wbi 签名（不带恒 -352）`
    );
  });
  const data = check(d, "获取每周必看");
  const list: any[] = data?.list ?? [];
  return {
    number: num,
    subject: subject || (data?.subject ?? ""),
    items: list.slice(0, limit).map((v) => ({
      bvid: v.bvid ?? "", title: v.title ?? "",
      author: v.owner?.name ?? "", play: v.stat?.view ?? 0,
      duration: String(v.duration ?? ""),
      url: `https://www.bilibili.com/video/${v.bvid}`,
    })),
  };
}

export interface UserStat { mid: number; following: number; follower: number; likes: number }

/** 用户的关注数/粉丝数/获赞数。免登录也能查。 */
export async function getUserStat(mid: number, o: BiliOpts): Promise<UserStat> {
  const d = await requestJson(`https://api.bilibili.com/x/relation/stat?vmid=${mid}`, o);
  const data = check(d, "获取用户统计");
  // 自己的获赞数在另一个接口
  let likes = 0;
  try {
    const u = await requestJson(`https://api.bilibili.com/x/space/upstat?mid=${mid}`, o);
    likes = u?.data?.likes ?? 0;
  } catch { /* upstat 有时风控，拿不到就算了 */ }
  return {
    mid: data?.mid ?? mid,
    following: data?.following ?? 0,
    follower: data?.follower ?? 0,
    likes,
  };
}

/** 从 cookie 里取 csrf（就是 bili_jct 的值）。写操作必须带。 */
export function csrfOf(o: BiliOpts): string {
  const c = o.cookie ?? "";
  if (!c.includes("bili_jct")) {
    throw new BiliError("写操作需要 BILI_COOKIE，且必须含 SESSDATA 和 bili_jct 两项");
  }
  return /bili_jct=([^;]+)/.exec(c)?.[1] ?? "";
}

async function postForm(url: string, body: Record<string, string>, o: BiliOpts, referer = "https://www.bilibili.com/") {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": BILI_UA, Referer: referer,
      "Content-Type": "application/x-www-form-urlencoded", Cookie: o.cookie ?? "",
    },
    body: new URLSearchParams(body),
  });
  const d: any = await r.json();
  return d;
}

/** 关注 / 取关一个用户。 */
export async function followUser(mid: number, o: BiliOpts, unfollow = false): Promise<string> {
  const csrf = csrfOf(o);
  if (!mid) throw new BiliError("需要 mid");
  const d = await postForm("https://api.bilibili.com/x/relation/modify", {
    fid: String(mid), act: unfollow ? "2" : "1", re_src: "11", csrf,
  }, o, `https://space.bilibili.com/${mid}`);
  // 22001 = 已经关注 / 22002 = 未关注
  if (d.code === 22001) return unfollow ? "没关注过这个用户" : "已经关注过了";
  if (d.code === 22002) return "本来就没关注";
  if (d.code !== 0) throw new BiliError(`操作失败: code ${d.code} ${d.message}`);
  return unfollow ? `已取关 mid ${mid}` : `已关注 mid ${mid}`;
}

/** 收藏 / 取消收藏视频。folder_id 不传则用默认收藏夹。 */
export async function favoriteVideo(
  bvid: string, o: BiliOpts, folderId?: number, unfavorite = false
): Promise<string> {
  const csrf = csrfOf(o);
  const info = await getVideo(bvid, o);

  let folder = folderId;
  if (!folder) {
    const mid = await resolveMid(o);
    const folders = await listFavFolders(mid, o);
    const def = folders.find((f) => f.isDefault) ?? folders[0];
    if (!def) throw new BiliError("找不到可用的收藏夹");
    folder = def.id;
  }

  const body: Record<string, string> = {
    rid: String(info.aid), type: "2", csrf,
  };
  if (unfavorite) body.del_media_ids = String(folder);
  else body.add_media_ids = String(folder);

  const d = await postForm("https://api.bilibili.com/x/v3/fav/resource/deal", body, o,
    `https://www.bilibili.com/video/${info.bvid}`);
  if (d.code === 11201) return "已经收藏过了";
  if (d.code !== 0) throw new BiliError(`收藏失败: code ${d.code} ${d.message}`);
  return unfavorite
    ? `已从收藏夹 ${folder} 移除《${info.title}》`
    : `已把《${info.title}》收藏到收藏夹 ${folder}`;
}

/** 投币。count 只能是 1 或 2。 */
export async function coinVideo(
  bvid: string, o: BiliOpts, count = 1, alsoLike = false
): Promise<string> {
  const csrf = csrfOf(o);
  const n = count >= 2 ? 2 : 1;
  const info = await getVideo(bvid, o);
  const d = await postForm("https://api.bilibili.com/x/web-interface/coin/add", {
    bvid: info.bvid, multiply: String(n),
    select_like: alsoLike ? "1" : "0", csrf,
  }, o, `https://www.bilibili.com/video/${info.bvid}`);
  if (d.code === 34005) return "已经投过币了（同一个视频最多投 2 个）";
  if (d.code === -101) throw new BiliError("未登录或 cookie 失效");
  if (d.code !== 0) throw new BiliError(`投币失败: code ${d.code} ${d.message}`);
  return `已给《${info.title}》投 ${n} 个币${alsoLike ? "并点赞" : ""}`;
}

// --------------------------------------------------------------------------- //
//  评论
// --------------------------------------------------------------------------- //

export interface MsgItem {
  id: string;
  from: string;        // 触发者（like 时是多个人，这里给前几个）
  fromMid: number;
  text: string;        // 对方说的内容
  mine: string;        // ★ 你自己的内容（被回复/被赞/被@ 的那条）
  url: string;         // 内容链接
  time: number;
}

/**
 * 消息中心：别人回复我的 / @我的 / 收到的赞。
 *
 * ★ 这两个接口能**间接看到你自己发过的内容**（不是全量，但能看到内容+链接）：
 *    - reply: item.source_content 就是你被回复的那条评论
 *    - like : item.title 就是你被赞过的那条评论/动态/弹幕
 *    - at   : item.title 是 @你的那条内容
 *
 * B站 **没有"我发出的全部评论"接口**（实测几个候选全 404），
 * 想看完整列表得去 App 里的「消息 → 我的评论」。API 不暴露。
 *
 * 三个接口的返回结构**各不相同**（实测）：
 *    reply/at → item.user 是单个对象
 *    like     → item.users 是数组（一条消息聚合了多个点赞者），且正文在 item.item.title
 */
export async function listMsgFeed(
  kind: "reply" | "at" | "like", limit: number, o: BiliOpts
): Promise<MsgItem[]> {
  needCookie(o, "查看消息");
  const d = await requestJson(
    `https://api.bilibili.com/x/msgfeed/${kind}?platform=web&build=0&mobi_app=web`, o
  );
  const data = check(d, "获取消息");
  // 列表位置也不一样：reply/at 在 data.items，like 嵌在 data.total.items 里（实测）
  const items: any[] = (kind === "like" ? data?.total?.items : data?.items) ?? [];
  const out: MsgItem[] = [];

  for (const it of items.slice(0, limit)) {
    if (kind === "like") {
      const users: any[] = it.users ?? [];
      const names = users.slice(0, 3).map((u) => u.nickname).join("、");
      const more = users.length > 3 ? ` 等 ${users.length} 人` : "";
      out.push({
        id: String(it.id ?? ""),
        from: (names + more).trim() || "(未知)",
        fromMid: users[0]?.mid ?? 0,
        text: "",                          // 点赞没有正文
        mine: String(it.item?.title ?? "").slice(0, 120),   // ← 你的内容
        url: it.item?.uri ?? "",
        time: it.like_time ?? 0,
      });
      continue;
    }
    const u = it.user ?? {};
    out.push({
      id: String(it.id ?? ""),
      from: u.nickname ?? "",
      fromMid: u.mid ?? 0,
      text: String(it.item?.title ?? "").slice(0, 120),      // 对方说的话
      mine: String(it.item?.source_content ?? "").slice(0, 120), // ★ 你的原文
      url: it.item?.uri ?? "",
      time: it.reply_time ?? it.time ?? 0,
    });
  }
  return out;
}

export interface TopContent {
  title: string;
  likes: number;
  kind: string;        // 评论 / 动态 / 弹幕
  url: string;         // 所在视频/动态的链接
  directUrl: string;   // 直接跳到这条内容的锚点链接（评论才有）
  lastLikeAt: number;  // ★ 最后一次收到赞的时间（不是发布时间！）
}

/**
 * 我发过的、被点赞最多的内容排行。
 *
 * 数据来源是「收到的赞」消息流。**counts 字段就是该内容的总赞数** ——
 * 这一点是跨接口验证过的（拿一条去查它所在视频的真实评论，like 字段与
 * counts 一致），不是猜的。
 *
 * 局限：只有**收到过赞**的内容才会出现在这里。发过但没人赞的看不到；
 * 而且只覆盖 B站 推送过通知的那部分（很久以前的可能不在流里）。
 */
export async function getTopLikedContent(
  o: BiliOpts, topN = 10, maxPages = 20
): Promise<{ items: TopContent[]; pages: number; exhausted: boolean }> {
  needCookie(o, "查看收到的赞");
  const acc: TopContent[] = [];
  const seen = new Set<string>();
  let cursorId = "";
  let cursorTime = "";
  let pages = 0;
  let done = false;      // 服务端说取尽了

  const PAGE_CAP = maxPages;

  while (pages < maxPages) {
    const q = cursorId ? `&id=${cursorId}&time=${cursorTime}` : "";
    const d = await requestJson(
      `https://api.bilibili.com/x/msgfeed/like?platform=web&build=0&mobi_app=web${q}`, o
    );
    const data = check(d, "获取收到的赞");
    const total = data?.total ?? {};
    const list: any[] = total.items ?? [];
    if (!list.length) break;
    pages++;

    for (const it of list) {
      const item = it.item ?? {};
      const key = `${item.item_id}|${item.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const uri = item.uri ?? "";
      const iid = item.item_id;
      // 评论类可以拼锚点直接跳过去：#reply<rpid>；动态/弹幕没有这个形式
      const isReply = (item.type === "reply") && uri && iid;
      acc.push({
        title: String(item.title ?? "").slice(0, 200),
        likes: it.counts ?? 0,
        kind: item.business ?? item.type ?? "",
        url: uri,
        directUrl: isReply ? `${uri}#reply${iid}` : uri,
        lastLikeAt: it.like_time ?? 0,
      });
    }

    const c = total.cursor ?? {};
    if (c.is_end || !c.id) { done = true; break; }
    cursorId = String(c.id);
    cursorTime = String(c.time ?? "");
  }

  // 之前这里用 `pages = maxPages + 1` 来标记"取尽"，但那个值和循环耗尽撞在
  // 一起了 —— 服务端说取尽反而会被判成"没取完"。用一个独立的 done 标志。
  return {
    items: acc.sort((a, b) => b.likes - a.likes).slice(0, topN),
    pages,
    exhausted: !done && pages >= PAGE_CAP,
  };
}

/**
 * 给视频发评论。
 *
 * ⚠️ 这是**不可逆的公开动作**（发出去对方能看到，且会触发通知），
 * 而且 B站 实测不做目标校验 —— 发送前请确认 bvid 和内容都正确。
 * 没有"安全探针"可用：GET 探活只能证明接口存在（405），证明不了参数对不对。
 */
export async function postComment(
  bvid: string, message: string, o: BiliOpts
): Promise<{ rpid: string; preview: string }> {
  const csrf = csrfOf(o);
  const text = (message ?? "").trim();
  if (!text) throw new BiliError("评论内容不能为空");
  if (text.length > 1000) throw new BiliError("评论过长（B站 上限约 1000 字）");

  const info = await getVideo(bvid, o);   // 顺便拿到 aid
  const d = await postForm("https://api.bilibili.com/x/v2/reply/add", {
    oid: String(info.aid), type: "1", message: text,
    plat: "1", csrf,
  }, o, `https://www.bilibili.com/video/${info.bvid}`);

  if (d.code === -101) throw new BiliError("未登录或 cookie 失效");
  if (d.code === 12051) throw new BiliError("评论发得太快，被限流了，等一会儿再试");
  if (d.code === 12035) throw new BiliError("评论区已关闭");
  if (d.code === -400) throw new BiliError(`参数被拒（code -400 ${d.message ?? ""}）`);
  if (d.code !== 0) throw new BiliError(`发送失败: code ${d.code} ${d.message}`);
  return {
    rpid: String(d.data?.rpid_str ?? d.data?.rpid ?? ""),
    preview: text.slice(0, 60),
  };
}

/** 写操作（点赞/投币/收藏）。需要 SESSDATA + bili_jct。 */
export async function likeVideo(
  bvid: string, o: BiliOpts, unliked = false
): Promise<string> {
  if (!o.cookie?.includes("bili_jct")) {
    throw new BiliError("写操作需要 BILI_COOKIE（必须含 SESSDATA 和 bili_jct 两项）");
  }
  const csrf = /bili_jct=([^;]+)/.exec(o.cookie)?.[1] ?? "";
  const info = await getVideo(bvid, o);
  const body = new URLSearchParams({
    bvid: info.bvid, like: unliked ? "0" : "1", csrf,
  });
  const r = await fetch("https://api.bilibili.com/x/web-interface/archive/like", {
    method: "POST",
    headers: {
      "User-Agent": BILI_UA, Referer: `https://www.bilibili.com/video/${info.bvid}`,
      "Content-Type": "application/x-www-form-urlencoded", Cookie: o.cookie,
    },
    body,
  });
  const d: any = await r.json();
  if (d.code !== 0) throw new BiliError(`点赞失败: code ${d.code} ${d.message}`);
  return unliked ? `已取消点赞 ${info.title}` : `已点赞 ${info.title}`;
}
