# hot-trending MCP

中文平台热榜聚合：一次调用拿到 B站、微博、贴吧的热搜/热议榜。知乎需要 cookie。

## 实测结论（2026-09-26，本机网络）

| 平台 | 接口 | 免登录？ |
|---|---|---|
| B站 | `api.bilibili.com/x/web-interface/search/square` | ✅ |
| 微博 | `weibo.com/ajax/side/hotSearch` | ✅ |
| 贴吧 | `tieba.baidu.com/hottopic/browse/topicList` | ✅ |
| 知乎 | `api/v3/feed/topstory/hot-lists/total` | ❌ **401** |

知乎全部热榜接口都要求登录，连匿名 `d_c0` cookie 都不行。免登录的只剩
`api/v4/search/top_search`，而且实测**时好时坏**（同一请求一次返回 200 带数据，
下一次返回 `code 10003 请求参数异常`）。所以知乎被设计成"有 cookie 才可用"，
没配就返回明确的提示，而不是悄悄给个空列表。

## 工具

| 工具 | 说明 |
|---|---|
| `list_boards` | 列出支持的平台及各自是否需要登录 |
| `get_hot` | 取某平台热榜，参数 `board`（必填）、`limit`（默认 20） |

## 知乎 cookie 怎么配

浏览器登录知乎 → F12 → Application → Cookies → `www.zhihu.com` → 复制整条
Cookie 字符串（至少要有 `z_c0`），设成环境变量：

```bash
setx ZHIHU_COOKIE "z_c0=xxx; d_c0=yyy; ..."
```

写进 `~/.claude.json` 的 mcpServers `env` 块也行，但**那个文件不要提交到公开仓库**。

## 为什么都显式带 User-Agent 和 Referer

这几家都按 UA 拦。裸请求（比如 Python 默认的 urllib UA）会被 403 或返回空数据 ——
这不是权限问题，是"礼貌性伪装"没做。`sources.ts` 里每个请求都带齐了。

## 启动

```bash
npx tsx zhaowen-mcp/hot-trending/index.ts
```
