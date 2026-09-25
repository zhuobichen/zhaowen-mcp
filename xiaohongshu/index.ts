#!/usr/bin/env npx tsx
/**
 * 小红书 MCP Server（stdio）
 *
 * 把本机跑着的小红书引擎（`xiaohongshu-mcp`，默认 http://localhost:18060/mcp）
 * 代理成一套适合在这里直接用的工具，并在**发出去之前**做参数把关：
 * 标题字数、正文里的 `#标签`、图片路径。
 *
 * 引擎不是本服务的一部分——它是浏览器自动化，你自己起（Docker 或二进制）。
 * 本服务只负责"把话说清楚、把参数弄对"。
 *
 * 启动: npx tsx xiaohongshu/index.ts
 * 环境: XHS_ENGINE_URL（默认 http://localhost:18060/mcp）
 *       XHS_TIMEOUT_MS（默认 180000）
 *       XHS_QR_DIR（二维码 PNG 落盘目录，默认系统临时目录）
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CALL_TIMEOUT_MS,
  ENGINE_URL,
  callEngine,
  describeConnectionError,
  engineToolNames,
  normaliseNote,
  renderPreview,
  requireTool,
  type NoteInput,
} from "./engine.js";

/** 本服务的工具 → 它依赖的引擎工具。**两家引擎的工具集不一样**，所以要逐个核。 */
const NEEDS: Array<[string, string, string]> = [
  ["xhs_status", "check_login_status", "查登录状态"],
  ["xhs_login_qrcode", "get_login_qrcode", "扫码登录"],
  ["xhs_publish_note", "publish_content", "发布图文"],
  ["xhs_save_draft", "save_draft", "存草稿"],
  ["xhs_search", "search_feeds", "搜索笔记"],
  ["xhs_my_feeds", "get_my_feeds", "我发布的笔记"],
  ["xhs_get_note", "get_feed_detail", "笔记详情"],
  ["xhs_delete_note", "delete_feed", "删除笔记"],
];

const QR_DIR = process.env.XHS_QR_DIR?.trim() || tmpdir();

/** 引擎里"会改变线上状态"的工具，走 xhs_raw 时必须显式确认。 */
const NEEDS_CONFIRM = /publish|delete|comment|follow|like|favorite|draft|schedule/i;

type ToolResult = {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
};

function ok(text: string, extra: Array<Record<string, unknown>> = []): ToolResult {
  return { content: [{ type: "text", text }, ...extra] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** 引擎返回的二维码是个 base64 图，落成 PNG 才好扫。 */
function saveQrPng(raw: unknown): { path: string; base64: string } | null {
  const content = (raw as { content?: unknown })?.content;
  const items = Array.isArray(content) ? content : [];
  for (const c of items) {
    const item = c as { type?: string; data?: string; mimeType?: string };
    if (item.type === "image" && typeof item.data === "string") {
      const b64 = item.data.replace(/^data:image\/\w+;base64,/, "");
      mkdirSync(QR_DIR, { recursive: true });
      const p = join(QR_DIR, `xhs-qrcode-${Date.now()}.png`);
      writeFileSync(p, Buffer.from(b64, "base64"));
      return { path: p, base64: b64 };
    }
  }
  // 有些实现把 base64 塞在文本里
  const text = items
    .map((c) => (c as { text?: string }).text ?? "")
    .join("\n")
    .trim();
  const m = /^data:image\/\w+;base64,(.+)$/s.exec(text) ?? /^([A-Za-z0-9+/=\s]{200,})$/.exec(text);
  if (m) {
    const b64 = m[1].replace(/\s+/g, "");
    mkdirSync(QR_DIR, { recursive: true });
    const p = join(QR_DIR, `xhs-qrcode-${Date.now()}.png`);
    writeFileSync(p, Buffer.from(b64, "base64"));
    return { path: p, base64: b64 };
  }
  return null;
}

async function main() {
  const server = new Server(
    { name: "xiaohongshu", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "xhs_status",
        description:
          "检查小红书引擎是否连着、是否已登录。**第一次用、或任何工具报连不上时，先跑这个。**",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "xhs_login_qrcode",
        description:
          "取登录二维码并存成 PNG，返回图片与文件路径。用小红书 App 扫码即完成登录。" +
          "注意：同一账号不要在别的网页端同时登录，会把这里的登录踢掉（App 端不受影响）。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "xhs_publish_note",
        description:
          "**发布**一篇图文笔记到小红书（立即公开可见）。标题上限 20 字；正文里的 #话题 会自动移到标签参数；" +
          "本地图片路径会先校验存在性。建议先 dry_run=true 看一眼将要发送的内容再正式发。",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "标题，不超过 20 字" },
            content: { type: "string", description: "正文。不要在里面写 #话题，直接放到 tags 参数" },
            images: {
              type: "array",
              items: { type: "string" },
              description: "图片：本地绝对路径或 http(s) 链接，最多 18 张",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "话题标签，不带 #，例如 [\"数学建模\", \"无人机\"]",
            },
            location: { type: "string", description: "可选：位置" },
            note_type: { type: "string", description: "可选：笔记类型（引擎支持时才有用）" },
            dry_run: {
              type: "boolean",
              description: "true 时只做校验并回显将要发送的参数，不发布。默认 false",
            },
          },
          required: ["title", "content", "images"],
        },
      },
      {
        name: "xhs_save_draft",
        description: "把图文**存成草稿**（不公开发布）。参数同 xhs_publish_note（无 dry_run）。",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            images: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            location: { type: "string" },
          },
          required: ["title", "content", "images"],
        },
      },
      {
        name: "xhs_search",
        description: "搜索小红书上的公开笔记（只读）。",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "搜索词" },
            limit: { type: "number", description: "最多返回几条，默认 20" },
          },
          required: ["keyword"],
        },
      },
      {
        name: "xhs_my_feeds",
        description: "列出我自己发布过的笔记（只读）。",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "最多返回几条，默认 20" },
          },
        },
      },
      {
        name: "xhs_get_note",
        description: "取一篇笔记的详情与评论（只读）。",
        inputSchema: {
          type: "object",
          properties: {
            feed_id: { type: "string", description: "笔记 id" },
            xsec_token: { type: "string", description: "部分实现需要配合 token" },
          },
          required: ["feed_id"],
        },
      },
      {
        name: "xhs_delete_note",
        description: "删除我自己的一篇笔记。**不可恢复**，必须显式传 confirm=true。",
        inputSchema: {
          type: "object",
          properties: {
            feed_id: { type: "string", description: "要删除的笔记 id" },
            confirm: { type: "boolean", description: "必须为 true 才会真正删除" },
          },
          required: ["feed_id", "confirm"],
        },
      },
      {
        name: "xhs_raw",
        description:
          "直通引擎的任意工具（上游一共 25 个，本服务只包装了常用的那几个）。" +
          "先用 xhs_status 可以看到引擎实际提供哪些工具名。" +
          "对发布/删除/评论/点赞这类会改变线上状态的操作，必须传 confirm=true。",
        inputSchema: {
          type: "object",
          properties: {
            tool: { type: "string", description: "引擎的工具名，如 list_feeds" },
            args: { type: "object", description: "传给该工具的参数对象" },
            confirm: {
              type: "boolean",
              description: "目标工具会改变线上状态时必须为 true",
            },
          },
          required: ["tool"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, any>;
    try {
      // 先确认这个引擎有没有对应的工具（两家引擎的工具集不一样）。
      // `xhs_status` 自己排除在外——它要负责把"缺哪些工具"报出来，
      // 不能因为缺一个工具就退化成报错。
      const need = NEEDS.find(([mine]) => mine === name && mine !== "xhs_status");
      if (need) await requireTool(need[1], need[2]);

      switch (name) {
        case "xhs_status": {
          const lines = [`引擎地址：${ENGINE_URL}`, `调用超时：${CALL_TIMEOUT_MS} ms`];
          try {
            const tools = await engineToolNames();
            const has = new Set(tools);
            lines.push("引擎：**可达** ✓");
            lines.push(`引擎提供 ${tools.length} 个工具：${tools.join(", ")}`);
            // **两家引擎的工具集不一样**（xpzouying 版没有 save_draft /
            // get_my_feeds / delete_feed），所以逐个报本服务的工具能不能用——
            // 免得用的时候才发现某个工具在这台引擎上压根不存在。
            const missing = NEEDS.filter(([, t]) => !has.has(t));
            lines.push("");
            lines.push("本服务的工具在这个引擎上的可用性：");
            for (const [mine, theirs] of NEEDS) {
              lines.push(`  ${has.has(theirs) ? "✓" : "✗"} ${mine}  ← ${theirs}`);
            }
            if (missing.length) {
              lines.push("");
              lines.push(
                `注意：${missing.map(([m, t]) => `${m}（缺 ${t}）`).join("、")} 在这个引擎上用不了。` +
                  "不同引擎的工具集不一样，可以换引擎或用 xhs_raw 调它能提供的工具。",
              );
            }
            lines.push("");
            if (has.has("check_login_status")) {
              const st = await callEngine("check_login_status", {});
              lines.push("登录状态：");
              lines.push(st.text.trim() || "(引擎未返回内容)");
            } else {
              lines.push("登录状态：这个引擎没有 check_login_status，查不了。");
            }
          } catch (e) {
            lines.push("引擎：**连不上** ✗");
            lines.push("");
            lines.push(describeConnectionError(e));
          }
          return ok(lines.join("\n"));
        }

        case "xhs_login_qrcode": {
          const r = await callEngine("get_login_qrcode", {});
          const qr = saveQrPng(r.raw);
          if (!qr) {
            return ok(
              "引擎没有返回二维码图片，原始返回如下：\n\n" + r.text,
            );
          }
          return ok(
            [
              `二维码已存到：${qr.path}`,
              "用小红书 App 扫码即可。扫完再用 xhs_status 确认登录状态。",
              "（若引擎自己带界面，也可以直接看那个窗口。）",
            ].join("\n"),
            [{ type: "image", data: qr.base64, mimeType: "image/png" }],
          );
        }

        case "xhs_publish_note":
        case "xhs_save_draft": {
          const isDraft = name === "xhs_save_draft";
          const { payload, warnings } = normaliseNote(args as NoteInput);
          const preview = renderPreview(payload, warnings);
          if (!isDraft && args.dry_run === true) {
            return ok(
              `【dry_run：没有发布任何东西】\n\n${preview}\n\n` +
                "确认无误后，把 dry_run 去掉（或设为 false）再调用一次即会正式发布。",
            );
          }
          const target = isDraft ? "save_draft" : "publish_content";
          const r = await callEngine(target, payload as unknown as Record<string, unknown>);
          const head = isDraft ? "已存草稿。" : "已提交发布。";
          return ok(`${head}\n\n${r.text.trim()}\n\n---\n${preview}`);
        }

        case "xhs_search": {
          const kw = String(args.keyword ?? "").trim();
          if (!kw) return fail("请提供 keyword。");
          const r = await callEngine("search_feeds", {
            keyword: kw,
            limit: Number(args.limit ?? 20),
          });
          return ok(r.text);
        }

        case "xhs_my_feeds": {
          const r = await callEngine("get_my_feeds", {
            limit: Number(args.limit ?? 20),
          });
          return ok(r.text);
        }

        case "xhs_get_note": {
          const id = String(args.feed_id ?? "").trim();
          if (!id) return fail("请提供 feed_id。");
          const a: Record<string, unknown> = { feed_id: id };
          if (args.xsec_token) a.xsec_token = String(args.xsec_token);
          const r = await callEngine("get_feed_detail", a);
          return ok(r.text);
        }

        case "xhs_delete_note": {
          const id = String(args.feed_id ?? "").trim();
          if (!id) return fail("请提供 feed_id。");
          if (args.confirm !== true) {
            return fail(
              `删除不可恢复，先确认一次：\n  feed_id = ${id}\n` +
                `确认要删就带 confirm=true 再调用一次。`,
            );
          }
          const r = await callEngine("delete_feed", { feed_id: id });
          return ok(`删除请求已提交。\n\n${r.text}`);
        }

        case "xhs_raw": {
          const tool = String(args.tool ?? "").trim();
          if (!tool) return fail("请提供 tool（引擎的工具名）。");
          if (NEEDS_CONFIRM.test(tool) && args.confirm !== true) {
            return fail(
              `「${tool}」会改变线上状态（发布/删除/评论/关注之类），` +
                `必须显式传 confirm=true 才会执行。`,
            );
          }
          const r = await callEngine(tool, (args.args ?? {}) as Record<string, unknown>);
          return ok(r.text);
        }

        default:
          return fail(`未知工具: ${name}`);
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      // 连不上引擎是最常见的失败，单独给人话
      if (/ECONNREFUSED|fetch failed|socket hang up|ECONNRESET|ENOTFOUND/i.test(msg)) {
        return fail(describeConnectionError(e));
      }
      return fail(`错误: ${msg}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("[xiaohongshu] 启动失败:", e);
  process.exit(1);
});
