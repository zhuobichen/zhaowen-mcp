#!/usr/bin/env npx tsx
/**
 * Agent Session Viewer MCP Server
 *
 * 只读查看本机智能体会话(Claude Code + Codex)：
 *   - list_agent_sessions    列出全部会话(来源/标题/时间/项目/归档)
 *   - read_agent_session     按 id/前缀查看某会话全文(可带 limit)
 *   - search_agent_sessions  按关键词搜索会话内容并返回命中片段
 *
 * 数据源：
 *   claude : ~/.claude/projects 下各项目目录的 <uuid>.jsonl
 *   codex  : ~/.codex/sessions 下 rollout-*.jsonl 与 ~/.codex/archived_sessions
 *
 * 启动: node <tsx> mcp-server/agent-sessions/index.ts
 * 数据来源只读，不修改任何会话文件。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  findSession,
  listSessions,
  readMessages,
  readDetailed,
  formatDetailed,
  AgentSession,
  AgentKind,
} from "./sessions.js";

const DEFAULT_MAX_MSGS = 500;
const DEFAULT_MAX_MSG_LEN = 8000;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAgent(v: any): AgentKind | "all" {
  const a = String(v || "all").toLowerCase().trim();
  if (a === "claude" || a === "codex") return a;
  return "all";
}

function srcLabel(rec: AgentSession): string {
  return rec.agent === "claude" ? "C" : "X";
}

function shortId(rec: AgentSession): string {
  return rec.id.slice(0, 8);
}

async function listTool(args: Record<string, any>) {
  const agent = parseAgent(args.agent);
  const sessions = await listSessions(agent);
  if (!sessions.length) {
    const scope = agent === "all" ? "" : ` ${agent} `;
    return `（没有找到${scope}会话）`;
  }
  const lines = sessions.map(
    (s, i) =>
      `[${i + 1}] [${srcLabel(s)}] ${shortId(s)} ${s.time} ${s.archived ? "[归档] " : ""}${s.project || ""}\n     ${truncate(s.title.replace(/\n/g, " "), 80)}`
  );
  const countLabel =
    agent === "all"
      ? `${sessions.length} 个会话（C=${sessions.filter((s) => s.agent === "claude").length} claude + ${sessions.filter((s) => s.agent === "codex").length} codex）`
      : `${sessions.length} 个 ${agent} 会话`;
  return `共 ${countLabel}:\n\n` + lines.join("\n");
}

async function readTool(args: Record<string, any>) {
  const id = String(args.id || "").trim();
  if (!id) return "错误: 请提供会话 id（可前缀匹配）";
  const agent = parseAgent(args.agent);
  const sessions = await listSessions(agent);
  const rec = findSession(sessions, id, agent);
  if (!rec) {
    return `错误: 未找到 ${agent === "all" ? "" : agent + " "}会话 ${id}。用 list_agent_sessions 查看可用的会话。`;
  }
  const maxMsgs = Number(args.max_messages) || DEFAULT_MAX_MSGS;
  const maxMsgLen = Number(args.max_msg_len) || DEFAULT_MAX_MSG_LEN;
  const detail = args.detail === true || args.detail === "true" || args.detail === 1;

  const head = [
    `来源: ${rec.agent}  会话ID: ${rec.id}`,
    `项目: ${rec.project}`,
    `时间: ${rec.time}  归档: ${rec.archived ? "是" : "否"}`,
    "=".repeat(70),
  ].join("\n");

  if (detail) {
    // detail=true:文本 + 工具摘要（含代码改动/命令，只列动作不贴 diff）
    const items = await readDetailed(rec, maxMsgs);
    const body = formatDetailed(items, maxMsgLen).trim();
    if (!body) return `${head}\n（无对话内容）`;
    const note = `\n\n[detail=true 视图：含工具动作摘要；纯文字用 detail=false]`;
    return `${head}\n${body}${note}`;
  }

  const msgs = await readMessages(rec, maxMsgs);
  if (!msgs.length) return `${head}\n（无对话内容）`;

  const body = msgs.map((m) => {
    const stamp = (m.ts || "").slice(11, 19);
    const who = m.role === "user" ? "👤 用户" : "🤖 助手";
    const text = truncate(m.text || "（无文本，可能是纯工具调用）", maxMsgLen);
    return `\n--- ${who} ${stamp} ---\n${text}`;
  });
  const tail = msgs.length >= maxMsgs ? `\n… （已达上限 ${maxMsgs} 条，用 max_messages 调大）` : "";
  return head + "\n" + body.join("\n") + tail;
}

async function searchTool(args: Record<string, any>) {
  const query = String(args.query || "").trim();
  if (!query) return "错误: 请提供 query 关键词";
  const agent = parseAgent(args.agent);
  let rx: RegExp;
  try {
    rx = new RegExp(query, "i");
  } catch {
    rx = new RegExp(escRegex(query), "i");
  }
  const sessions = await listSessions(agent);
  const maxHits = Number(args.limit) || 10;
  const hits: string[] = [];

  for (const rec of sessions) {
    if (hits.length >= maxHits) break;
    if (rx.test(rec.title)) {
      hits.push(`[${srcLabel(rec)}] ${shortId(rec)} ${rec.time} 标题: ${truncate(rec.title, 120)}`);
      continue;
    }
    const msgs = await readMessages(rec);
    const full = msgs.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.text}`).join("\n");
    const m = rx.exec(full);
    if (m) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(full.length, m.index + m[0].length + 60);
      const snippet = full.slice(start, end).replace(/\n/g, " ");
      hits.push(`[${srcLabel(rec)}] ${shortId(rec)} ${rec.time} …${snippet}…`);
    }
  }

  if (!hits.length) return `未找到匹配 “${query}” 的会话${agent === "all" ? "" : ` (${agent})`}。`;
  return `搜索 “${query}” 命中 ${hits.length} 个会话（展示前 ${Math.min(maxHits, hits.length)}）:\n\n` + hits.join("\n");
}

async function main() {
  const server = new Server(
    { name: "agent-sessions", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_agent_sessions",
        description:
          "列出本机所有智能体会话（claude: ~/.claude/projects/**，codex: ~/.codex/sessions + archived）。返回短ID/来源(C=claude,X=codex)/标题/时间/项目路径/归档状态。可传 agent 过滤。",
        inputSchema: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              description: "可选：过滤来源，claude / codex，缺省列出全部",
            },
          },
        },
      },
      {
        name: "read_agent_session",
        description:
          "查看指定会话的对话内容（用户/助手消息，自动跳过系统注入上下文）。id 支持短ID前缀匹配（如 read_agent_session 79b26d95）。可选 agent 限定来源。detail=true 时额外展示 AI 的工具动作摘要：编辑/写入了哪些文件、执行了什么命令及结果（含 Claude Code 与 Codex）。max_messages/max_msg_len 限制长度。",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "会话 ID 或前缀",
            },
            agent: {
              type: "string",
              description: "可选：限定来源 claude/codex，加速定位",
            },
            detail: {
              type: "boolean",
              description: "可选：true 时含工具动作摘要（文件改动/命令及输出）；缺省只显示纯对话文字",
            },
            max_messages: {
              type: "integer",
              description: `可选：最多返回消息条数（默认 ${DEFAULT_MAX_MSGS}）`,
            },
            max_msg_len: {
              type: "integer",
              description: `可选：单条消息截断长度（默认 ${DEFAULT_MAX_MSG_LEN}）`,
            },
          },
          required: ["id"],
        },
      },
      {
        name: "search_agent_sessions",
        description:
          "按关键词/正则搜索所有智能体会话(claude+codex)的标题与内容，返回命中的会话及上下文片段。适合找回忘记在哪次会话做的事。可传 agent 限定范围。",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词（支持正则；非法正则会作为普通文本匹配）",
            },
            agent: {
              type: "string",
              description: "可选：限定来源 claude/codex",
            },
            limit: {
              type: "integer",
              description: "可选：最多返回命中条数（默认 10）",
            },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      let text: string;
      switch (name) {
        case "list_agent_sessions":
          text = await listTool(args);
          break;
        case "read_agent_session":
          text = await readTool(args);
          break;
        case "search_agent_sessions":
          text = await searchTool(args);
          break;
        default:
          text = `未知工具: ${name}`;
      }
      return { content: [{ type: "text", text }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `错误: ${e.message}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
