# bilibili MCP

B站视频信息、搜索、热门、评论读取，加上一整套「我的」个人数据（收藏夹、关注、粉丝、历史、稍后再看）。

## 工具（26 个）

### 读 · 视频
| 工具 | 免登录 | 说明 |
|---|---|---|
| `get_video` | ✅ | 视频详情（标题/UP主/时长/四类计数） |
| `get_parts` | ✅ | 分P列表（多P视频的每一集 + cid） |
| `get_subtitles` | ✅ | **字幕全文**（带时间戳）。知识区视频可抽出全文喂给 AI |
| `get_related` | ✅ | 相关推荐 |
| `get_comments` | ✅ | 视频评论 |

### 读 · 发现
| 工具 | 免登录 | 说明 |
|---|---|---|
| `search_videos` | ✅ | 搜索视频 |
| `list_popular` | ✅ | 热门榜 |
| `get_ranking` | ✅ | 排行榜（`rid` 分区，0=全站） |
| `list_weekly` | ✅ | 每周必看（**需 wbi 签名**，见下） |
| `get_user_stat` | ✅ | 任意用户的关注/粉丝/获赞数 |

### 读 · 我的
| 工具 | 说明 |
|---|---|
| `check_login` | 登录态：昵称 / mid / 会员。**报权限错误时先调这个** |
| `list_fav_folders` | 我的收藏夹（实测 53 个） |
| `list_favorites` | 收藏夹内容，`media_id` 从上一个拿 |
| `list_followings` / `list_fans` | 我的关注 / 粉丝 |
| `get_history` | 观看历史（含看到百分之几） |
| `list_toview` | 稍后再看 |
| `get_watch_time` | **按天统计观看时长（估算）**，见下 |
| `list_msg_replies` | 消息：回复我的 / @我的 / 收到的赞 |
| `get_my_top_content` | **我被点赞最多的内容排行**（带锚点直链） |
| `get_user_videos` | 任意 UP 主的投稿 |

### 写（都需 `bili_jct`）
| 工具 | 副作用 |
|---|---|
| `like_video` | 点赞/取消 |
| `follow_user` | ⚠️ 对方收到通知 |
| `favorite_video` | 收藏/取消（可选收藏夹） |
| `coin_video` | ⚠️ **花真硬币** |
| `post_comment` | ⚠️ **不可逆的公开动作** |

个人向工具的 `mid` **不传就自动用当前登录账号**。

## 实测边界（2026-09-26，本机网络）

| 能力 | 免登录？ | 说明 |
|---|---|---|
| 视频信息 `x/web-interface/view` | ✅ | |
| 搜索 `x/web-interface/search/type` | ✅ | 但见下面 Referer 那条 |
| 热门 `x/web-interface/popular` | ✅ | |
| 评论 `x/v2/reply` | ✅ | |
| 热搜 | ✅ | 已实现在 hot-trending 服务里 |
| 用户投稿 `x/space/wbi/arc/search` | ❌ | 需 cookie **且要 wbi 签名**，见下 |
| 点赞 `archive/like` | ❌ | 需 `SESSDATA` + `bili_jct` |

### 用户投稿接口的三个必要条件（少一个都不行）

2026-09-26 实测，逐个排除出来的：

| cookie | wbi 签名 | Referer | 结果 |
|---|---|---|---|
| 有 | ✗ | `space.bilibili.com/<mid>` | `-403 访问权限不足` |
| 有 | ✓ | `space.bilibili.com/<mid>` | `412` |
| 有 | ✓ | **`www.bilibili.com`** | **`code=0` ✓** |

**Referer 又一次是决定性的，而且又是反直觉的那一个** —— 访问用户空间，
`www.bilibili.com` 能过、`space.bilibili.com` 反而不行。跟搜索接口的规律一致。
`sources.ts` 里统一用 `www.bilibili.com` 做 Referer，所以不用额外处理。

## 两个必须知道的坑

### 1. Referer 是硬门槛，而且反直觉

搜索接口用 `https://www.bilibili.com/` 做 Referer **能过**，
用 `https://search.bilibili.com/` 反而 **412**。实测如此，别凭直觉改。

### 2. WAF 会抖动

同一个请求、同样的 header，第一次 412 第二次 200 是常态。
所以 `sources.ts` 里所有请求都走 `requestJson()`，内置 3 次退避重试 ——
**别把单次 412 当结论**，我第一次探测就被这个骗过一次。

## 另外两个踩过的坑

### 每周必看的两个接口分工不同

```
series/list  → 只给期号和主题（{number:392, subject:"宏大交响琵琶曲"}），不含视频
series/one   → 给视频列表，但必须带 wbi 签名，不带恒 -352 风控
```

所以流程是「list 拿期号 → 签名后请求 one」。一开始我只调 `one`，一直 -352，
误判成"接口被封"，其实只是缺签名。

### 字幕是两步，且很多视频有 AI 字幕

字幕不在 `get_video` 里，要单独走两步：
1. `x/player/wbi/v2`（**需 wbi 签名**）拿字幕轨列表
2. 再去 `aisubtitle.hdslb.com` 下载那个 JSON（URL 是 `//` 开头的协议相对地址）

**实测发现**：一些看起来"没有字幕"的视频其实有 **AI 生成字幕**（`ai-zh`）。
比如那个 LLM 科普视频第一次探测是 0 条轨道，之后就有了 352 段。
所以抽不到时值得过一会儿再试 —— 别急着下"这视频没字幕"的结论。

## WBI 签名

B站从 2023 起给一批接口加了 wbi 签名。密钥来自 `nav` 接口的 `wbi_img`，
**实测未登录（isLogin:false）也会返回**，所以签名本身不需要用户 cookie。
`wbi.ts` 实现了完整算法（mixinKeyEncTab 重排 + md5），带 30 分钟缓存。

不过实测下来，**搜索接口其实不带签名也能过**（Referer 对了就行）；
签名是留着给那些确实要它的接口用的。

## Cookie 怎么配（可选）

只需要看热门/搜索/评论的话，**不用配任何 cookie**。

要看用户投稿或点赞，浏览器登录 B站 → F12 → Application → Cookies →
复制含 `SESSDATA` 和 `bili_jct` 的整条 Cookie，设成环境变量：

```bash
setx BILI_COOKIE "SESSDATA=xxx; bili_jct=yyy; ..."
```

⚠️ `SESSDATA` 等价于账号密码，**别写进会提交到公开仓库的文件**。

## 启动

```bash
npx tsx zhaowen-mcp/bilibili/index.ts
```
