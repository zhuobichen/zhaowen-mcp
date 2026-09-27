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
| `list_my_forums` | 我关注的贴吧列表（等级/经验/今日是否签到）。需 `TIEBA_BDUSS`。**这是贴吧唯一开放给自动化的登录接口** |

## 贴吧：为什么只有热榜

**结论：贴吧有反自动化层，纯 API 路线读不到实质内容。** 2026-09-26 实测，过程记录如下。

### 唯一能用的两个接口

| 接口 | 给什么 | 要 cookie 吗 |
|---|---|---|
| `tieba.baidu.com/hottopic/browse/topicList` | 热榜（本服务已实现） | 不要 |
| `tieba.baidu.com/mo/q/newmoindex` | 登录态（uid / tbs）+ **我关注的吧列表**（含各吧等级） | 要 BDUSS |

`newmoindex` 是唯一可用的 JSON 接口，而且 `kw` 参数被忽略（带不带返回一样）。

### 其余全部拿不到

```
吧帖子列表  /f?kw=xxx              403
移动端吧页  /mo/q/m?kw=xxx         403
帖子内容    /p/<id>                403
吧内搜索    /f/search/res          403
客户端接口  /c/f/frs/page          200 但 error_code 110001（要请求签名）
```

### 根因：百度安全验证

带**有效 BDUSS** 访问吧页面时，会从 403 变成 302，跟随跳转后落到：

```html
<title>百度安全验证</title>
```

**这是反爬拦截，不是登录态问题。** 排查过程：

| cookie 组合 | 结果 |
|---|---|
| 无 cookie | 403 |
| 仅 `BDUSS` | 403 |
| `BDUSS` + `BAIDUID` | 302 → 跟随后 403「百度安全验证」 |

所以 403 不是"没登录"，是"检测到不是真浏览器"。补 `BAIDUID`/`STOKEN`/`BDUSS_BFESS` 都只能把 403 变成 302，最终仍被安全验证拦下。

### 要读吧内容只有两条路

1. **浏览器自动化**（像 `xiaohongshu/` 那套，真浏览器 + 真 profile）—— 工作量大
2. **`tieba-claw`**（社区里的 Agent Skill，用 `TB_TOKEN` 而非 BDUSS，是另一条鉴权路径）—— 未验证

纯 HTTP 这条路**走不通**，别在这上面花时间了。

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
