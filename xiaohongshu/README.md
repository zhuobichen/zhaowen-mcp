# xiaohongshu MCP

小红书 MCP：代理本机跑着的小红书引擎，并在**发出去之前**把关标题字数、`#话题`、图片路径。

> **先读这一条：引擎不是本服务的一部分。**
> 小红书的登录与发布靠浏览器自动化，那部分由上游项目提供（它们**本身就是 MCP 服务**）。
> 本服务只做"代理 + 把关"，所以你要自己起一个引擎，否则所有工具都会告诉你连不上。

## 前置：起一个引擎

两个都能接，但**工具集不一样**——下面是实测结果（照 xpzouying 的 `mcp_server.go`、main 分支核对过），
不是"应该一样"的推测：

| 本服务的工具 | 依赖的上游工具 | xpzouying 版 | vmxmy 版 |
|---|---|---|---|
| `xhs_status` / `xhs_login_qrcode` / `xhs_publish_note` / `xhs_search` / `xhs_get_note` | `check_login_status` / `get_login_qrcode` / `publish_content` / `search_feeds` / `get_feed_detail` | ✓ | ✓ |
| `xhs_save_draft` | `save_draft` | **✗ 没有** | ✓ |
| `xhs_my_feeds` | `get_my_feeds` | **✗ 没有** | ✓ |
| `xhs_delete_note` | `delete_feed` | **✗ 没有** | ✓ |

连上之后先跑 `xhs_status`，它会**按你实际连的那个引擎**把这张表打出来；缺工具的调用会明确
告诉你"这个引擎没有提供 X"，并列出它有哪些，而不是把上游的 `unknown tool` 抛给你。
两个引擎都装也行（端口冲突就改一个）。

| 引擎 | 起法 | 地址 |
|------|------|------|
| [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)（原始版，Go，1.6 万 star，Apache-2.0） | `docker compose up -d` 或下二进制直接跑 | `http://localhost:18060/mcp` |
| [vmxmy/xiaohongshu-mcp](https://github.com/vmxmy/xiaohongshu-mcp)（Go，带 REST + Swagger） | `docker compose up -d` | `http://localhost:18060/mcp` |

起来之后第一次要登录：调 `xhs_login_qrcode` 拿二维码（会落成 PNG 并作为图片返回），用小红书 App 扫码。

> ⚠️ 同一个账号**不要在别的网页端同时登录**，会把这里的登录踢掉（用 App 看不受影响）。
> 上游作者说原项目稳定跑了一年多、没出现过封号，只有 Cookie 过期要重新登录。

## 工具

| 工具 | 功能 |
|------|------|
| `xhs_status()` | 引擎是否可达 + 是否已登录 + 引擎提供哪些工具。**排错第一步** |
| `xhs_login_qrcode()` | 取登录二维码，落成 PNG 并作为图片返回 |
| `xhs_publish_note(title, content, images, tags?, location?, dry_run?)` | **发布**图文笔记。建议先 `dry_run=true` 看一遍 |
| `xhs_save_draft(title, content, images, tags?, location?)` | 存草稿（不公开） |
| `xhs_search(keyword, limit?)` | 搜索公开笔记（只读） |
| `xhs_my_feeds(limit?)` | 我发布过的笔记（只读） |
| `xhs_get_note(feed_id, xsec_token?)` | 笔记详情与评论（只读） |
| `xhs_delete_note(feed_id, confirm)` | 删除我的笔记，必须 `confirm=true` |
| `xhs_raw(tool, args, confirm?)` | 直通引擎的任意工具（上游共 25 个）。改线上状态的必须 `confirm=true` |

## 这一层加的到底是什么

上游的 `publish_content` 是"照单全收"的——标题多长、正文里混没混 `#话题`、图片路径在不在，它都不管，失败了才由平台回错。本服务在发出去之前拦住：

| 把关 | 行为 |
|------|------|
| 标题 | 超 20 字直接报错，并回显**截到上限的样子**，不浪费一次发布 |
| `#话题` | 正文里写的 `#数学建模` 会**自动搬到 `tags` 参数**（上游明确要求正文不带标签，否则话题不生效——人和模型都极容易写错这一条） |
| 图片 | 本地路径逐个校验存在性与扩展名；网络图透传 |
| 正文长度 | 超约 1000 字**提醒**（不硬拦——各端上限不一且变过，硬拦会把能发的内容挡在外面） |
| markdown 残留 | 检测 `**加粗**` / `## 标题` / `` `代码` `` / `~~删除线~~` / `[文字](链接)` / `- 列表` 并提醒：**小红书正文不渲染 markdown**，会原样显示成符号 |
| 引擎没起 | 给人话（含 `docker compose up -d`），不是 `ECONNREFUSED` 堆栈 |
| 不可逆操作 | 发布可先 `dry_run`；删除、透传改状态类工具都要显式 `confirm=true` |

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|------|------|------|
| `XHS_ENGINE_URL` | `http://localhost:18060/mcp` | 引擎的 MCP 端点 |
| `XHS_TIMEOUT_MS` | `180000` | 单次调用超时（发布要传图，给得比较宽） |
| `XHS_QR_DIR` | 系统临时目录 | 二维码 PNG 的落盘目录 |

## 注册示例（`~/.claude.json` 顶层 `mcpServers`）

```json
"xiaohongshu": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/xiaohongshu/node_modules/tsx/dist/cli.mjs", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/xiaohongshu/index.ts"],
  "env": {
    "XHS_ENGINE_URL": "http://localhost:18060/mcp"
  }
}
```

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # 起一个假引擎，把整条链路验一遍（26 项断言）
```

`selftest.mjs` 用一个**假引擎**（同协议的 MCP over HTTP）驱动本服务，逐条断言：
dry_run 不发布、超长标题/缺图被拦住且没有发出任何发布请求、正文里的 `#话题` 确实被搬到
`tags`、二维码 PNG 字节正确、确认闸门生效、引擎连不上时给人话。

## 已知局限

- **发布超时不要盲目重试**：`publish_content` 在引擎侧要跑几十秒（上传图片、填表、点发布）。
  客户端等超时的时候，**引擎那边很可能已经把笔记发出去了**——这时重试会产生**重复笔记**。
  本服务遇到超时会直接说明这一点、并且**不再自动重试**（有专门的测试守着这条）。
  真踩过：一次 60 秒超时的重试，发出了两条一模一样的笔记。引擎那版没有删除工具，
  重复的只能去 App 的「创作中心 → 笔记管理」手动删。

- **`location` 只有部分引擎支持**：xpzouying 版的 `publish_content` 参数是
  `title / content / images / tags / schedule_at / is_original / visibility / products`，
  **没有 `location`**（vmxmy 版有）。不填就不会传，填了在 xpzouying 版上可能被忽略或报错。
  同理，需要 `schedule_at`（定时发布）、`is_original`、`products` 这些参数时，用 `xhs_raw` 直接调。

- **真实发布这一步没有自动化验证**：需要你的账号扫码登录，测试环境里验不了。
  上面验的是代理链路与参数把关，不是"发出去一定成功"。
- 引擎是浏览器自动化，小红书前端改版就可能失效——那是上游的事，本服务跟着上游的工具名走；
  上游改名就要跟着改（`xhs_raw` 直通，先 `xhs_status` 看当前工具名）。
- 话题名用"非空白非标点"切分，`#` 后紧跟标点会被截断；正文里 `#` 号如果不是当话题用的，
  会被误当成话题搬走（回显里会列出来，发之前看一眼即可）。
- 纯文字笔记（不传图）上游不一定支持，只给提醒不拦——真要发请先确认引擎版本。

## License

MIT
