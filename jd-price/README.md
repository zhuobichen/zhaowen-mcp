# jd-price MCP

读京东商品信息与**当前价**。输入是 SKU 或商品链接，不是关键词（原因见下）。

## 实测边界（2026-09-27，本机网络）

| 入口 | 结果 |
|---|---|
| `item.m.jd.com/product/<sku>.html` | **200 ✓** 返回真实商品数据 |
| `item.jd.com/<sku>.html`（桌面） | 200 但是通用页，无商品数据 |
| `search.jd.com/Search?keyword=` | 302 → 风控页 |
| `so.m.jd.com/ware/searchList.action` | 403 |
| `m.jd.com/search/search.html` | 200 但是 **JS 空壳**，无结果 |
| `api.m.jd.com/?functionId=search` | 200 但 `{"code":"1","echo":"no access"}` |
| `p.3.cn/prices/mgets`（经典价格 API） | 连不上 |
| `item-soa.jd.com/getWareBusiness` | 302 |

**结论：移动端商品页是唯一可用的入口**，所以 UA 必须是移动端（`constants.ts` 里写死了）。

## 价格必须登录 —— 这是业务策略，不是反爬

未登录时页面里是这样的：

```json
"jdPrice": "1??9"
"priceLoginText": "登录查看价格"
```

**京东把价格对未登录用户打码了。** 我一开始往"反检测"方向查了好几轮，方向是错的 ——
不是它认出了自动化，是它**本来就不给未登录的人看价格**。

未登录能拿到的：商品名、店铺、品牌
未登录拿不到：价格（打码成 `1??9`）

## Cookie 怎么配：只要一个 `flash`

**别去抄社区文档里的 `pt_key` / `pt_pin`** —— 本机实测的京东网页端登录态里
**根本没有这两个 cookie**，照抄那套会一直拿到 `1??9`，而且查不出原因。
（那套是很多年前的形态，网上到处在传。）

真正管用的是 **`flash`**，实测对照：

| 带的 cookie | `jdPrice` |
|---|---|
| 不带 | `"1??9"` |
| `_pst` + `thor` | `"1??9"` |
| `_pst` + `thor` + `pinId` + `_tp` | `"1??9"` |
| **`flash` 单独** | **`"1759.00"`** ✓ |

换 4 个 SKU 复验，全部解出真价（1759 / 4299 / 10099 / 3499）：

| SKU | 商品 | 价格 |
|---|---|---|
| 100012043978 | 茅台飞天 53%vol 500ml | ¥1759.00 |
| 100008348542 | iPhone 11 128GB | ¥4299.00 |
| 100016034372 | iPhone 12 Pro Max 256GB | ¥10099.00 |
| 100026667910 | iPhone 13 128GB | ¥3499.00 |

所以最省事的做法是**把整个 Cookie 头原样抄过来**（这样将来哪些 cookie 变得重要都不用管），
只填 `flash=...;` 也可以。

⚠️ **不要手敲、不要自己切片**。这些值是不透明长串，手抄极容易掉一个字符，
而症状会是"cookie 失效"这种误导性表现。原样复制。

⚠️ `priceLoginText` **即使已登录也照样是「登录查看价格」**（它是个静态文案），
不要拿它判断登录态 —— 要看 `jdPrice` 里有没有 `?`。

设成环境变量：

```bash
setx JD_COOKIE "flash=<你从浏览器复制的值>;"
```

⚠️ `flash` 等价于登录态，**别写进会提交到公开仓库的文件**。

## 没有「搜索」—— 但 SKU 有两条绕行路

按关键词搜商品，做不到：

- `so.m.jd.com/ware/searchList.action` → 403
- `api.m.jd.com` → `{"code":"1","echo":"no access"}`。它校验的是 **app 签名（h5st）**，
  补 `Origin`/`Referer` 没用（试过 `search.jd.com` 和 `www.jd.com`）。换对 appid
  （`search-pc-java`）后错误会变成 `does not exist`，但正确 functionId 在混淆 bundle 里翻不出来
- `search.jd.com` / `list.jd.com` → 200 但都是 React SPA（`isList` 标记 + `js_security_v3_0.1.6.js`），商品走签名接口
- `wq.jd.com`（微信/手Q 版）→ 403
- `m.jd.com/search` → 200 但是 JS 空壳

商品页里也**没有**「猜你喜欢」推荐位（只有自己的 SKU），邻近 SKU 号也不聚集
（实测围绕 `12275617451` 取 ±8 全空），所以**无法从一个 SKU 顺藤摸瓜**。

### 弄到 SKU 的可行办法

**① `yp.m.jd.com` 关键词聚合页（最好用，2026-09-27 破解）**

京东有个「优评」页：`https://yp.m.jd.com/<hash>.html`，按关键词聚合商品。
`<hash>` 的生成规则是：

```
hash = "6233" + md5(关键词, utf-8).hexdigest()[8:24]
```

（`6233` 是京东玩具类目号；md5 取第 8~24 个十六进制字符，共 16 位。）

**验证**：`md5("模型万代pg") = dc00ea08` **`d54ec7b24a67983d`** `1e24ba5f`
→ 拼出 `6233` + `d54ec7b24a67983d` = `6233d54ec7b24a67983d`，与真实 URL 完全一致。

所以**任意关键词都能自己算出来**。注意几点：

- 关键词要是**京东真实存在的搜索词**，否则 404。词序和大小写敏感 ——
  `模型万代pg` 有页面，`万代PG模型` 是 404；`高达模型pg` / `pg高达模型` 都有。
- 页面是**服务端渲染的真 HTML**，`item.m.jd.com/product/<SKU>.html` 直链和
  商品名都在里面（但**没有价格**，价格还得逐个走 `item.m.jd.com` 查）。
- 实测有页面的词：`模型万代pg`、`高达模型pg`（31 件）、`pg高达模型`（20）、
  `mg高达模型`（20）、`万代模型`（20）、`万代拼装模型`（20）、`万代pg独角兽`（7）、
  `卡版沙扎比`、`高MG达`、`万代强袭自由` 等。

**② 京东评价页 `club.jd.com/repay/<SKU>_<uuid>_1.html` 被搜索引擎收录**，
而 URL 里就带着 SKU。搜

```
"item.jd.com" <品牌> <商品名> 商品编号 晒单 评价
```

经常能把评价页顶出来，从路径里抠出 SKU。碰运气，但靠它捞到过 5 个 SKU。

**③ 商品列表页 `so.m.jd.com/chanpin/<id>.html`** —— 返回**未渲染的 Velocity 模板**
（名字是 `#RemHtml($!{product.content.wareName})` 占位符），但商品直链是实的。
缺点：这些是长尾关键词 SEO 页（「YDZC健身玩具」「NBA模型玩具」这种自动凑的组合），
覆盖面窄，多是第三方小店的补件。

### ⚠️ 会被限流，别猛发

批量查 SKU 时**必须限速**。实测一分钟内发 ~140 个请求后，JD 会返回：

```
302 → https://trade.m.jd.com/common/limit.html?module=detail_m1&sceneType=1
```

且**匿名请求也是 302** —— 说明是按 **IP** 限的，换 cookie 没用。触发后所有
`item.m.jd.com` 请求全废。慢慢来，或者分批隔开。

### 打不开的形态

```
https://item.jd.com/<sku>.html            → 脚本请求会返回京东首页（不是商品页）
https://item.jd.com/product/<sku>.html    → 302
https://item.m.jd.com/product/<sku>.html  → ✓ 唯一实测能拿到商品数据的
```

**给用户分享链接时也要用 `item.m.jd.com` 那个形态** —— 桌面形态在脚本里是打不开的。

## 没有「历史价格」

**京东不提供历史价格接口**，第三方比价站实测也拿不到：

- 慢慢买 历史价工具页 → 200 但是登录跳转，无数据
- 慢慢买 搜索 / `m.manmanbuy.com` → 302 / 空
- 购物党 `gwdang.com` → 302
- 什么值得买 → 帖子页 `www.smzdm.com/p/<id>/` **能打开**，但里面的购买链接走
  `go.smzdm.com`（**JS 挑战**，202 + `probe.js`）；`search.smzdm.com` 同样是挑战页
- 逛丢 `iguangdiu.com` → 滑块验证；`m.guangdiu.com` → TLS 证书不匹配
- 什么值得买商品百科 `wiki.smzdm.com/p/<id>/` **能打开且有结构化 JSON**，
  但里面的 `id`（如 `25185007`）**是 smzdm 自己的编号，不是京东 SKU**（实测拿去查京东查不到）
- 京东评价 API `club.jd.com/comment/productPageComments.action` → **444**

想看历史低价只能**手动查**：把商品链接粘到 `manmanbuy.com`，或者在浏览器装购物党插件。

### 别拿厂商号当 SKU 猜

万代的商品号（如 MGEX 强袭自由的 `5063368`）和京东 SKU **不是一回事**，
拿去查会**撞到完全无关的商品**：

| 拿去查的号 | 实际返回 |
|---|---|
| `5064232` | 乔丹女跑鞋 |
| `5063513` | 花花公子卫衣 |
| `5063368` | 一件 ¥299 的无名商品 |

查出来的价格看着"有数"，但根本不是那个模型 —— **这类错误不会报错，只会安静地给你错价**。

### 附：`p.3.cn` 在校园网里连不上，不是京东的锅

经典价格 API `p.3.cn/prices/mgets` 本机死活连不上，查下来是 **DNS 解析到内网地址**：

```
p.3.cn → 10.199.200.133 / 172.18.230.51 / 172.26.101.78 / 172.28.59.58
```

本机 DNS 是 `gzicndns1.scut.edu.cn`（校园网）。**但用公共 DNS 223.5.5.5 查，返回的是同一批内网地址** ——
所以这不是校园网沉洞，是这个域在这个网络里就这么解析。换网络环境值得再试一次。

## 为什么不用浏览器自动化

试过四条路，全被挡：

| 方法 | 结果 |
|---|---|
| 无头浏览器（新 profile） | 跳登录页 |
| 有头浏览器（新 profile） | 跳登录页 |
| 复制用户的 Edge profile | cookie 解不开（App-Bound Encryption） |
| 用真实 profile + CDP | **浏览器明确拒绝** |

最后一条是硬阻断，Chrome/Edge 会直接报：

```
DevTools remote debugging requires a non-default data directory.
```

这是**防 cookie 窃取的安全设计**，不是配置问题。真要做浏览器自动化，得让它
自己起浏览器、自己扫码登录（像 `xiaohongshu/` 那个引擎的架构）——那是另一个量级的项目。

## 启动

```bash
npx tsx zhaowen-mcp/jd-price/index.ts
```
