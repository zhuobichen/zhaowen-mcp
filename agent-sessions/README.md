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
| `annotate_sessions` | 对主要会话做 **LLM 语义标注**（facets）：逐会话判断目标/类型/满意度/摩擦点/成功点，落盘 `reports/facets/<agent>/<id>.json`。**增量**（已存在则跳过）；⚠ **会消耗 one-hub 额度** —— 先用 `dry_run=true` 看会标几个再用 `limit` 正式跑 |
| `generate_session_report` | 生成 **会话洞察报告**（HTML/Markdown，复刻 `/insights` 版式）：硬统计图 + facets 聚合图 + 亮点/问题/可复制建议。**纯本地、不联网、不花钱**；依赖 `annotate_sessions` 的 facets（没有也能出，相关段落降级） |

### token 用量口径说明

- **Codex**：每会话取 rollout 内**最后一条累计**，兼容两种格式（新会话 `token_usage_record` 的 `thread_token_usage`；老会话/compact 的 `event_msg` → `payload.info.total_token_usage`）。同 session 多 rollout 文件自动合并。`input_tokens` 已含缓存命中，计费时「非缓存 input = input − cache」。
- **Claude**：累加每条 `assistant` 消息的 `message.usage`，可按 `message.model`（deepseek-v4-flash / deepseek-v4-pro）细分。
- **费用（`money=true`，仅 Codex）**：按 gpt-5.6-sol 估算 —— output $62.1/M（one-hub 实测）；input $31.1、cache-read $7.8 为按比例估（非实测）。Claude 不计钱（用户指定只算 Codex）。
- 官方全量估算结论：46/60 会话有 token 记录，合计 ~44.6 亿 token，按官方公开价约 $1,178 / ¥8,600（主要成本在 gpt-5.6-terra；vision-exp 虽 token 最多但 96% 为缓存、成本低）。
- 示例：`agent_token_usage agent=codex money=true limit=10`

- **不修改会话文件**：任何工具都不会写 `~/.claude/projects` 或 `~/.codex/sessions` 里的会话记录。
- **会写文件 / 会联网的两个工具**：`annotate_sessions` 会调 one-hub 的 `deepseek-v4-flash`（**花钱**）并写 `reports/facets/`；`generate_session_report` 只写 `reports/`（不联网）。其余 5 个工具只读。
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
├─ index.ts      MCP server 入口（7 个工具）
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
    "args": ["/c", "node", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/agent-sessions/node_modules/tsx/dist/cli.mjs", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/agent-sessions/index.ts"],
    "cwd": "E:\\CodeProject"
  }
}
```

依赖 tsx 与 @modelcontextprotocol/sdk，在**本目录** `npm install` 一次即可（各服务各自一份 `node_modules`，不共用）。

## 本地调试

```bash
cd D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/agent-sessions
node D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/agent-sessions/node_modules/tsx/dist/cli.mjs index.ts   # 起 stdio server
```

## 生成 /insights 同款的 Codex 复盘报告

数据层 → LLM 标注 → HTML 报告两段式（源码 `insights.ts` / `annotate.ts` / `gen_report.ts`）：

**推荐用 MCP 工具**（也就是 `annotate_sessions` 与 `generate_session_report`，参数与下面的 CLI 开关一一对应）；命令行则：

```bash
TSX=node_modules/tsx/dist/cli.mjs

# 1. 语义标注（调 one-hub deepseek-v4-flash → reports/facets/<agent>/<id>.json，已存在则跳过=增量）
node $TSX annotate.ts --agent codex          # 或 --agent claude
node $TSX annotate.ts --agent claude --dry-run   # 只盘点、不调模型、不花钱

# 2. 生成报告（复用官方 /insights 浅色版式；数据 + facets 自动聚合）
node $TSX gen_report.ts --agent codex        # → reports/codex_report.html
node $TSX gen_report.ts --agent claude --both # → reports/claude_report.html + .md
```

- `annotate.ts` 标注约 20+ 个主要会话：目标/会话类型/满意度/摩擦点/总结。key 从 `~/.claude.json` 的 code-review env 自动读取（或环境变量 `REVIEW_API_KEY`）。成本 ≈ 几分钱级（flash 档）。**facets 按 agent 分目录**（`reports/facets/codex/`、`reports/facets/claude/`），互不污染。
- `gen_report.ts` 含：硬统计图（token/语言/文件/命令失败/工具）+ facets 图（会话类型/Outcome/满意度/摩擦）+ 亮点/问题/可复制建议（friction 与 brief_summary 驱动）。开关：`--agent` / `--md` / `--both` / `--out`。
- **Claude 版的已知降级**（如实标注，不伪造）：`deep_insights.ts` 只认 Codex 的文件结构（`apply_patch` / `exec_command`），所以 **Claude 版不渲染「命令 / 文件增减 / 语言分布」**，改用 `insights.ts` 的工具计数；「使用方式」那段叙事原本是为 Codex 手写的，Claude 版改为中性措辞并**在页面上写明**。
- 两段都只用 `import.meta.url` 钉输出目录（不随 cwd 变）；`reports/` 不入 git（见 `.gitignore`）。
- `node mcp-smoke.mjs` 可跑协议层冒烟：起真进程 → 握手 → 7 个工具 → 生成两种报告 → annotate 只跑 dry_run。**它只走不花钱的路径。**
