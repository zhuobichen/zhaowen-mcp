#!/usr/bin/env npx tsx
/**
 * bilibili MCP Server
 *
 * B站只读为主：视频信息、搜索、热门、评论。写操作（点赞）需要 cookie。
 *
 * 实测边界见 sources.ts 顶部的注释 —— 两个坑：Referer 是硬门槛、
 * WAF 会抖动（同一请求第一次 412 第二次 200 是常态，已内置重试）。
 *
 * 环境变量:
 *   BILI_COOKIE  可选。含 SESSDATA 才能看用户空间作品；含 SESSDATA+bili_jct 才能点赞。
 *
 * 启动: npx tsx zhaowen-mcp/bilibili/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  BiliError, getVideo, searchVideos, listPopular, getComments,
  getUserVideos, likeVideo, checkLogin, resolveMid,
  listFavFolders, listFavorites, listRelation, getHistory, listToView,
  getWatchTime, followUser, favoriteVideo, coinVideo, listMsgFeed, postComment,
  getTopLikedContent, getSubtitles, getParts, getRelated, getRanking,
  listWeekly, getUserStat, type BiliOpts, type SearchItem,
} from "./sources.js";

/** 秒 → "3小时25分" / "25分" / "40秒" */
function fmtSec(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h}小时${m}分`;
  if (m) return `${m}分`;
  return `${Math.round(s)}秒`;
}

const OPTS: BiliOpts = { cookie: process.env.BILI_COOKIE };

function fmtNum(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
  return String(n);
}

/**
 * 时长。搜索接口返回的是 "11:20" 这种已格式化字符串，热门接口返回的却是
 * 原始秒数（实测 12575 = 3:29:35），所以只对纯数字做转换，别把 "11:20" 转坏。
 */
function fmtDur(d: string): string {
  if (!/^\d+$/.test(d)) return d;
  const s = Number(d);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function renderList(items: SearchItem[]): string {
  return items
    .map((v, i) =>
      `${String(i + 1).padStart(2)}. ${v.title}\n` +
      `    ${v.author ? v.author + "  " : ""}${fmtNum(v.play)}播放  ${fmtDur(v.duration)}  ${v.url}`
    )
    .join("\n");
}

async function main() {
  const server = new Server(
    { name: "bilibili", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "check_login",
        description:
          "检查 B站 登录状态：当前账号昵称、mid、是否大会员，以及有没有配 BILI_COOKIE。" +
          "不确定登录态或某个工具报权限错误时先调这个。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_video",
        description: "获取 B站 视频详情：标题、UP主、时长、简介、播放/点赞/投币/收藏/评论数。",
        inputSchema: {
          type: "object",
          properties: { bvid: { type: "string", description: "视频 BV 号，如 BV1GJ411x7h7" } },
          required: ["bvid"],
        },
      },
      {
        name: "search_videos",
        description: "按关键词搜索 B站 视频。",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            limit: { type: "number", description: "条数，默认 10" },
          },
          required: ["keyword"],
        },
      },
      {
        name: "list_popular",
        description: "获取 B站 当前热门视频榜。",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "条数，默认 10" } },
        },
      },
      {
        name: "get_comments",
        description: "获取某个视频的评论（按热度排序）。",
        inputSchema: {
          type: "object",
          properties: {
            bvid: { type: "string" },
            limit: { type: "number", description: "条数，默认 10" },
          },
          required: ["bvid"],
        },
      },
      {
        name: "get_user_videos",
        description:
          "获取某 UP 主的投稿列表。注意：这是 B站 风控最严的接口，未登录恒 412，" +
          "需要配置 BILI_COOKIE（含 SESSDATA）。mid 是 UP 主的数字 ID。",
        inputSchema: {
          type: "object",
          properties: {
            mid: { type: "number", description: "UP 主的 mid，如 946974" },
            limit: { type: "number", description: "条数，默认 10" },
          },
          required: ["mid"],
        },
      },
      {
        name: "like_video",
        description:
          "给视频点赞或取消点赞。需要 BILI_COOKIE 且必须含 SESSDATA 与 bili_jct（写操作）。",
        inputSchema: {
          type: "object",
          properties: {
            bvid: { type: "string" },
            unlike: { type: "boolean", description: "true 表示取消点赞，默认 false" },
          },
          required: ["bvid"],
        },
      },
      // ---- 个人向（都需 cookie；mid 不传则自动取当前登录账号） ----
      {
        name: "list_fav_folders",
        description:
          "列出我的收藏夹（含各自的 id 和内容数）。拿到 id 后用 list_favorites 看具体内容。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: { mid: { type: "number", description: "不传则用当前登录账号" } },
        },
      },
      {
        name: "list_favorites",
        description: "查看某个收藏夹里的内容。media_id 从 list_fav_folders 拿。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            media_id: { type: "number", description: "收藏夹 id" },
            limit: { type: "number", description: "条数，默认 20" },
          },
          required: ["media_id"],
        },
      },
      {
        name: "list_followings",
        description: "查看我的关注列表。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            mid: { type: "number", description: "不传则用当前登录账号" },
            limit: { type: "number", description: "条数，默认 20" },
          },
        },
      },
      {
        name: "list_fans",
        description: "查看我的粉丝列表。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            mid: { type: "number", description: "不传则用当前登录账号" },
            limit: { type: "number", description: "条数，默认 20" },
          },
        },
      },
      {
        name: "get_history",
        description: "查看我的观看历史。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "条数，默认 20" } },
        },
      },
      {
        name: "list_toview",
        description: "查看我的「稍后再看」列表。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "条数，默认 20" } },
        },
      },
      {
        name: "follow_user",
        description:
          "关注或取关一个 B站 用户。**写操作**，对方会收到通知。需 BILI_COOKIE（含 bili_jct）。",
        inputSchema: {
          type: "object",
          properties: {
            mid: { type: "number", description: "对方的 mid（从搜索/关注列表拿）" },
            unfollow: { type: "boolean", description: "true 表示取关，默认 false" },
          },
          required: ["mid"],
        },
      },
      {
        name: "favorite_video",
        description:
          "收藏或取消收藏一个视频。**写操作**。folder_id 不传则用默认收藏夹" +
          "（去哪个夹子可从 list_fav_folders 选）。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            bvid: { type: "string" },
            folder_id: { type: "number", description: "收藏夹 id，不传用默认收藏夹" },
            unfavorite: { type: "boolean", description: "true 表示取消收藏" },
          },
          required: ["bvid"],
        },
      },
      {
        name: "coin_video",
        description:
          "给视频投币（1 或 2 个，同一个视频总共最多 2 个）。**写操作，消耗你的硬币**。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            bvid: { type: "string" },
            count: { type: "number", description: "1 或 2，默认 1" },
            also_like: { type: "boolean", description: "同时点赞，默认 false" },
          },
          required: ["bvid"],
        },
      },
      {
        name: "list_msg_replies",
        description:
          "消息中心：别人**回复我的**、**@我的**、或**收到的赞**。" +
          "⚠️ B站 没有「我发出的评论」接口（实测全 404），只能看别人对我的互动 —— " +
          "想看自己发过什么评论得去 App 里的「消息 → 我的评论」。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", description: "reply(回复我) | at(@我) | like(收到的赞)，默认 reply" },
            limit: { type: "number", description: "条数，默认 20" },
          },
        },
      },
      {
        name: "get_subtitles",
        description:
          "拿视频字幕全文（带时间戳）。**看知识区视频最有用的一条** —— 抽出来可以直接让 AI 总结。" +
          "prefer_lang 可指定语言（如 zh-CN / en-US），不传则中文优先。" +
          "没字幕的视频会明确返回「没有字幕轨」，不是错误。",
        inputSchema: {
          type: "object",
          properties: {
            bvid: { type: "string" },
            prefer_lang: { type: "string", description: "首选语言，如 zh-CN" },
            max_chars: { type: "number", description: "最多返回多少字，默认 8000" },
          },
          required: ["bvid"],
        },
      },
      {
        name: "get_parts",
        description: "列出一个视频的分P（合集/多P视频的每一集，含 cid 和时长）。",
        inputSchema: {
          type: "object",
          properties: { bvid: { type: "string" } },
          required: ["bvid"],
        },
      },
      {
        name: "get_related",
        description: "B站 给某个视频推荐的相关视频。做「顺着看下去」或找同类内容时有用。",
        inputSchema: {
          type: "object",
          properties: {
            bvid: { type: "string" },
            limit: { type: "number", description: "条数，默认 10" },
          },
          required: ["bvid"],
        },
      },
      {
        name: "get_ranking",
        description: "B站 排行榜。rid 是分区 id（0=全站）。",
        inputSchema: {
          type: "object",
          properties: {
            rid: { type: "number", description: "分区 id，默认 0（全站）" },
            limit: { type: "number", description: "条数，默认 20" },
          },
        },
      },
      {
        name: "list_weekly",
        description: "B站 每周必看。number 不传则自动取最新一期。",
        inputSchema: {
          type: "object",
          properties: {
            number: { type: "number", description: "第几期，不传取最新" },
            limit: { type: "number", description: "条数，默认 20" },
          },
        },
      },
      {
        name: "get_user_stat",
        description: "查一个用户的关注数/粉丝数/获赞数。免登录也能用。",
        inputSchema: {
          type: "object",
          properties: { mid: { type: "number" } },
          required: ["mid"],
        },
      },
      {
        name: "get_my_top_content",
        description:
          "我发过的、**被点赞最多**的内容排行（评论/动态/弹幕）。" +
          "数据源是「收到的赞」消息流，counts 字段经跨接口验证确实等于总赞数。" +
          "局限：只能看到**收到过赞**的内容，没人赞的看不到。需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            top: { type: "number", description: "返回前多少条，默认 10" },
          },
        },
      },
      {
        name: "post_comment",
        description:
          "给视频发评论。⚠️ **不可逆的公开动作**，对方会看到并收到通知；调用前请确认内容和目标。" +
          "需 BILI_COOKIE（含 bili_jct）。",
        inputSchema: {
          type: "object",
          properties: {
            bvid: { type: "string", description: "目标视频 BV 号" },
            message: { type: "string", description: "评论内容（上限约 1000 字）" },
          },
          required: ["bvid", "message"],
        },
      },
      {
        name: "get_watch_time",
        description:
          "按天统计 B站 观看时长（翻观看历史聚合）。⚠️ **这是估算不是精确值** —— " +
          "B站没有公开的每日时长接口，只能用历史里每条视频的播放进度累加，" +
          "拖进度条/倍速/重复观看都会让它偏，且只覆盖打开过的视频。" +
          "需 BILI_COOKIE。",
        inputSchema: {
          type: "object",
          properties: {
            days: { type: "number", description: "统计最近多少天，默认 7" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params as any;
    const n = (v: any, d: number) => Math.max(1, Math.min(Number(v) || d, 50));
    try {
      switch (name) {
        case "check_login": {
          const s = await checkLogin(OPTS);
          if (!s.cookieConfigured) {
            return { content: [{ type: "text", text:
              "未配置 BILI_COOKIE —— 只读工具（视频信息/搜索/热门/评论）仍可用，\n" +
              "但 get_user_videos 和 like_video 用不了。\n" +
              "配置方法见 bilibili/README.md。" }] };
          }
          if (!s.loggedIn) {
            return { content: [{ type: "text", text:
              "配了 BILI_COOKIE 但服务端判定未登录 —— cookie 可能已过期或被踢，请重新获取。" }] };
          }
          return { content: [{ type: "text", text: [
            "✓ 已登录",
            `昵称 : ${s.uname}`,
            `mid  : ${s.mid}`,
            s.vip ? `会员 : ${s.vip}` : "",
            "全部工具可用（含用户投稿与点赞）。",
          ].filter(Boolean).join("\n") }] };
        }
        case "get_video": {
          const v = await getVideo(String(args.bvid), OPTS);
          const date = v.pubdate ? new Date(v.pubdate * 1000).toISOString().slice(0, 10) : "?";
          return { content: [{ type: "text", text: [
            `=== ${v.title} ===`,
            `UP主   : ${v.author} (mid ${v.mid})`,
            `发布   : ${date}   时长 ${v.duration}s`,
            `数据   : ${fmtNum(v.view)}播放  ${fmtNum(v.like)}点赞  ${fmtNum(v.coin)}投币  ${fmtNum(v.favorite)}收藏  ${fmtNum(v.reply)}评论`,
            `链接   : ${v.url}`,
            v.desc ? `简介   : ${v.desc}` : "",
          ].filter(Boolean).join("\n") }] };
        }
        case "search_videos": {
          const items = await searchVideos(String(args.keyword), n(args.limit, 10), OPTS);
          if (!items.length) return { content: [{ type: "text", text: "没搜到结果" }] };
          return { content: [{ type: "text",
            text: `=== 搜索「${args.keyword}」(${items.length} 条) ===\n` + renderList(items) }] };
        }
        case "list_popular": {
          const items = await listPopular(n(args.limit, 10), OPTS);
          return { content: [{ type: "text", text: `=== B站热门 ===\n` + renderList(items) }] };
        }
        case "get_comments": {
          const cs = await getComments(String(args.bvid), n(args.limit, 10), OPTS);
          if (!cs.length) return { content: [{ type: "text", text: "这个视频还没有评论" }] };
          const lines = cs.map((c, i) =>
            `${i + 1}. ${c.user}（${c.like}赞）\n   ${c.content.replace(/\n/g, " ")}`);
          return { content: [{ type: "text", text: `=== 评论 (${cs.length} 条) ===\n` + lines.join("\n") }] };
        }
        case "get_user_videos": {
          const items = await getUserVideos(Number(args.mid), n(args.limit, 10), OPTS);
          if (!items.length) return { content: [{ type: "text", text: "这个 UP 主没有公开投稿" }] };
          return { content: [{ type: "text", text: `=== UP 主 ${args.mid} 的投稿 ===\n` + renderList(items) }] };
        }
        case "like_video": {
          const msg = await likeVideo(String(args.bvid), OPTS, !!args.unlike);
          return { content: [{ type: "text", text: msg }] };
        }

        case "list_msg_replies": {
          const kind = ["reply", "at", "like"].includes(String(args.kind))
            ? String(args.kind) as "reply" | "at" | "like" : "reply";
          const ms = await listMsgFeed(kind, n(args.limit, 20), OPTS);
          if (!ms.length) return { content: [{ type: "text", text: "没有这类消息" }] };
          const names = { reply: "回复我的", at: "@我的", like: "收到的赞" };
          const lines = ms.map((m, i) => {
            const when = m.time ? new Date(m.time * 1000).toLocaleString("zh-CN") : "";
            const head = `${String(i + 1).padStart(2)}. ${m.from}  ${when}`;
            const body = m.text ? `\n     对方说: ${m.text.replace(/\n/g, " ")}` : "";
            const mine = m.mine ? `\n     ★ 你的内容: ${m.mine.replace(/\n/g, " ")}` : "";
            const link = m.url ? `\n     ${m.url}` : "";
            return head + body + mine + link;
          });
          return { content: [{ type: "text",
            text: `=== ${names[kind]} (${ms.length} 条) ===\n${lines.join("\n")}` }] };
        }
        case "get_subtitles": {
          const cap = Math.max(500, Math.min(Number(args.max_chars) || 8000, 60000));
          const r = await getSubtitles(String(args.bvid), OPTS, String(args.prefer_lang ?? ""));
          if (!r.tracks.length) {
            return { content: [{ type: "text",
              text: `这个视频没有字幕轨（实测 B站 不少视频确实没有，包括部分 AI 科普）。\n` +
                    `可以改用 get_video 拿简介，或看评论。` }] };
          }
          const p = r.picked!;
          const trackLine = r.tracks.map((t) => `${t.lang}(${t.label})`).join("、");
          let body = "";
          for (const c of p.cues) {
            const line = `[${Math.floor(c.from / 60)}:${String(Math.floor(c.from % 60)).padStart(2, "0")}] ${c.text}`;
            if (body.length + line.length > cap) { body += "\n…（已截断）"; break; }
            body += line + "\n";
          }
          return { content: [{ type: "text", text:
            `=== 字幕全文（${p.lang} ${p.label}）===\n` +
            `可选语言轨: ${trackLine}\n` +
            `共 ${p.cues.length} 段\n\n${body}` }] };
        }
        case "get_parts": {
          const ps = await getParts(String(args.bvid), OPTS);
          if (ps.length <= 1) {
            return { content: [{ type: "text", text: "这个视频只有 1 个分P（单P视频）" }] };
          }
          const lines = ps.map((p) =>
            `  P${String(p.page).padStart(2)}  ${fmtDur(String(p.duration)).padStart(8)}  ${p.title}`);
          return { content: [{ type: "text",
            text: `=== 分P列表 (${ps.length} 个) ===\n${lines.join("\n")}` }] };
        }
        case "get_related": {
          const rs = await getRelated(String(args.bvid), n(args.limit, 10), OPTS);
          if (!rs.length) return { content: [{ type: "text", text: "没有相关推荐" }] };
          return { content: [{ type: "text",
            text: `=== 相关推荐 (${rs.length} 条) ===\n` + renderList(rs) }] };
        }
        case "get_ranking": {
          const rs = await getRanking(n(args.limit, 20), OPTS, Number(args.rid) || 0);
          return { content: [{ type: "text",
            text: `=== 排行榜 (rid=${args.rid ?? 0}, ${rs.length} 条) ===\n` + renderList(rs) }] };
        }
        case "list_weekly": {
          const r = await listWeekly(n(args.limit, 20), OPTS,
            args.number ? Number(args.number) : undefined);
          return { content: [{ type: "text",
            text: `=== 每周必看 第 ${r.number} 期${r.subject ? "「" + r.subject + "」" : ""}` +
                  ` (${r.items.length} 条) ===\n` + renderList(r.items) }] };
        }
        case "get_user_stat": {
          const s = await getUserStat(Number(args.mid), OPTS);
          return { content: [{ type: "text", text: [
            `=== mid ${s.mid} ===`,
            `关注 : ${fmtNum(s.following)}`,
            `粉丝 : ${fmtNum(s.follower)}`,
            s.likes ? `获赞 : ${fmtNum(s.likes)}` : "",
            `空间 : https://space.bilibili.com/${s.mid}`,
          ].filter(Boolean).join("\n") }] };
        }
        case "get_my_top_content": {
          const r = await getTopLikedContent(OPTS, n(args.top, 10));
          if (!r.items.length) return { content: [{ type: "text", text: "没有收到过赞的内容" }] };
          const lines = r.items.map((c, i) => {
            const when = c.lastLikeAt
              ? new Date(c.lastLikeAt * 1000).toLocaleDateString("zh-CN") : "?";
            return `${String(i + 1).padStart(2)}. ${String(c.likes).padStart(4)} 赞  [${c.kind}]\n` +
                   `     ${c.title.replace(/\n/g, " ")}\n` +
                   `     最后收到赞: ${when}\n` +
                   `     ${c.directUrl}`;
          });
          return { content: [{ type: "text", text: [
            `=== 我被点赞最多的内容（前 ${r.items.length}）===`,
            ...lines,
            "",
            `翻了 ${r.pages} 页${r.exhausted ? "（页数上限，还有更早的没取完）" : "（已取尽）"}`,
            "注意：只有收到过赞的内容才会出现，没人赞的看不到。",
            "日期是**最后一次收到赞**的时间，不是内容发布时间。",
          ].join("\n") }] };
        }
        case "post_comment": {
          const r = await postComment(String(args.bvid), String(args.message ?? ""), OPTS);
          return { content: [{ type: "text", text:
            `✓ 评论已发出（rpid ${r.rpid}）\n「${r.preview}」\n` +
            `链接：https://www.bilibili.com/video/${args.bvid}` }] };
        }

        // ---- 写操作（改变账号/公开状态，调用前请确认） ----
        case "follow_user": {
          const msg = await followUser(Number(args.mid), OPTS, !!args.unfollow);
          return { content: [{ type: "text", text: msg }] };
        }
        case "favorite_video": {
          const msg = await favoriteVideo(String(args.bvid), OPTS,
            args.folder_id ? Number(args.folder_id) : undefined, !!args.unfavorite);
          return { content: [{ type: "text", text: msg }] };
        }
        case "coin_video": {
          const msg = await coinVideo(String(args.bvid), OPTS,
            Number(args.count) || 1, !!args.also_like);
          return { content: [{ type: "text", text: msg }] };
        }

        // ---- 个人向 ----
        case "list_fav_folders": {
          const mid = args.mid ? Number(args.mid) : await resolveMid(OPTS);
          const fs = await listFavFolders(mid, OPTS);
          if (!fs.length) return { content: [{ type: "text", text: "没有收藏夹" }] };
          const lines = fs.map((f) =>
            `  ${String(f.id).padEnd(12)} ${f.title}${f.isDefault ? "（默认）" : ""}  ${f.count} 个内容`);
          return { content: [{ type: "text",
            text: `=== 收藏夹 (${fs.length} 个) ===\n${lines.join("\n")}\n\n` +
                  `用 list_favorites 传 media_id 查看某个收藏夹的内容。` }] };
        }
        case "list_favorites": {
          if (!args.media_id) return { content: [{ type: "text", text: "需要 media_id（先用 list_fav_folders 拿）" }] };
          const items = await listFavorites(Number(args.media_id), n(args.limit, 20), OPTS);
          const lines = items.map((v, i) =>
            `${String(i + 1).padStart(2)}. ${v.title}\n` +
            `    ${v.up}  ${fmtNum(v.play)}播放  ${v.url}`);
          return { content: [{ type: "text",
            text: `=== 收藏夹内容 (${items.length} 条) ===\n${lines.join("\n")}` }] };
        }
        case "list_followings":
        case "list_fans": {
          const kind = name === "list_fans" ? "fans" : "followings";
          const mid = args.mid ? Number(args.mid) : await resolveMid(OPTS);
          const us = await listRelation(mid, kind, n(args.limit, 20), OPTS);
          if (!us.length) return { content: [{ type: "text", text: "列表为空" }] };
          const lines = us.map((u, i) =>
            `${String(i + 1).padStart(2)}. ${u.uname}  (mid ${u.mid})\n` +
            (u.sign ? `     ${u.sign}\n` : "") + `     ${u.url}`);
          return { content: [{ type: "text",
            text: `=== ${kind === "fans" ? "粉丝" : "关注"} (${us.length} 个) ===\n${lines.join("\n")}` }] };
        }
        case "get_history": {
          const hs = await getHistory(n(args.limit, 20), OPTS);
          if (!hs.length) return { content: [{ type: "text", text: "没有观看记录" }] };
          const lines = hs.map((h, i) => {
            const pct = h.duration ? ` (看到 ${Math.round(h.progress / h.duration * 100)}%)` : "";
            return `${String(i + 1).padStart(2)}. ${h.title}${pct}\n     ${h.up}  ${h.url}`;
          });
          return { content: [{ type: "text",
            text: `=== 观看历史 (${hs.length} 条) ===\n${lines.join("\n")}` }] };
        }
        case "list_toview": {
          const items = await listToView(n(args.limit, 20), OPTS);
          if (!items.length) return { content: [{ type: "text", text: "「稍后再看」是空的" }] };
          return { content: [{ type: "text",
            text: `=== 稍后再看 (${items.length} 条) ===\n` + renderList(items) }] };
        }
        case "get_watch_time": {
          const days = Math.max(1, Math.min(Number(args.days) || 7, 90));
          const r = await getWatchTime(days, OPTS);
          if (!r.days.length) {
            return { content: [{ type: "text",
              text: `最近 ${days} 天没有观看记录（或者历史不公开）。` }] };
          }
          const lines = r.days.map((d) => {
            const bar = "█".repeat(Math.min(20, Math.round(d.seconds / 1800)));
            return `  ${d.date}  ${fmtSec(d.seconds).padStart(9)}  ${String(d.videos).padStart(3)} 个视频` +
                   `（看完 ${d.finished}）  ${bar}`;
          });
          const avg = r.totalSeconds / r.days.length;
          const peak = r.days.reduce((a, b) => (b.seconds > a.seconds ? b : a), r.days[0]);
          return { content: [{ type: "text", text: [
            `=== 最近 ${days} 天观看时长（估算）===`,
            ...lines,
            "",
            `合计 ${fmtSec(r.totalSeconds)}，日均 ${fmtSec(avg)}，最多的一天是 ${peak.date}（${fmtSec(peak.seconds)}）`,
            "",
            "⚠️ 这是估算：B站没有公开的每日时长接口，这里是把历史记录里每条视频的",
            "播放进度累加出来的。拖进度条、倍速、重复观看都会让它偏，且只覆盖你",
            "打开过的视频（所以整体偏保守）。",
            r.truncated ? `\n注意：翻页达到上限（${r.pagesFetched} 页）就停了，更早的记录没取完。` : "",
          ].filter(Boolean).join("\n") }] };
        }
        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      const prefix = e instanceof BiliError ? "获取失败" : "错误";
      return { content: [{ type: "text", text: `${prefix}: ${e?.message ?? e}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => { console.error("bilibili 启动失败:", e); process.exit(1); });
