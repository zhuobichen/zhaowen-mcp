# ZhaoWen 自用的 MCP 服务集合

个人自用的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务集合，供 Claude Code 等 MCP 客户端调用。

## 包含的服务

| 目录 | 服务 | 功能 |
|------|------|------|
| [`ima-mcp/`](./ima-mcp) | 腾讯 ima 知识库 / 笔记 | `ima_search_knowledge_bases` 搜知识库 · `ima_list_knowledge`/`ima_search_knowledge` 查知识 · `ima_import_urls` 导入网页 · `ima_upload_file` 上传文件入库 · `ima_read_media` 读原文 · `ima_list_notebooks`/`ima_search_notes`/`ima_get_note_content` 笔记读写 |
| [`qqmail-mcp/`](./qqmail-mcp) | 只读查 QQ 邮箱（mail.qq.com） | `check_status` 配置与连通性 · `list_folders` 列文件夹 · `list_recent` 列最近邮件 · `search` 关键词搜索（**取头部本地过滤，不用 IMAP SEARCH**——QQ 对中文的 IMAP 搜索会安静返回空） · `read_message` 读正文与附件清单。**只读**：不发信/不删信/不改已读，且每个邮箱都以 `readOnly` 打开 |
| [`weather-mcp/`](./weather-mcp) | 逐小时天气（Open-Meteo，免 key） | `hourly_forecast` 逐小时气温/降水量/降水概率/风向风速 · `dry_windows` 找某天连续无雨的时间窗（判据为「降水≤阈值 **且** 概率≤阈值」，可调，默认对"不怕小雨"的人偏严） · `resolve_place` 地名转坐标 |
| [`meme-finder/`](./meme-finder) | 找表情包（GitHub 图集） | `search_packs` 按主题词搜仓库+扫巨型图集目录 · `list_pack` 列图并给出可直连链接(jsdelivr 改写) · `save_pack`/`list_saved`/`remove_saved` 本地清单登记与查找 · `fetch_pack` 下载到本地(如实报成败) |
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
| [`agent-sessions/`](./agent-sessions) | 查看本机智能体会话(Claude Code + Codex) | `list_agent_sessions` 列出 · `read_agent_session` 查看(`detail=true` 含代码改动/命令摘要) · `search_agent_sessions` 搜索 · `agent_token_usage` token/费用统计 · `session_insights` 洞察 · `annotate_sessions` LLM 逐会话语义标注(facets，**会消耗 one-hub 额度**，支持 `dry_run`) · `generate_session_report` 生成 /insights 同款 HTML/MD(**纯本地、不花钱**) |
| [`other-projects/`](./other-projects) | 帮别人做的任务 → Other_Projects 仓库 | `list_projects` 列出现有项目 · `publish_project` 发布本地任务目录并 push（支持 dry_run） |
| [`aram-mayhem/`](./aram-mayhem) | 英雄联盟「海克斯大乱斗」助手 | `search_augments` 符文搜索 · `get_augment` 符文详情（官方原文说明+国服/全球两套胜率） · `list_synergy_sets`/`analyze_synergy` 羁绊与推算 · `get_champion_guide` 英雄推荐（含陷阱符文） · `compare_patches` 版本对比 · `refresh_data` 刷新 · `get_my_account_status`/`get_my_recent_games`/`analyze_my_augments` 绑定国服账号看最近对局 |
| [`hot-trending/`](./hot-trending) | 中文平台热榜聚合 | `list_boards` 列出平台（含各自是否需登录） · `get_hot` 取热榜：B站/微博/贴吧**免登录**，知乎需 `ZHIHU_COOKIE`（其热榜接口免登录恒 401，实测无解） · `list_my_forums` 我关注的贴吧列表（需 `TIEBA_BDUSS`；**贴吧只有这一个接口开放给自动化**，其余被「百度安全验证」拦，原因见 hot-trending/README.md） |
| [`bilibili/`](./bilibili) | B站 数据（只读为主 + 写操作） | **读**：`get_video` 详情 · `get_subtitles` **字幕全文**（知识区视频可抽全文喂模型） · `get_parts` 分P · `get_related` 相关推荐 · `search_videos`/`list_popular`/`get_ranking`/`list_weekly`/`get_user_stat` 搜索与榜单 · `get_comments` 评论 · `check_login` 登录态 · `list_fav_folders`/`list_favorites` 收藏夹 · `list_followings`/`list_fans` 关注与粉丝 · `get_history`/`list_toview`/`get_watch_time` 观看记录与时长 · `list_msg_replies`/`get_my_top_content` 消息与被赞排行 · `get_user_videos` UP主投稿　**写**（需 cookie 含 `bili_jct`）：`like_video`/`follow_user`/`favorite_video`/`coin_video`/`post_comment` |
| [`jd-price/`](./jd-price) | 京东商品价格读取 | `get_item` 单个商品的名称/店铺/品牌/当前价 · `compare_items` 多件比价。**价格需 `JD_COOKIE`，且实测只需其中 `flash` 一个 cookie**（京东对未登录用户把价格打码成 `1??9`；社区文档里的 `pt_key`/`pt_pin` 在本机登录态里不存在，别照抄）。输入是 SKU 或商品链接 —— 京东搜索全线不通（403 / app 签名），纯 HTTP 拿不到。**没有历史价格** |

### 外部服务（非本仓库代码）

以下 MCP **来自第三方**，代码不在本仓库，通过 npm 包或远程 URL 接入。列在这里是为了让「我在用哪些 MCP」有一份完整记录 —— 一致性检查脚本会跳过它们的「本地目录」比对（catalog 里标了 `external: true`）。

| 服务 | 来源 | 用途 |
|------|------|------|
| `amap-maps` | [npm `@amap/amap-maps-mcp-server`](https://www.npmjs.com/package/@amap/amap-maps-mcp-server)（高德官方） | 地理编码/逆地理 · 关键词与周边 POI 搜索 · 距离测量 · 步行/骑行/驾车/**公交**路径规划 · IP 定位 · 天气。需 `AMAP_MAPS_API_KEY`，**平台类型必须选「Web服务」**（Web端 JS API 的 key 用不了）。也可用 Streamable HTTP 接入：`https://mcp.amap.com/mcp?key=<key>`，无需本地安装 |

#### `amap-maps` 实测踩坑（2026-10 补充）

官方文档没写、实际拿来量路线时踩出来的，按重要度排：

1. **同一个路名 → 多个候选点，选哪个总长能差 6 公里。** `maps_text_search` 对**一个名字**
   会返回多个**真在不同位置**的候选（实测：「广园中路」返回 **3 条同名路**；「广花一路」返回
   十几个「××与广花一路交叉口」；「广州大道南」路名 POI 与路口各一处）。同一批名字、
   只换候选点，一条骑行路线实测 **57.4 ~ 63.5 km（跨 6.1 km）**；某个点只挪 **490 m**
   就让总长 **+2.42 km**。
   ⚠️ **换的不只是公里数，是整条走法**——那 490 m 让第 2 段从「走主干道」变成「穿老城小街」。
   → **别人报的里程和你算的不一致时，先怀疑「点落在哪儿」**，别先怀疑交通方式
   （实测驾车模式反而可能比骑行还短，一步就能排除）。
2. **规划接口没有 waypoints 参数**：`maps_direction_*` 只收 origin/destination，
   要"经过某地"只能取一串点**逐段相加**。
3. **路点稀疏时规划器会静默抄近路**：它在两点之间自选认为最短的路，绕开你想走的那条，
   **不报错、只是给一条不同的路** → **必须逐段核对 `steps[].road`**，只看总距离会被骗。
   这也是第 1 条的来源。
4. **`maps_text_search` 只给 id、不给坐标** → 要坐标得再逐个调 `maps_search_detail`
   （它容易撞 `CUQPS_HAS_EXCEEDED_THE_LIMIT`，撞了这一批直接全失败）。
5. **POI 里有脏数据**：同名不同位、名字与位置矛盾 → 取到的点**先按位置合理性筛一遍**再拿去规划。
6. **路名不编码「有没有自行车道」**（`typecode 190301` 是"道路名"）：搜「绿道」实际是在查路名，
   有盲区——**别把搜索结果当"这条路能不能骑"的结论**。
7. **`maps_direction_bicycling` 的 duration = 距离 ÷ 15**，恒定速度，**不含任何路况/红绿灯**。
8. **轮渡会被当成一段路**：路线里出现 `typecode 150302`（车渡口）的 POI 就是要坐船过江；
   **通航时间看它的 `open_time`**（实测「新造渡口」06:00–20:00）——这直接决定行程能不能走。
9. **接口是确定性的**：同一条请求复测两轮**逐位相同** → 对不上就是选点/参数不同，不是接口抖动。
10. 偶发 `Direction bicycling failed: undefined` → **重发同一条请求即成功**，不是参数问题。

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
