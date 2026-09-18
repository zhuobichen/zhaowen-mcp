# 样本门槛登记表

> 由 `npm run thresholds:doc` 生成（`tools/audit-thresholds.mjs`）。**不要手改**。

这些「至少 N 局才下结论」的数是散在各模块里的裸数字，全库没有一处写明推导。
这里把每个都登记出来，并算清它**买到的是什么** —— 门槛够不够，看最后一列比看数字直观。

**可分辨差**：两组各 n 局、比胜率时，95% 置信下能分辨的最小差（百分点）。
算法 `1.96·√(0.5/n)`，取 p≈0.5 的最坏情况。约等于说：小于这个差，结论跟噪声分不开。

| 门槛 | 值 | 位置 | 分的是什么桶 | 可分辨差 | 为什么是这个数 |
|---|---|---|---|---|---|
| `minGames` | 1 / 3 | `lib/social.ts:130,131,152` | 队友 / 对手 | 139pp / 80pp | 未说明 |
| `minGames` | 3 | `lib/patches.ts:162` | 补丁（通常 5~10 个） | 80pp | 只用于「列进明细」，不下结论 |
| `perPairGames` | 5 | `lib/matchups.ts:191` | 我×对面 的组合（英雄视角） | 62pp | 未说明。原先是读 opts.minGames 的，跟整体视角共用输入但默认值不同 —— 已拆开（见该文件注释） |
| `minGamesPerWeek` | 5 | `lib/trend.ts:76` | 自然周 | 62pp | 未说明 |
| `minGames` | 8 | `lib/builds.ts:61` | 装备 × 槽位 | 49pp | 未说明 |
| `minGames` | 10 | `lib/leaderboard.ts:22` | 账号（个位数） | 44pp | 上榜最低局数，不是统计门槛 |
| `minGames` | 10 | `lib/queue-stats.ts:123,197` | 队列（4~6 个） | 44pp | 未说明 |
| `minGames` | 12 | `lib/matchups.ts:177` | 对面出现过的英雄（约 170 个） | 40pp | 未说明 |
| `minGames` | 12 | `lib/tft-detail.ts:137` | 棋子 / 装备 | 40pp | 未说明 |
| `minGames` | 15 | `lib/combat-profile.ts:148` | 队内名次档（同上） | 36pp | 未说明 |
| `minGames` | 15 | `lib/contribution.ts:126` | 队内名次档（第 1 / 2 / 3 / 4 及以后） | 36pp | 未说明 |
| `minChampionGames` | 15 | `lib/matchups.ts:183` | 我玩过的英雄 | 36pp | 未说明 |
| `verdictMinGames` | 15 | `lib/patches.ts:207,267` | 同上，但用于跨版本结论 | 36pp | 刻意比列明细的门槛高 —— 列出来是陈述事实，下结论才有样本要求 |
| `minGames` | 20 / 30 / 60 / 100 | `lib/empirical.ts:129,162,228,299,388,505,648,677` | 符文 / 组合 / 羁绊（该文件有 6 处不同门槛） | 31pp / 25pp / 18pp / 14pp | 同一个文件里 20/30/60/100 都出现了，未说明为何不同 |
| `minGames` | 20 | `lib/tilt.ts:101` | 连败/连胜长度档 | 31pp | 未说明 |
| `minGames` | 60 | `lib/comps.ts:149` | 对面 6 类标签 × 胜负 | 18pp | 未说明 |
| `minItemGames` | 150 | `lib/counters.ts:71` | 装备（成装约 150 件） | 11pp | 未说明 |
| `minBucketGames` | 300 | `lib/counters.ts:72` | 对面阵容档 × 装备 | 8pp | 全库最高的门槛 —— 二维交叉，单元最多 |

## 怎么看这张表

- **可分辨差大于你要讲的那句话，那个结论就撑不起来。** 例如门槛 15 局只能分辨 ~36 个
  百分点的差 —— 想讲「这项做得多就赢得多」，得那个差真的很大才行。
- 全库最高的是 `minBucketGames`（300 局 → 可分辨 ~8pp），最低的是 `minGamesPerWeek`（5 局 →
  ~62pp）。这两个差得很远是对的：分桶越多、单元越细，每个桶需要的样本越多。
- 但**同类语义用了不同数字且没写理由**的地方仍然存在（见表中「未说明」）。
  这不是 bug，是「没人知道该是多少」—— 记在这里，改的时候至少知道自己在改一个有记录的空缺。

共 18 个门槛登记在册，其中 14 个的理由是「未说明」。

## 怎么维护

新增一个样本门槛（`opts.min* ?? N`）后，`npm run audit:thresholds` 会报「有门槛没登记」。
在 `tools/audit-thresholds.mjs` 的 `REGISTRY` 里加上条目再 `npm run thresholds:doc`。
**理由写不出来就写「未说明」**，不要编一个听起来合理的 —— 那比没有更坏，下一个人会照着它改。
