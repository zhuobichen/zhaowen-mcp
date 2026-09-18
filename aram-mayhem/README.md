# aram-mayhem — 英雄联盟「海克斯大乱斗」MCP 服务

给 Claude Code 等 MCP 客户端用的**海克斯大乱斗（ARAM Mayhem / 海斗）**助手：查符文（海克斯）图鉴、算羁绊、看英雄推荐搭配、比版本差异，另可绑定本机登录的国服账号读最近对局。

数据在构建阶段抓取并合并成本地快照，**运行时只读本地文件、不联网**（只有 `refresh_data` 会联网刷新；账号相关的三个工具走本机 127.0.0.1 的客户端接口）。

## 工具

| 工具 | 作用 |
|------|------|
| `get_data_info` | 当前补丁、数据更新时间、各类条数、全部数据来源与已知数据出入 |
| `search_augments` | 搜/列符文：中文名、英文名、说明关键词；可按品质、在池状态过滤；默认按强度榜名次排 |
| `get_augment` | 单个符文详情：游戏内原文说明、品质、在池状态、两套胜率口径、强势英雄、所属羁绊、英雄评价与搭配 |
| `list_synergy_sets` | 列出羁绊（套装）：需要哪些符文、凑齐效果 |
| `analyze_synergy` | 羁绊推算：输入已有符文 → 能凑哪些羁绊、还差几件、缺的符文哪些还在池 |
| `list_champions` | 按胜率/梯队列英雄（含国服口径） |
| `get_champion_guide` | 英雄视角：梯队胜率 + 符文评价（带神级/强力/陷阱标签）+ 多件搭配 + 该英雄的强势符文 + 相关羁绊 |
| `compare_patches` | 对比两个补丁快照：符文增删、说明改动、品质/名次变动、英雄梯队变动 |
| `refresh_data` | 联网刷新数据并归档快照（等价于 `npm run refresh`） |
| `get_my_account_status` | 连本地客户端、读当前登录账号并固定到 `data/profile.json` |
| `get_my_recent_games` | 我最近的对局（英雄、胜负、KDA、时长） |
| `analyze_my_augments` | 我最近海斗拿过的符文统计：使用次数/胜率（对照版本榜）、陷阱符文提示、常玩英雄与还没拿过的神级符文 |
| `list_my_friends` | 列出客户端里的好友（含在线状态），用于确认名字 |
| `get_friend_stats` | 看某个好友的海斗战绩：胜率、常玩英雄、符文使用与版本名次、陷阱提示、神级符文推荐（只能查好友列表里的人） |
| `get_my_ranked` | 排位段位与战绩：段位、LP、胜负、连胜连败（默认自己，可试好友）|
| `analyze_my_playstyle` | 打法画像：时段表现、战斗风格、英雄池集中度、稳定性、符文选择的版本契合度、高光（多杀/首杀）、效率（每分钟伤害与金币）、作息强度 |
| `get_my_teammates` | 队友/对手：谁和你一起打得最多、共同胜率、和谁打最稳；对手维度的覆盖也一并说明 |
| `get_my_builds` | 出装：最常出的装备与胜率、出得多但胜率偏低该换的（按背包槽位统计，不是购买顺序） |
| `get_my_matchups` | 英雄对位：对面出现谁时你最容易输/最稳；用「残差」（减去该英雄自身胜率）区分「它本身强」和「你真的打不过」 |
| `compare_accounts` | 跨账号并排对比：局数/胜率/近期状态/KDA/伤害/常玩英雄/常用符文 + 一句结论 |
| `get_friend_leaderboard` | 小圈子榜单：归档里出现过的账号按海斗胜率排名（不是全服排名） |
| `get_champ_select_teammates` | 选人阶段只读侦察：读当前选人会话的队友，逐个拉最近战绩整理成一份给你自己看的报告（不发言） |
| `send_champ_select_message` | 往当前选人频道发一条**你指定**的消息（需 `confirm: true`）；对局内频道官方无接口，做不到 |
| `export_games_csv` | 导出对局明细 CSV（海斗/全部模式/云顶），带 BOM，Excel 直接打开不乱码 |
| `get_my_trend` | **周趋势**：按自然周分桶看场次/胜率/KDA/伤害的逐周变化，并对比「最近 4 个有效周 vs 之前 4 个」；未达样本门槛的周不参与结论 |
| `get_tft_detail` | 云顶棋子与装备维度：最终阵容里带某棋子/装备时的平均名次与前四率、追到过三星的棋子 |
| `get_empirical_augments` | **符文实证榜**：用本机归档的真实对局（约两千局/两万行，每局含全部 10 人的符文）算符文胜率，与社区站口径并列对照 |
| `get_augment_pairs` | **符文组合实证**：同局一起拿到这两件时是否比分开拿更好（协同 = 组合胜率 − 两件单拿的平均） |
| `check_synergy_sets` | **羁绊验证**：羁绊在实战里被凑齐时胜率如何；并给出一局实际能拿几件符文的分布 |
| `get_archive_info` | 本地归档覆盖情况（联盟/云顶各多少局、时间跨度、有哪些账号）|
| `get_tft_stats` | 云顶之弈（TFT）战绩：平均名次、吃鸡率、前四率、名次分布、队列分布、最近几局明细（含羁绊/棋子/装备中文名）。默认查自己，传 `friend` 查好友 |

用法示例（在对话里说即可）：

- 「海斗现在最强的金色符文有哪些」
- 「雪球这套羁绊还差什么」
- 「提莫在海斗里推荐拿什么符文，有没有陷阱符文」
- 「坦克引擎是什么效果，谁用最好」

## 数据来源与口径

本服务**不是官方数据服务**，数据是多个公开来源合并的结果，冲突时不臆测合并：

| 数据 | 来源 | 性质 |
|------|------|------|
| 符文**效果说明原文**、官方中文名、品质、图标、模式归属 | Riot 客户端游戏文件（[CommunityDragon](https://raw.communitydragon.org) 导出：`kiwi.bin.json`/`kiwi_jade.bin.json` 的文本 key + `lol.stringtable.json` 中文文本 + `cherry-augments.json` + `augment-lists.json`） | **官方文件**，即游戏内显示的内容 |
| 符文胜率/选取率/名次、羁绊、英雄梯队与胜率、英雄×符文搭配与攻略、神级/陷阱标签 | 社区站 [arammayhem.com](https://arammayhem.com) 的公开静态 JSON（`search-index.json`、`zh-cn/augments/` 页面、`zh-cn/tier-list/augment-overflow.json`、`zh-cn/combo-index-data.json`） | **第三方统计**（全球口径），非官方数值 |
| 国服胜率/选取率/名次 | [aramgg.com](https://aramgg.com) 的公开静态 JSON（聚合的腾讯国服样本） | **第三方统计**（国服口径） |
| 云顶之弈羁绊/棋子/装备的中文名 | Riot 官方云顶数据（CommunityDragon `cdragon/tft/zh_cn.json`，只抽「内部标识→中文名」的瘦表） | **官方文件** |
| 队列中文名（海斗=海克斯大乱斗、云顶各模式等） | 客户端自带的 `/lol-game-data/assets/v1/queues.json` | **官方本地化** |

两套胜率口径**分开列出、不混算**。官方与社区站名称/品质冲突时以官方名为展示名，两种名字都能搜到，并在 `get_data_info` 里列出冲突明细。

关于「在池状态」：`live` = 该站标注当前对局能选到，`retired` = 该站标注已移除，`unknown` = 只在官方游戏文件或该站搜索索引里出现、来源没标状态（多半是已轮换下架的老符文）。查不到时可用 `scope: "all"` 再搜一次。

说明文字里会保留 `@xxx@` 占位符 —— 那是游戏内按实际数值替换的量，本工具**不替它编数字**；同一符文通常也能看到社区站整理好的带数字版本。

## 安装与配置

```sh
cd aram-mayhem
npm install
npm run refresh     # 首次需要联网拉一次数据（生成 data/*.json，约 30~60 秒，含一个 32MB 的官方字符串表）
```

在 Claude Code 的 `~/.claude.json` 里注册（Windows）：

```json
{
  "mcpServers": {
    "aram-mayhem": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "node", "D:/github_project/zhaowen-mcp/aram-mayhem/node_modules/tsx/dist/cli.mjs", "D:/github_project/zhaowen-mcp/aram-mayhem/index.ts"]
    }
  }
}
```

## 绑定账号（可选）

三个账号工具走**本机客户端**（WeGame 启动的国服客户端同样适用），不经过任何外部服务器：

- 需要**英雄联盟客户端正在运行**，并且已经进到大厅（登录/更新界面时本地接口还没起来）；
- 凭据自动从 `LeagueClientUx.exe` 的命令行或 `LeagueClient/lockfile` 获取，也可用环境变量 `MAYHEM_LCU_PORT` / `MAYHEM_LCU_TOKEN` 手动指定；
- 客户端异常退出会残留**端口已失效的旧进程**，取凭据时按启动时间倒序取最新、并逐个候选试连，所以不用手动清理；
- 首次连上后账号名会固定到 `data/profile.json`（只记名字/puuid/等级/时间，已被 `.gitignore` 排除，不上传仓库）。

**实测能力（国服 26.x，2026-09 验证）**：

- `get_my_recent_games` 能读到最近对局（模式标识就是 `KIWI`，即海斗）：英雄、胜负、KDA、时长；
- `analyze_my_augments` **确实能读到当局选过的符文** —— 本地对局记录里带 `playerAugment1..6`（数字 id，与官方符文库 `AugmentPlatformId` 一一对应，实测 21 把 46 个 id 全部对上）。
  它会给：近期胜率、常玩英雄、符文使用次数与胜率（对照版本榜）、**你实际拿过的「陷阱」符文**、以及常玩英雄里还没拿过的「神级」符文；
- ⚠️ 注意区分：**Riot 官方对局 API 对海斗是封禁的**（match-v5 返回 403，[developer-relations#1109](https://github.com/RiotGames/developer-relations/issues/1109) 官方回复 intended），
  但这只影响外部 API；**本地客户端自己的对局记录里是有符文数据的**，本服务走的是后者，不依赖官方 API；
- `list_my_friends` / `get_friend_stats`：好友列表读的是客户端聊天接口（国服好友名在 `gameName` 字段），对局记录用 `puuid` 查询（实测对好友可用，读的是公开对局数据，只读、不改动对方任何设置）。
  同理，**能读到的仍然只是本机客户端缓存的那部分对局**，不是对方的历史总场次；非好友不在列表里，也就读不到。

## 数据刷新与自检

```sh
npm run refresh      # 联网抓取 + 合并 + 写 data/ + 归档当前补丁快照
npm run report       # 不联网，只打印现有数据的校验报告
npm run typecheck    # TypeScript 类型检查
npx tsx smoke.ts     # 冒烟测试：直接调用各工具，检查输出
node mcp-smoke.mjs   # 端到端：用真实 MCP stdio 协议连一次服务
npx tsx lcuprobe.ts  # 客户端探测：连接状态、最近对局里实际有哪些字段
npm run report:html  # 生成个人战绩报告（单文件 HTML，输出到 reports/）
npm run report:tft   # 生成云顶战绩报告
npm run archive:sync # 把当前账号（--friends 连好友）的对局并进本地归档
npm run mlol:capture # 抓掌盟登录态（mitmproxy，自动存 cookie 与请求样本）
npm run mlol:probe   # 验证掌盟接口可行性（闸口在哪一步）
npm run pc:capture   # 纯 PC 抓包：找 WeGame 战绩接口（配合 pc:trust-ca / pc:proxy-on）
npm run pc:analyze   # 分析抓到的样本，排序指出最像对局记录的接口
npm run sgp:probe    # 实测 SGP 能翻到多少历史（需要客户端在线）
npm run team:scout   # 选人阶段侦察队友（只读）
npm run team:say     # 往选人频道发一条（需 --yes）
```

每次 `npm run refresh` 会按补丁号在 `data/patch-snapshots/<补丁>.json` 存一份快照，攒够两个版本后 `compare_patches` 就能做版本对比。

刷新时若发现来源之间对不上（名称/品质不一致、只有官方有、同名不同 id、官方定义缺文本、卡片符文解析失败、某个源没拉到），会写进 `data/meta.json` 的 `validation` 并在 `get_data_info` / `npm run report` 里显示 —— 这些是数据本身的出入，不会自动「调和」。

## 目录结构

```
index.ts              MCP 协议层：工具声明与分发
lib/types.ts          数据结构定义
lib/refresh.ts        数据构建：抓取、合并、交叉校验、写快照（唯一联网处）
lib/lcu.ts            本地客户端（LCU）接口封装
lib/store.ts          本地数据加载、索引、名称匹配、文案格式化
lib/tools.ts          查询类工具实现
lib/my.ts             账号类工具实现
lib/friends.ts        好友列表与好友战绩
lib/analysis.ts       对局分析（本人/好友共用）
lib/report.ts         个人战绩报告生成器（单文件 HTML，内联 SVG 图表）
lib/tft.ts            云顶之弈战绩（客户端细节）
lib/tft-detail.ts     云顶棋子/装备维度（按最终阵容统计平均名次）
lib/trend.ts          周趋势（按自然周分桶 + 有效样本门槛）
lib/sgp.ts            腾讯 SGP 后端：真分页长历史（海斗/云顶），SGP 与 LCU 双源合并
lib/queues.ts         队列 id ↔ 中文名（客户端官方本地化 + 实测补录）
lib/builds.ts         出装分析（背包槽位口径）
lib/social.ts         队友/对手分析（取每局 10 人名单）
lib/matchups.ts       英雄对位分析（残差口径：扣掉敌方英雄自身强度）
lib/empirical.ts      实证统计：符文榜/组合协同/羁绊验证（样本=本地归档全部对局）
lib/leaderboard.ts    小圈子榜单（归档里出现过的账号按胜率排名）
lib/compare.ts        跨账号并排对比
lib/export.ts         对局明细导出 CSV
lib/teammates.ts      选人阶段队友侦察 + 发消息（唯一写操作，需显式确认）
lib/ranked.ts         排位段位与战绩
lib/archive.ts        本地对局归档（只增不减，离线可用）
lib/games.ts          统一取数入口（客户端 ∪ 归档）+ 归档概览
lib/identity.ts       身份解析：在线用客户端、离线用固定账号与归档
lib/profile.ts        固定下来的账号信息（data/profile.json）
lib/playstyle.ts      打法画像分析
lib/report-tft.ts     云顶战绩报告生成器
smoke.ts / mcp-smoke.mjs / lcuprobe.ts   自检脚本（lcuprobe 可单独跑，确认客户端连接与对局字段）
data/augments.json    符文（合并结果）
data/champions.json   英雄（含国服口径与手动外号）
data/synergy-sets.json 羁绊
data/combos.json      多件搭配
data/combo-cards.json 单件评价卡片（带神级/陷阱标签）
data/champion-ids.json 数字英雄 id ↔ 英文 id（对局记录用）
data/tft-names.json   云顶羁绊/棋子/装备的官方中文名（约 250KB）
data/archive/         本地对局归档（含账号与对局数据，已在 .gitignore 排除）
data/aliases.json     国服外号表（手动维护，可随时改）
data/meta.json        补丁号、来源、条数、校验报告
data/patch-snapshots/ 各补丁快照
data/profile.json     绑定的账号（运行时生成，含召唤师名/puuid，已在 .gitignore 中排除）
data/friends-*.json   好友相关数据不落盘，全部按需从客户端读取
reports/              生成的个人战绩报告（含账号名，已在 .gitignore 中排除）
```

## 更长的历史：腾讯 SGP（推荐，纯 PC / 只读 / 真分页）

本地客户端（LCU）只给滑动窗口（海斗 200 局、云顶 20 局，翻页参数还会被忽略）。
国服还有一条**后端**路线：腾讯 SGP 的 `match-history-query`，按 `startIndex` 真正分页，
社区实现（LeagueAkari）用它把对局翻到 1000 场，队列白名单里**包含 2400（海克斯大乱斗）**。

```sh
npm run sgp:probe              # 实测你的账号能翻到多少历史（只读、低频、只查自己）
npm run sgp:probe -- 100 1000  # 页大小 100、上限 1000
```

实现要点（`lib/sgp.ts`）：

| 环节 | 做法 |
|---|---|
| 鉴权 | 用**本机客户端自己的** entitlements token（`GET /entitlements/v1/token`），不碰账号密码、不落盘 |
| 大区 | `GET /lol-rso-auth/v1/authorization` 的 `currentPlatformId`（本机是 `HN1`） |
| 地址 | 国服 8 个 SGP 主机映射内置在代码里（来源：LeagueAkari-Config，其 `tencentServerMatchHistoryInteroperability` 标明了国服支持战绩互通的大区）|
| 取数 | `GET /match-history-query/v1/products/lol/player/{puuid}/SUMMARY?startIndex=&count=` |

**双源合并**：SGP 给广度（长历史）、LCU 给细节（`playerAugment1..6` 等符文数据）。
两者按 `gameId` 并进本地归档，同一局若 LCU 那份更全会自动覆盖 SGP 的摘要 ——
所以分析（胜率/英雄/符文/画像/报告）会自动用上更长的历史。

**边界**：SGP 也需要客户端正在运行并登录；能翻多深取决于腾讯后端保留策略，
`npm run sgp:probe` 会实测出你的账号到底能拿多少（若深翻返回空数组即为到底）。

## 纯 PC 抓包：找 WeGame「我的战绩」的接口（备选）

目标：在**只用这台电脑**的前提下，拿到比本地客户端更长的历史。
思路：WeGame 客户端（已装在本机）的「我的战绩」背后一定有接口，用本机代理把它抓出来。

```sh
npm run pc:trust-ca    # ① 把 mitmproxy 的 CA 装进【当前用户】证书库（可撤销）
npm run pc:proxy-on    # ② 系统代理指向 127.0.0.1:8080（会先备份你原来的代理，如 Clash）
npm run pc:capture     # ③ 启动抓包（保持窗口开着）
# ④ 打开 WeGame → 我的战绩 → 随便翻一翻
# ⑤ 回到抓包窗口按 Ctrl+C 停止
npm run pc:analyze     # ⑥ 自动排序，指出哪个接口最像对局记录
npm run pc:proxy-off   # ⑦ 还原系统代理
npm run pc:untrust-ca  # ⑧ 撤掉 CA（不撤销会一直信任 mitmproxy 的根证书）
```

- 样本存在 `data/pc-samples/`（已 gitignore），分析器会给每个候选接口打分（响应里是否含 `gameId`/`championId`/`participants` 等）。
- **可能失败的情况**：WeGame 不读系统代理、或对证书做了固定（pinning）→ 抓不到东西。
  那时按提示换路（例如安卓模拟器跑掌盟，可装系统级证书）。
- 安全边界：CA 只装进**当前用户**证书库、代理只改 HKCU，两者都有对应的还原命令；抓包期间理论上能看到本机其它应用的 HTTPS 流量，所以抓完就关。

## 掌盟（更长的历史）—— 已搭好抓包与探针，待取登录态

本地客户端给的历史有硬上限（海斗 200 局、云顶 20 局，且没有可用翻页参数）。想拿更长的历史，
国服唯一官方入口是**掌上英雄联盟（掌盟）**，它的战绩接口实测存在：

```
POST https://mlol.qt.qq.com/go/battle_info/get_battle_list
POST https://mlol.qt.qq.com/go/battle_info/get_battle_detail
→ 未登录：{"err_msg":"cookie userid empty","msg":"登录态失效，请重新登录","result":1001}
```

**目前唯一未知**：过了 cookie 闸口之后是否还要签名（sig/nonce/timestamp）—— 这决定成本，
所以先做可行性验证。

```sh
npm run mlol:capture     # 电脑上启动 mitmproxy（8080），插件会自动存 cookie 与请求样本
npm run mlol:probe       # 拿到 cookie 后跑这个，看闸口在哪一步
```

抓 cookie 的步骤（在你自己手机上，5 分钟）：

1. 手机与电脑连同一个 Wi-Fi；手机 Wi-Fi 高级设置里把代理设为**手动**，主机填电脑内网 IP、端口 8080；
2. 手机浏览器打开 `http://mitm.it` 装证书并信任（iOS：设置→通用→VPN与设备管理里信任；Android：安装用户证书）；
3. 打开掌盟 App → 进「战绩」页翻一次；
4. 插件会把 Cookie 存到 `data/mlol-cookie.txt`、请求样本存到 `data/mlol-samples/`；
5. 电脑上跑 `npm run mlol:probe`：返回 `result=0` 就是通了；若提示「要求签名」则此路成本上升；提示「参数不对」说明 cookie 已通过。

⚠️ 边界与风险（务必知情）：

- **抓包代理会看到手机上的全部 HTTPS 流量**：只在自己手机上做，抓完立刻 Ctrl+C 停掉；
- **Android 7+ 默认不信任用户安装的证书**，掌盟（WebView）若开启证书校验会抓不到 —— 备选是安卓模拟器（可装系统级证书）或 iOS 设备；
- 腾讯《游戏许可及服务协议》6.4(4)/(6) 禁止「非腾讯授权的第三方工具/服务接入」，**复用掌盟登录态比本地 LCU 只读的暴露面更大**，是否值得由你判断；
- 掌盟同样**没有「生涯总场次」**，只有约最近 200~500 场的滑动窗口；
- 本仓库不保存任何登录态到版本库：`data/mlol-cookie.txt` 与 `data/mlol-samples/` 都在 `.gitignore` 里。

## 选人阶段：队友侦察（只读）+ 发消息（需显式确认）

```sh
npm run team:scout                    # 只读：读当前选人会话，把队友近期海斗战绩整理成报告
npm run team:say -- --yes "你的文本"   # 发一条到当前选人频道（文本由你定，--yes 为显式确认）
```

MCP 工具：`get_champ_select_teammates`（只读侦察）、`send_champ_select_message`（需 `confirm: true`）。

**能力边界（写在代码注释里，也写在这里）**：

| 渠道 | 能不能做 | 原因 |
|---|---|---|
| 选人阶段频道 | ✅ 可读可发（LCU `/lol-champ-select/v1/session` + `/lol-chat/v1/conversations/{id}/messages`） | 官方本地接口开放 |
| 好友私聊 | ✅ 可发 | 同上，`/lol-chat` |
| **对局内的我方频道 / 所有人频道** | ❌ **做不到，也不做** | 局内聊天不走 LCU，是游戏进程自己的 socket；实现只能靠注入游戏进程或模拟键鼠，命中腾讯条款 6.4 且会被 ACE 检测 |

另外：**不做「按队友自动生成评价并批量发送」**。自动把评价推给随机匹配到的陌生人，既是骚扰举报的高发场景，也是我不愿意替你按的开关。
`team:scout` 的报告是给你自己看的；要发什么、发不发，由你决定。

## 本地归档（离线也能分析，且越攒越多）

客户端接口给的都是**滑动窗口**（海斗最多 200 局、云顶最多 20 局），关掉客户端更是读不到。为此加了一层本地归档：

- 每次查询（我的战绩 / 好友 / 云顶）读到的新对局都会按 `gameId` 并入 `data/archive/*.json`，**只增不减**；
- 攒久了覆盖时间就能超过接口窗口上限，报告与画像用的是「归档 ∪ 本次实时」的全量；
- **客户端没开时**自动改用归档，并在输出里标明「这是归档数据、截止到什么时候」；
- 账号身份也存了：在线时是当前登录账号，离线时用 `data/profile.json` 与归档里记录过的账号名；
- 归档与 profile 都在 `.gitignore` 里，不会上传仓库。

配套工具：`get_archive_info` 看覆盖情况；`npm run archive:sync`（加 `--friends` 连好友一起）可以把所有关心的账号一次补齐，比等查询顺带并入攒得快。

## 云顶之弈（TFT）战绩

```
get_tft_stats                               # 自己
get_tft_stats { "friend": "丁ding" }         # 好友（部分名字即可）
get_tft_detail                              # 棋子/装备维度（平均名次、前四率、三星）
npm run tft:detail                          # 同上，命令行直接跑
```

给的东西：本地保留的 20 局里，平均名次 / 吃鸡率 / 前四率 / 名次分布 / 队列分布（队列名是客户端官方中文名，如「云顶之弈 (自然之力 排位 BETA测试)」），以及每局明细：名次、等级、时长、剩余金币、成型羁绊（中文）、主力棋子（星级 + 装备中文名）。

**边界（实测）**：客户端自己的 TFT 对局接口 `…/products/tft/{puuid}/matches?count=N` **最多只返回最近 20 局** —— `count` 给到 500 也还是 20，翻页参数一律 400。所以**只靠客户端**时这是窗口快照，不是生涯总场次。

但云顶同样能走腾讯 SGP 后端真分页（`product=tft`），实测本机账号拿到 **684 局**，远深于客户端的 20 局 —— 所以 `get_tft_stats` 与分析默认用的是「SGP ∪ 客户端 ∪ 归档」的全量，输出里会标注来源。

## 个人战绩报告（HTML）

```sh
npm run report:html                       # 海斗报告 → reports/海斗战绩报告-<账号>-<日期>.html
npm run report:tft                        # 云顶报告 → reports/云顶战绩报告-<账号>-<日期>.html
npx tsx lib/report.ts --out 任意路径.html   # 指定输出位置
npx tsx lib/report.ts --friend 好友名        # 出别人的报告（只读查 TA 的历史）
npx tsx lib/report.ts --demo              # 合成数据，客户端没开时也能检查排版
```

单文件、离线、无外部依赖（图表全是内联 SVG），带深色模式与悬浮提示、图编号与题注（期刊式：图在上、说明在下）、打印/导出 PDF 友好：

**海斗报告**：滚动 20 把胜率折线（红色带标出 4 连败以上的低谷）· 按月胜率柱状 · 时段胜率柱状（几点打最稳）· 英雄胜率条形（50% 基准、背离着色）· **符文四象限散点**（版本胜率 × 你的胜率，右下方=版本强但你打不出，该换）· 符文「你 vs 版本」子弹图 · 常一起打的人 · 英雄×符文搭配胜率 · 出装与胜率 · **对位残差背离图**（中轴 0，左红=额外打不过）· 锐评与建议 · 最近 20 把明细。

**云顶报告**：名次分布（前四蓝/后四红）· 逐局名次折线（含 4.5 名基准）· **等级 × 名次散点**（高等级却差名次=运营问题）· 羁绊偏好 · 棋子偏好 · **装备偏好**（带它收场时的平均名次）· 羁绊组合与成绩 · 最近 20 局明细。

配色取自可视化基线（浅色 `#2a78d6`/`#eb6834`，深色 `#3987e5`/`#d95926`，背离蓝↔红），已用调色板校验脚本跑过色盲分离度与对比度检查。

## 已知限制

- **实证统计是观察数据，不是实验数据**：`get_empirical_augments` / `get_augment_pairs` / `check_synergy_sets` 用的是本机归档里的真实对局（每局含全部 10 人的符文），样本厚但**符文是玩家自己选的** —— 胜率里含「谁会选它」的选择偏差，强符文容易被会玩的人拿走。样本也不代表全服，只是本机几个账号及其排到过的人。这几个工具的输出里都会写明这一点。
- **云顶棋子/装备是「最终阵容」口径**：`get_tft_detail` 统计的是你收场时带着它，不是「拿了它就能赢」。追卡、抢装备本身和当局运气与运营绑定，所以只能当参考。另外棋子标识来自对局记录（小写，如 `tft16_atakhan`），官方文件里是大写驼峰（`TFT16_Atakhan`），代码走的是大小写无关查找；仍查不到的会原样显示内部标识，不编中文名。占位条目（如 `EmptyBag`）会被过滤，否则它会以「平均名次 1.20、前四 100%」霸榜。
- **羁绊在实战里几乎凑不齐**：羁绊要同时拿到 4~8 件指定符文，而一局里 76% 的人只拿到 4 件符文，池子里有两百多个符文。实测 2041 把里 9 套羁绊一次都没凑齐过 —— `check_synergy_sets` 会把这条结论连同分布一起给出来。
- **没有对局内实时推荐**：海斗符文是在游戏内选的，对局中三选一是游戏进程直接下发的，本地接口与官方 Live Client Data 都不含这个实时数据。**已经打完的对局**能读到符文（`playerAugment1..6`），但「现在这三选一该拿哪个」只能靠屏幕 OCR，属另一个项目。
- **官方 API 拿不到海斗对局**：match-v5 对海斗返回 403（官方明确 intended），所以任何依赖官方 API 的统计都做不了 —— 本服务的账号功能全部走本地客户端，不依赖官方 API。
- **`refresh_data` 会联网**：其余工具都是只读本地快照。刷新要下载官方字符串表（约 32MB）与云顶官方数据（约 24MB，只用来抽中文名瘦表）。
- **接口窗口是有限的，不是生涯总场次**：本地客户端只给最近 200 局（云顶 20 局）；本服务另外走腾讯 SGP 后端做真翻页，实测能拿到上千局（海斗 311、云顶 684），但仍有上限。本地归档能慢慢把覆盖时间拉长，补不回已经错过的历史。
- **英雄对位的「残差」是近似**：社区站胜率统计的是该英雄在**己方**时的表现，这里用它去减「它在**对面**时你的胜率」，两者口径不完全对称，只用来把「它本身强」从对位数据里大致扣掉。
- **没有队友/对手维度**：客户端给的对局摘要里只有自己那一行参与者（不是 10 人完整数据），所以做不了「和谁同队胜率高」这类分析。
- **胜率口径**：社区站页面未标注样本量，国服数据来自客户端上传聚合；样本量小时数字没有统计意义，只适合相对比较。
- **官方轮换池 `KIWI` / `KIWI_JADE` 的含义未经官方文档确认**：两者互有出入（223 / 188 条），本服务都按海斗处理并注明。
- 外号表是手工维护的，只覆盖常见国服叫法；缺的可以直接改 `data/aliases.json`。

## 参考项目与数据源

- [CommunityDragon](https://github.com/CommunityDragon) —— 官方游戏文件的公开导出（本项目的官方侧数据全部来自这里）
- [arammayhem.com](https://arammayhem.com) / [aramgg.com](https://aramgg.com) —— 海斗的社区统计与攻略数据
- [Lanternko/ARAM-Mayhem-Database](https://github.com/Lanternko/ARAM-Mayhem-Database)、[StateMnet/choosehextech](https://github.com/StateMnet/choosehextech)、[Nyx0ra/lol-aram-mayhem-hextech-helper](https://github.com/Nyx0ra/lol-aram-mayhem-hextech-helper) —— 同类项目，本服务未直接使用其数据，但整理口径时参考过

## License

MIT。数据版权归各来源（Riot Games / arammayhem.com / aramgg.com）所有，本仓库只做个人查阅用途的本地快照与整理。
