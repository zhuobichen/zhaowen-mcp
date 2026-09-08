# agent-sessions — 查看本机智能体会话的 MCP 工具

只读查看本机所有智能体会话：**Claude Code**（`~/.claude/projects/**`）与 **Codex**（`~/.codex/sessions` + `archived_sessions`）。
供 Claude Code 等 MCP 客户端调用，用于找回「之前某次会话做过什么 / 某项目下聊过什么」。

## 功能

| 工具 | 说明 |
|---|---|
| `list_agent_sessions` | 列出全部会话（来源 C/X · 短ID · 标题 · 时间 · 项目路径 · 归档状态），可 `agent` 过滤 |
| `read_agent_session` | 按会话 ID（支持短前缀）查看对话；`detail=true` 追加 AI 的工具动作摘要（改了哪些文件/跑了什么命令及输出），`agent`/`max_messages`/`max_msg_len` 可配 |
| `search_agent_sessions` | 按关键词/正则搜索会话标题与内容，返回命中片段，可 `agent` 限定 |

- **只读**：绝不修改任何会话文件。
- **自动跳过系统注入**：Claude 的 system 上下文、Codex 的 `<environment_context>` / `<permissions>` / AGENTS.md 注入均不呈现，只保留真实 user ↔ assistant 对话。
- 解析逻辑复用 `~/.claude/skills/agent-dialog_management/scripts/agent_dialog.py` 的成熟实现；列表标题采用**流式早停**，即使 70MB 大文件也秒回。

### detail=true 工具摘要（Claude Code + Codex）

| 图标 | 含义 | 说明 |
|---|---|---|
| ✏️ 编辑 / 📝 写入 | 改了/写了文件 | 显示文件路径（末两段） |
| 📖 读取 | 读了文件 | 文件路径 |
| $ 执行 | 跑了命令 | 命令首行 + 输出首行摘要 |
| 🔍 检索 / 🛠 工具 | Glob/Grep/其它 | 目标简述 |

- 两端底层格式不同但已统一：Claude 读 content 块中 `tool_use`/`tool_result`；Codex 读 `response_item` 的 `function_call`/`custom_tool_call`/`apply_patch` 及其 `_output`（按 call_id 配对）。
- **摘要版只列动作 + 文件名/命令，不贴改动全文与完整输出**，避免刷屏。thinking 一律跳过。
- 示例：`read_agent_session 79b26d95 detail=true`

## 数据源

| 来源 | 位置 | 会话 ID |
|---|---|---|
| Claude Code | `~/.claude/projects/<编码项目目录>/<uuid>.jsonl` | uuid（文件名） |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`、`~/.codex/archived_sessions/*.jsonl` | meta.id |

## 目录结构

```
agent-sessions/
├─ index.ts      MCP server 入口（3 个工具）
├─ sessions.ts   只读解析模块（claude + codex 双数据源）
├─ package.json
└─ tsconfig.json
```

## 注册方式（全局 ~/.claude.json）

```json
"mcpServers": {
  "agent-sessions": {
    "type": "stdio",
    "command": "cmd",
    "args": ["/c", "node", "E:/CodeProject/node_modules/tsx/dist/cli.mjs", "E:/CodeProject/mcp-server/agent-sessions/index.ts"],
    "cwd": "E:\\CodeProject"
  }
}
```

依赖 tsx 与 @modelcontextprotocol/sdk（已装在 `E:/CodeProject/node_modules`），无需单独 npm install。

## 本地调试

```bash
cd E:/CodeProject/mcp-server/agent-sessions
node E:/CodeProject/node_modules/tsx/dist/cli.mjs index.ts   # 起 stdio server
```
