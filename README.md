# ZhaoWen 自用的 MCP 服务集合

个人自用的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务集合，供 Claude Code 等 MCP 客户端调用。

## 包含的服务

| 目录 | 服务 | 功能 |
|------|------|------|
| [`image-vision/`](./image-vision) | 识图 + 生图 | `describe_image` 识图 · `generate_image` 生图 · `check_vision_status` |
| [`minimax-video-mcp/`](./minimax-video-mcp) | 生视频 | `submit_video` 提交 · `query_video` 查询 · `download_video` 下载 |
| [`skill-manager/`](./skill-manager) | skill/MCP 盘点 + 一键发布 GitHub | `list_skills` 盘点 · `check_sensitive` 敏感检测 · `publish_skill` 发布 skill · `publish_mcp` 发布 MCP · `sync_self` 同步自身 · `get_config` |
| [`code-review/`](./code-review) | 代码审阅 | `review_file` 审阅文件 · `review_diff` 审阅 diff · `check_review_status` |
| [`file-manager/`](./file-manager) | 本地 + SSH 文件管理 | `exec` 执行 · `upload/download` 传输 · `bind` 绑服务器 · 共享/审计等 25 工具 |
| [`onehub-monitor/`](./onehub-monitor) | one-hub 用量监测 | `check_usage` 用量 · `daily_snapshot` 每日记账 · `usage_history` 历史 |
| [`easy-log/`](./easy-log) | 工作日志 + 发票填报 | 远程 MCP 工具 · `scenarios/` 场景手册 · `scripts/invoice_api.py` CLI |
| [`agent-sessions/`](./agent-sessions) | 查看本机智能体会话(Claude Code + Codex) | `list_agent_sessions` 列出 · `read_agent_session` 查看(`detail=true` 含代码改动/命令摘要) · `search_agent_sessions` 搜索 · `agent_token_usage` token/费用统计 · `session_insights` 洞察 · `annotate` LLM 逐会话语义标注(facets) · `gen_report` 生成 /insights 同款 HTML |
| [`other-projects/`](./other-projects) | 帮别人做的任务 → Other_Projects 仓库 | `list_projects` 列出现有项目 · `publish_project` 发布本地任务目录并 push（支持 dry_run） |

## 隐私说明

- 本仓库**不包含任何 API Key、密钥或个人中转站地址**。
- 所有服务均通过**环境变量**配置，使用前请自行填写各自的 API 凭据。
- 各服务的配置方式见各自目录下的 `README.md`。

## 快速开始

每个服务相互独立，进入对应目录安装依赖并配置环境变量后即可运行：

```sh
# 识图 + 生图
cd image-vision && npm install

# 生视频（MiniMax H3）
cd minimax-video-mcp && npm install && npm run build

# skill 盘点 + 一键发布 GitHub
cd skill-manager && npm install

# 代码审阅
cd code-review && npm install

# 文件管理（本地 + SSH）
cd file-manager && npm install

# one-hub 用量监测
cd onehub-monitor && npm install
```

## License

MIT
