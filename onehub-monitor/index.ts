#!/usr/bin/env npx tsx
/**
 * onehub-monitor MCP Server
 *
 * 定时监测 one-hub 用量：实时总额度/已用/剩余（美元+人民币），按日快照记账，显示每日/每月花费。
 * 数据源：one-hub OpenAI 兼容 billing 接口（总量，含美分换算）。
 *
 * 启动: npx tsx mcp-server/onehub-monitor/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { checkUsage, dailySnapshot, loadHistory, getConfig } from "./monitor.js";

function fmtUsd(usd: number, rate: number): string {
  return `$${usd.toFixed(2)} (¥${(usd * rate).toFixed(2)})`;
}

async function main() {
  const server = new Server(
    { name: "onehub-monitor", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "check_usage",
        description:
          "实时查询 one-hub 当前用量：总额度/已使用/剩余（美元+人民币）、使用率。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "daily_snapshot",
        description:
          "记录今日用量快照到本地账本，并返回每日花费（近30天）与每月合计（本地记账，首次运行后次日才有差值）。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "usage_history",
        description:
          "读取本地账本，返回已记录的每日/每月花费（不重新查询 API）。",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "返回最近 N 天（默认 30）",
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {
        case "check_usage": {
          const u = await checkUsage();
          return {
            content: [{
              type: "text",
              text: [
                `=== one-hub 用量（汇率 ${u.rate}）===`,
                `总额度 : ${fmtUsd(u.limitUsd, u.rate)}`,
                `已使用 : ${fmtUsd(u.usedUsd, u.rate)}`,
                `剩余   : ${fmtUsd(u.remainUsd, u.rate)}`,
                `使用率 : ${u.usedPct.toFixed(1)}%`,
                u.usedPct >= 80 ? "⚠️ 已使用超过 80%，建议关注额度余量" : "",
              ].filter(Boolean).join("\n"),
            }],
          };
        }

        case "daily_snapshot": {
          const r = await dailySnapshot();
          const rate = (await checkUsage()).rate;
          const lines = [`=== 今日快照已记录: ${r.today} ===`];
          if (r.daily.length === 0) {
            lines.push("仅一条基准记录，请会话内定时再次调用 daily_snapshot，次日即可看到每日花费。");
          } else {
            lines.push(`${"日期".padEnd(12)}${"当日花费".padStart(14)}${"人民币".padStart(14)}`);
            for (const d of r.daily.slice(-30)) {
              lines.push(`${d.date.padEnd(12)}$${d.usd.toFixed(2).padStart(12)}  ¥${(d.usd * rate).toFixed(2).padStart(11)}`);
            }
            lines.push("");
            lines.push(`${"月份".padEnd(10)}${"当月合计".padStart(14)}${"人民币".padStart(14)}`);
            for (const m of r.monthly) {
              lines.push(`${m.month.padEnd(10)}$${m.usd.toFixed(2).padStart(12)}  ¥${(m.usd * rate).toFixed(2).padStart(11)}`);
            }
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "usage_history": {
          const h = loadHistory();
          const rate = (await checkUsage()).rate;
          const limit = args.limit ? Number(args.limit) : 30;
          const dates = Object.keys(h).sort();
          if (dates.length < 2) {
            return { content: [{ type: "text", text: "账本记录不足，请先调用 daily_snapshot 至少两次（跨天）" }] };
          }
          const lines = ["=== 每日花费（本地账本） ==="];
          lines.push(`${"日期".padEnd(12)}${"当日花费".padStart(14)}${"人民币".padStart(14)}`);
          const daily = [];
          for (let i = 1; i < dates.length; i++) {
            daily.push({ date: dates[i], usd: (h[dates[i]] - h[dates[i - 1]]) / 100 });
          }
          for (const d of daily.slice(-limit)) {
            lines.push(`${d.date.padEnd(12)}$${d.usd.toFixed(2).padStart(12)}  ¥${(d.usd * rate).toFixed(2).padStart(11)}`);
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      return { content: [{ type: "text", text: `错误: ${e.message}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
