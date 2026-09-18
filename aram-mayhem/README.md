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
| `analyze_my_playstyle` | 打法画像：时段表现、战斗风格、英雄池集中度、稳定性、符文选择的版本契合度 |
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
lib/tft.ts            云顶之弈战绩（最近 20 局）
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

## 本地归档（离线也能分析，且越攒越多）

客户端接口给的都是**滑动窗口**（海斗最多 200 局、云顶最多 20 局），关掉客户端更是读不到。为此加了一层本地归档：

- 每次查询（我的战绩 / 好友 / 云顶）读到的新对局都会按 `gameId` 并入 `data/archive/*.json`，**只增不减**；
- 攒久了覆盖时间就能超过接口窗口上限，报告与画像用的是「归档 ∪ 本次实时」的全量；
- **客户端没开时**自动改用归档，并在输出里标明「这是归档数据、截止到什么时候」；
- 账号身份也存了：在线时是当前登录账号，离线时用 `data/profile.json` 与归档里记录过的账号名；
- 归档与 profile 都在 `.gitignore` 里，不会上传仓库。

配套工具：`get_archive_info` 看覆盖情况。

## 云顶之弈（TFT）战绩

```
get_tft_stats                               # 自己
get_tft_stats { "friend": "丁ding" }         # 好友（部分名字即可）
```

给的东西：本地保留的 20 局里，平均名次 / 吃鸡率 / 前四率 / 名次分布 / 队列分布（队列名是客户端官方中文名，如「云顶之弈 (自然之力 排位 BETA测试)」），以及每局明细：名次、等级、时长、剩余金币、成型羁绊（中文）、主力棋子（星级 + 装备中文名）。

**边界（实测）**：云顶对局接口 `…/products/tft/{puuid}/matches?count=N` **最多只返回最近 20 局** —— `count` 给到 500 也还是 20，且没有任何可用的翻页参数（`begIndex` 之类一律 400）。所以这是窗口快照，不是生涯总场次。海斗那边上限是 200 局，两者不同。

## 个人战绩报告（HTML）

```sh
npm run report:html                       # 海斗报告 → reports/海斗战绩报告-<账号>-<日期>.html
npm run report:tft                        # 云顶报告 → reports/云顶战绩报告-<账号>-<日期>.html
npx tsx lib/report.ts --out 任意路径.html   # 指定输出位置
npx tsx lib/report.ts --demo              # 合成数据，客户端没开时也能检查排版
```

单文件、离线、无外部依赖（图表全是内联 SVG），带深色模式与悬浮提示：

**海斗报告**：滚动 20 把胜率折线（红色带标出 4 连败以上的低谷）· 按月胜率柱状 · 时段胜率柱状（几点打最稳）· 英雄胜率条形（50% 基准、背离着色）· **符文四象限散点**（版本胜率 × 你的胜率，右下方=版本强但你打不出，该换）· 符文「你 vs 版本」子弹图 · 英雄×符文搭配胜率 · 锐评与建议 · 最近 20 把明细。

**云顶报告**：名次分布（前四蓝/后四红）· 逐局名次折线（含 4.5 名基准）· **等级 × 名次散点**（高等级却差名次=运营问题）· 羁绊与棋子偏好（按平均名次排序）· 最近 20 局明细。

配色取自可视化基线（浅色 `#2a78d6`/`#eb6834`，深色 `#3987e5`/`#d95926`，背离蓝↔红），已用调色板校验脚本跑过色盲分离度与对比度检查。

## 已知限制

- **没有对局内实时推荐**：海斗符文是在游戏内选的，对局中三选一是游戏进程直接下发的，本地接口与官方 Live Client Data 都不含这个实时数据。**已经打完的对局**能读到符文（`playerAugment1..6`），但「现在这三选一该拿哪个」只能靠屏幕 OCR，属另一个项目。
- **官方 API 拿不到海斗对局**：match-v5 对海斗返回 403（官方明确 intended），所以任何依赖官方 API 的统计都做不了 —— 本服务的账号功能全部走本地客户端，不依赖官方 API。
- **`refresh_data` 会联网**：其余工具都是只读本地快照。刷新要下载官方字符串表（约 32MB）与云顶官方数据（约 24MB，只用来抽中文名瘦表）。
- **云顶战绩只有最近 20 局**（接口上限），海斗是最近 200 局 —— 都是窗口快照，不是生涯总场次；本地归档能慢慢把覆盖时间拉长，但补不回已经错过的历史。
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
