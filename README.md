# ZhaoWen 自用的 MCP 服务集合

个人自用的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务集合，供 Claude Code 等 MCP 客户端调用。

## 包含的服务

| 目录 | 服务 | 功能 |
|------|------|------|
| [`xiaohongshu/`](./xiaohongshu) | 小红书发布（代理本机引擎） | `xhs_status` 引擎/登录状态/工具可用性 · `xhs_login_qrcode` 扫码登录 · `xhs_publish_note` 发布图文（标题字数/`#话题`/图片路径/正文长度/markdown 残留把关，支持 dry_run） · `xhs_save_draft` 存草稿 · `xhs_search`/`xhs_my_feeds`/`xhs_get_note` 只读查询 · `xhs_delete_note` 删除（需 confirm） · `xhs_raw` 直通引擎 |
| [`codex-models/`](./codex-models) | Codex 模型配置管理 | `list_models` 列出 · `list_available` 查未配置 · `add_model` 新增(自动模板+备份) · `set_model` 切换 · `remove_model` 删除 |
| [`memory-push/`](./memory-push) | 零散文档 → MEMORY 知识库 | `list_docs` 列出仓库结构 · `publish_doc` 推送本地文档/目录到 MEMORY(支持 dry_run) |
| [`image-vision/`](./image-vision) | 识图 + 生图 | `describe_image` 识图 · `generate_image` 生图 · `check_vision_status` |
| [`minimax-video-mcp/`](./minimax-video-mcp) | 生视频 | `submit_video` 提交 · `query_video` 查询 · `download_video` 下载 |
| [`skill-manager/`](./skill-manager) | skill/MCP 盘点 + 校验 + 一键发布 GitHub | `list_skills` 盘点 · `validate_skill` Skill 校验 · `validate_mcp` MCP 校验 · `check_sensitive` 敏感检测 · `publish_skill` 发布 Skill · `publish_mcp` 发布 MCP · `sync_self` 同步自身 · `get_config` |
| [`code-review/`](./code-review) | 代码审阅 | `review_file` 审阅文件 · `review_diff` 审阅 diff · `check_review_status` |
| [`file-manager/`](./file-manager) | 本地 + SSH 文件管理 | `exec` 执行 · `upload/download` 传输 · `bind` 绑服务器 · 共享/审计等 25 工具 |
| [`onehub-monitor/`](./onehub-monitor) | one-hub 用量监测 | `check_usage` 用量 · `daily_snapshot` 每日记账 · `usage_history` 历史 |
| [`easy-log/`](./easy-log) | 工作日志 + 发票填报 | 远程 MCP 工具 · `scenarios/` 场景手册 · `scripts/invoice_api.py` CLI |
| [`agent-sessions/`](./agent-sessions) | 查看本机智能体会话(Claude Code + Codex) | `list_agent_sessions` 列出 · `read_agent_session` 查看(`detail=true` 含代码改动/命令摘要) · `search_agent_sessions` 搜索 · `agent_token_usage` token/费用统计 · `session_insights` 洞察 · `annotate` LLM 逐会话语义标注(facets) · `gen_report` 生成 /insights 同款 HTML |
| [`other-projects/`](./other-projects) | 帮别人做的任务 → Other_Projects 仓库 | `list_projects` 列出现有项目 · `publish_project` 发布本地任务目录并 push（支持 dry_run） |
| [`aram-mayhem/`](./aram-mayhem) | 英雄联盟「海克斯大乱斗」助手 | `search_augments` 符文搜索 · `get_augment` 符文详情（官方原文说明+国服/全球两套胜率） · `list_synergy_sets`/`analyze_synergy` 羁绊与推算 · `get_champion_guide` 英雄推荐（含陷阱符文） · `compare_patches` 版本对比 · `refresh_data` 刷新 · `get_my_account_status`/`get_my_recent_games`/`analyze_my_augments` 绑定国服账号看最近对局 |
| [`hot-trending/`](./hot-trending) | 中文平台热榜聚合 | `list_boards` 列出平台（含各自是否需登录） · `get_hot` 取热榜：B站/微博/贴吧**免登录**，知乎需 `ZHIHU_COOKIE`（其热榜接口免登录恒 401，实测无解） |
| [`bilibili/`](./bilibili) | B站 数据（只读为主 + 写操作） | **读**：`get_video` 详情 · `get_subtitles` **字幕全文**（知识区视频可抽全文喂模型） · `get_parts` 分P · `get_related` 相关推荐 · `search_videos`/`list_popular`/`get_ranking`/`list_weekly`/`get_user_stat` 搜索与榜单 · `get_comments` 评论 · `check_login` 登录态 · `list_fav_folders`/`list_favorites` 收藏夹 · `list_followings`/`list_fans` 关注与粉丝 · `get_history`/`list_toview`/`get_watch_time` 观看记录与时长 · `list_msg_replies`/`get_my_top_content` 消息与被赞排行 · `get_user_videos` UP主投稿　**写**（需 cookie 含 `bili_jct`）：`like_video`/`follow_user`/`favorite_video`/`coin_video`/`post_comment` |

## 隐私说明

- 本仓库**不包含任何 API Key、密钥或个人中转站地址**。
- 所有服务均通过**环境变量**配置，使用前请自行填写各自的 API 凭据。
- 各服务的配置方式见各自目录下的 `README.md`。

机器可读服务清单见 [`mcp-catalog.json`](./mcp-catalog.json)。发布或新增服务前，可用 `skill-manager` 的 `validate_mcp` 做只读结构检查，再进行敏感扫描和 dry-run。

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

# 中文平台热榜（免登录）
cd hot-trending && npm install

# B站数据（只读免登录；写操作需 BILI_COOKIE）
cd bilibili && npm install
```

## License

MIT

## 维护与校验

### 加/删服务后必跑：一致性检查

```bash
node scripts/check-consistency.mjs
```

它比对**三处**清单：`README.md` 服务表 ↔ `mcp-catalog.json` ↔ 实际目录。
不一致时退出码非 0。

> **为什么需要它**：2026-09-26 加 `hot-trending` 和 `bilibili` 时，catalog 更新了
> 但 README 服务表忘了改，两边差了 2 个，过了一天才发现。漏更新不是能力问题，
> 是没有检查 —— 这个脚本就是那个检查。

已知的非标准项：`easy-log` 没有 `entrypoint`（它是 SKILL + 脚本，不是标准 MCP 服务），
脚本会提示但不算失败。

### 结构校验与发布前检查

`skill-manager` 提供 Skill 目录校验和发布前检查。修改后可运行：

```bash
cd skill-manager
npm install
npm run typecheck
npm test
npm audit
```
