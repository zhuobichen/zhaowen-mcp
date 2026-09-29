#!/usr/bin/env npx tsx
/**
 * hot-trending MCP Server
 *
 * 中文平台热榜聚合：一次调用拿 B站 / 微博 / 贴吧 的热榜，知乎需要 cookie。
 *
 * 实测结论（2026-09-26，本机网络）：
 *   B站  api.bilibili.com/x/web-interface/search/square    免登录 ✓
 *   微博 weibo.com/ajax/side/hotSearch                     免登录 ✓
 *   贴吧 tieba.baidu.com/hottopic/browse/topicList         免登录 ✓
 *   知乎 全部热榜接口都 401，免登录只剩时好时坏的 top_search  ✗ 需 cookie
 *
 * 启动: npx tsx zhaowen-mcp/hot-trending/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BOARDS, fetchHot, BoardError, listMyForums, type HotItem } from "./sources.js";

function fmtHot(n?: string): string {
  if (!n) return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return `热度 ${n}`;
  if (v >= 1e8) return `热度 ${(v / 1e8).toFixed(1)} 亿`;
  if (v >= 1e4) return `热度 ${(v / 1e4).toFixed(1)} 万`;
  return `热度 ${v}`;
}

function render(items: HotItem[]): string {
  const lines: string[] = [];
  for (const it of items) {
    const bits = [fmtHot(it.hot), it.tag].filter(Boolean).join("  ");
    lines.push(`${String(it.rank).padStart(2)}. ${it.title}${bits ? "  (" + bits + ")" : ""}`);
    if (it.desc) lines.push(`     ${it.desc.slice(0, 80)}`);
  }
  return lines.join("\n");
}

async function main() {
  const server = new Server(
    { name: "hot-trending", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_boards",
        description:
          "列出支持的热榜平台，以及各自是否需要登录凭据。不确定平台 id 时先调这个。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_hot",
        description:
          "获取某个平台的热榜。board 取值见 list_boards；limit 默认 20。" +
          "知乎需要环境变量 ZHIHU_COOKIE，没配会返回明确的提示而不是空列表。",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "平台 id: bilibili | weibo | tieba | zhihu",
            },
            limit: { type: "number", description: "返回条数，默认 20，上限 100" },
          },
          required: ["board"],
        },
      },
      {
        name: "list_my_forums",
        description:
          "我关注的贴吧列表（含每个吧的等级与今日是否已签到）。需环境变量 TIEBA_BDUSS。" +
          "**注意：这是贴吧唯一开放给自动化的登录接口** —— 读吧内容/帖子/发帖回帖都会被" +
          "「百度安全验证」拦下，纯 HTTP 走不通（详见 README 的贴吧那节）。",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "返回条数，默认 50" },
            sort_by_level: { type: "boolean", description: "按等级降序，默认 false（按关注顺序）" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params as any;
    try {
      switch (name) {
        case "list_boards": {
          const lines = BOARDS.map(
            (b) =>
              `  ${b.id.padEnd(10)} ${b.name.padEnd(8)} ` +
              `${b.needsAuth ? "需要登录" : "免登录  "}  ${b.note}`
          );
          return {
            content: [{
              type: "text",
              text: ["=== 支持的热榜平台 ===", ...lines].join("\n"),
            }],
          };
        }

        case "get_hot": {
          const board = String(args.board ?? "").trim();
          const limit = args.limit ? Number(args.limit) : 20;
          const items = await fetchHot(board, {
            limit,
            zhihuCookie: process.env.ZHIHU_COOKIE,
          });
          const meta = BOARDS.find((b) => b.id === board);
          return {
            content: [{
              type: "text",
              text: [
                `=== ${meta?.name ?? board}（${items.length} 条，来源：${meta?.note ?? "?"}）===`,
                render(items),
              ].join("\n"),
            }],
          };
        }

        case "list_my_forums": {
          const r = await listMyForums(process.env.TIEBA_BDUSS ?? "");
          let fs = r.forums;
          if (args.sort_by_level) fs = [...fs].sort((a, b) => b.level - a.level || b.exp - a.exp);
          const limit = Math.max(1, Math.min(Number(args.limit) || 50, 500));
          const shown = fs.slice(0, limit);
          if (!shown.length) {
            return { content: [{ type: "text", text: "没有关注任何贴吧" }] };
          }
          const lines = shown.map((f, i) =>
            `  ${String(i + 1).padStart(3)}. ${f.name.padEnd(20)} Lv.${String(f.level).padStart(2)}  ` +
            `经验 ${String(f.exp).padStart(6)}${f.signed ? "  ✓已签到" : ""}`);
          const signed = r.forums.filter((f) => f.signed).length;
          return { content: [{ type: "text", text: [
            `=== 我关注的贴吧（uid ${r.uid}）===`,
            `共 ${r.forums.length} 个，今日已签到 ${signed} 个；显示前 ${shown.length} 个`,
            "",
            ...lines,
          ].join("\n") }] };
        }

        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      if (e instanceof BoardError) {
        return { content: [{ type: "text", text: `获取失败: ${e.message}` }] };
      }
      return { content: [{ type: "text", text: `错误: ${e?.message ?? e}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("hot-trending 启动失败:", e);
  process.exit(1);
});
