# agent-sessions — 查看本机智能体会话的 MCP 工具

只读查看本机所有智能体会话：**Claude Code**（`~/.claude/projects/**`）与 **Codex**（`~/.codex/sessions` + `archived_sessions`）。
供 Claude Code 等 MCP 客户端调用，用于找回「之前某次会话做过什么 / 某项目下聊过什么」。

## 功能

| 工具 | 说明 |
|---|---|
| `list_agent_sessions` | 列出全部会话（来源 C/X · 短ID · 标题 · 时间 · 项目路径 · 归档状态），可 `agent` 过滤 |
| `read_agent_session` | 按会话 ID（支持短前缀）查看对话；`detail=true` 追加 AI 的工具动作摘要（改了哪些文件/跑了什么命令及输出），`agent`/`max_messages`/`max_msg_len` 可配 |
| `search_agent_sessions` | 按关键词/正则搜索会话标题与内容，返回命中片段，可 `agent` 限定 |
| `agent_token_usage` | 各会话 token 用量（total/input/cache/output），可 `agent`/`limit`；`money=true` 时按 gpt-5.6-sol 估算 Codex 费用 |
| `session_insights` | 会话洞察聚合（数据层）：指定范围（agent/project/days/limit）内每会话的结构化特征 + 聚合统计，供调用方模型归纳总结与建议（让 Codex 也有近似 /insights 的复盘能力） |

### token 用量口径说明

- **Codex**：每会话取 rollout 内**最后一条累计**，兼容两种格式（新会话 `token_usage_record` 的 `thread_token_usage`；老会话/compact 的 `event_msg` → `payload.info.total_token_usage`）。同 session 多 rollout 文件自动合并。`input_tokens` 已含缓存命中，计费时「非缓存 input = input − cache」。
- **Claude**：累加每条 `assistant` 消息的 `message.usage`，可按 `message.model`（deepseek-v4-flash / deepseek-v4-pro）细分。
- **费用（`money=true`，仅 Codex）**：按 gpt-5.6-sol 估算 —— output $62.1/M（one-hub 实测）；input $31.1、cache-read $7.8 为按比例估（非实测）。Claude 不计钱（用户指定只算 Codex）。
- 官方全量估算结论：46/60 会话有 token 记录，合计 ~44.6 亿 token，按官方公开价约 $1,178 / ¥8,600（主要成本在 gpt-5.6-terra；vision-exp 虽 token 最多但 96% 为缓存、成本低）。
- 示例：`agent_token_usage agent=codex money=true limit=10`

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

### session_insights 与 /insights

Claude Code 内置 `/insights` 的实质 = 读 `~/.claude/projects` 会话日志 → 提取结构化特征 → 由模型归纳总结与建议，最后产出 HTML 报告。它**只读 Claude Code 会话**。

`session_insights` 把这个「数据采集层」暴露成 MCP 工具，且**对 Codex 会话同样生效**（本工具能读 `~/.codex` rollout）—— 因此让 Codex 也能获得近似 `/insights` 的复盘能力：

```
session_insights agent=codex project=DataFusion days=30 limit=20
# → 返回结构化材料，调用方模型据此生成总结/建议
```

数据聚合设计（对应 /insights 的 Collect→Extract→Summarize→Aggregate），工具给出**原始特征**（每会话项目/时间/标题/消息数/工具使用/token/跨度 + 项目分布聚合），**不做语义判断**；主题分类、摩擦点、改进建议由调用方 LLM 完成（与 /insights 同构）。注意：标题可能很长，工具使用只统计会话前部事件。

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

## 生成 /insights 同款的 Codex 复盘报告

数据层 → LLM 标注 → HTML 报告两段式（源码 `insights.ts` / `annotate.ts` / `gen_report.ts`）：

```bash
# 1. 逐会话语义标注（调 one-hub deepseek-v4-flash，输出 reports/facets/*.json，已存在则跳过=可缓存）
node E:/CodeProject/node_modules/tsx/dist/cli.mjs annotate.ts

# 2. 生成报告（复用官方 /insights 浅色版式；数据 + facets 自动聚合，非手写文案）
node E:/CodeProject/node_modules/tsx/dist/cli.mjs gen_report.ts
#    → 输出 reports/codex_report.html
```

- `annotate.ts` 标注约 20+ 个主要 Codex 会话：目标/会话类型/满意度/摩擦点/总结，key 从 `~/.claude.json` 的 code-review env 自动读取（或环境变量 `REVIEW_API_KEY`）。成本 ≈ 几分钱级（flash 档）。
- `gen_report.ts` 含：硬统计图（token/语言/文件/命令失败/工具）+ facets 图（会话类型/Outcome/满意度/摩擦）+ 亮点/问题/可复制建议（friction 与 brief_summary 驱动）。
- 生成物 `reports/` 不入 git。
