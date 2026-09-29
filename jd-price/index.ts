#!/usr/bin/env npx tsx
/**
 * jd-price MCP Server
 *
 * 读京东商品信息与当前价。输入是 **SKU 或商品链接**（不是关键词 —— 京东搜索页
 * 是 JS 空壳，纯 HTTP 拿不到结果）。
 *
 * 环境变量:
 *   JD_COOKIE  必填才能拿到价格。京东对未登录用户把价格打码成 "1??9"，
 *              所以没有 cookie 时只能拿商品名/店铺/品牌。
 *              实测只需浏览器里那一个 `flash` cookie（别抄社区文档的
 *              pt_key/pt_pin，本机登录态里根本没这两个，详见 README）。
 *
 * 没有「历史价格」—— 京东不提供，第三方比价站同样要登录且实测拿不到。
 *
 * 启动: npx tsx zhaowen-mcp/jd-price/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { JdError, getItem, compareItems, type JdItem } from "./sources.js";

const COOKIE = process.env.JD_COOKIE ?? "";

function renderItem(it: JdItem): string {
  const price = it.priceMasked
    ? "（未登录，京东打码）"
    : `¥${it.price}`;
  return [
    `  ${it.name}`,
    `    价格 : ${price}`,
    `    店铺 : ${it.shop || "?"}${it.brand ? "   品牌: " + it.brand : ""}`,
    `    SKU  : ${it.skuId}    ${it.url}`,
  ].join("\n");
}

async function main() {
  const server = new Server(
    { name: "jd-price", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_item",
        description:
          "读一个京东商品的名称/店铺/品牌/当前价。参数给 SKU（纯数字）或商品链接均可。" +
          "**价格需要 JD_COOKIE** —— 京东对未登录用户把价格打码成 1??9。",
        inputSchema: {
          type: "object",
          properties: {
            sku: { type: "string", description: "SKU 数字，或 item.jd.com / item.m.jd.com 的链接" },
          },
          required: ["sku"],
        },
      },
      {
        name: "compare_items",
        description:
          "批量取多个京东商品并排比价。给 SKU 或链接的数组（上限 20 个）。" +
          "用来在几款高达之间对比价格。同样需要 JD_COOKIE 才能看到价格。",
        inputSchema: {
          type: "object",
          properties: {
            skus: {
              type: "array",
              items: { type: "string" },
              description: "SKU 或链接的数组",
            },
          },
          required: ["skus"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params as any;
    try {
      switch (name) {
        case "get_item": {
          const it = await getItem(String(args.sku ?? ""), COOKIE);
          const warn = it.priceMasked
            ? "\n⚠️ 价格被打码 —— 没配 JD_COOKIE，或 cookie 已失效。配置方法见 README。"
            : "";
          return { content: [{ type: "text", text: "===\n" + renderItem(it) + warn }] };
        }
        case "compare_items": {
          const skus: string[] = Array.isArray(args.skus) ? args.skus : [];
          if (!skus.length) return { content: [{ type: "text", text: "skus 不能为空" }] };
          const { items, failed } = await compareItems(skus, COOKIE);
          const lines = items.map((it, i) => `${String(i + 1).padStart(2)}.\n${renderItem(it)}`);
          const tail: string[] = [];
          if (failed.length) {
            tail.push("", "取不到的：");
            for (const f of failed) tail.push(`  ${f.sku} → ${f.error}`);
          }
          const masked = items.filter((i) => i.priceMasked).length;
          if (masked) tail.push("", `⚠️ ${masked} 件价格被打码（未配 JD_COOKIE 或已失效）`);
          return { content: [{ type: "text",
            text: `=== 京东商品对比 (${items.length} 件) ===\n` + lines.join("\n") + tail.join("\n") }] };
        }
        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      const p = e instanceof JdError ? "读取失败" : "错误";
      return { content: [{ type: "text", text: `${p}: ${e?.message ?? e}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => { console.error("jd-price 启动失败:", e); process.exit(1); });
