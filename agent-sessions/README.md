# agent-sessions — 查看本机智能体会话的 MCP 工具

只读查看本机所有智能体会话：**Claude Code**（`~/.claude/projects/**`）与 **Codex**（`~/.codex/sessions` + `archived_sessions`）。
供 Claude Code 等 MCP 客户端调用，用于找回「之前某次会话做过什么 / 某项目下聊过什么」。

## 功能

| 工具 | 说明 |
|---|---|
| `list_agent_sessions` | 列出全部会话（来源 C/X · 短ID · 标题 · 时间 · 项目路径 · 归档状态），可 `agent` 过滤 |
| `read_agent_session` | 按会话 ID（支持短前缀）查看对话；`detail=true` 追加 AI 的工具动作摘要（改了哪些文件/跑了什么命令及输出），`agent`/`max_messages`/`max_msg_len` 可配 |
| `search_agent_sessions` | 按关键词/正则搜索会话标题与内容，返回命中片段，可 `agent` 限定 |
| `agent_token_usage` | 各会话 token 用量（total/input/cache/output），可 `agent`/`limit`。Claude 按 model 细分；Codex 仅新版有记录。注：仅 token 数，无金额 |

### token 用量口径说明

- **Codex**：取 rollout 内 `token_usage_record` 的 `thread_token_usage`（会话累计，同 session 多文件自动合并相加）；仅新版会话写入（旧版/归档多无记录）。
- **Claude**：累加每条 `assistant` 消息的 `message.usage`；`input` 含 cache_read + cache_creation，并可按 `message.model`（如 deepseek-v4-flash / deepseek-v4-pro）细分。
- 无金额字段（rollout/会话文件只存 token 数）；如需美元费用需按各模型单价 × token 另算。

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
