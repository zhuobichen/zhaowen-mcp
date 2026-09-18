/**
 * 跨模块共用的**样本门槛**。
 *
 * 为什么要有这个文件：这些数字原先各自写在各模块里，同一个语义在不同文件里
 * 用了不同取值，而且**没有任何一处说明为什么**。散着写的时候，改一处忘一处不会有
 * 任何提示 —— 也不会有人发现两个本该一致的数已经不一致了。
 *
 * 放这里不等于「这些数是对的」—— 只是让「它们是一回事」这件事在代码里成立。
 * 每个常量下面写清楚**已知**的依据；没有依据就写「未说明」，
 * 不要编一个听起来合理的（下一个人会照着它改）。
 * 登记表在 docs/THRESHOLDS.md（由 tools/audit-thresholds.mjs 生成）。
 */

/**
 * 「按队内名次分档」时，每一档至少多少局才下结论。
 *
 * 用在 get_my_contribution（伤害/金币/KDA/补刀各分 5 档）与
 * get_combat_profile（控制/治疗/存活等 6 个指标各分 5 档）—— 两处**同一套分档方式**，
 * 原先各写了一个 `15`，数值碰巧一样但没有共用常量。
 *
 * 为什么是 15：**未说明**。实测（npm run thresholds:sweep）这个值在 5~80 之间
 * 都不改变这两处的结论 —— 分桶是固定的，门槛只决定「够不够下结论」。
 * 也就是说目前没有任何观测能支持 15 比 20 或 30 更好，只是它一直在那儿。
 *
 * 为什么 tilt 不用它：get_my_tilt 分的是**连败/连胜长度**（连输 1 / 2 / 3+ 把），
 * 不是「队内第几名」，桶的含义和分布都不同 —— 它的 20 是有意独立的，不是漏改。
 */
export const RANK_BUCKET_MIN_GAMES = 15;

/**
 * 「从 N 条里挑最大值」时，纯噪声能造出多大的偏离。
 *
 * 为什么需要它：本仓库有一大批结论是「挑最高 / 挑最低」——出装里挑胜率最高、
 * 符文对里挑协同最强、队友里挑最稳、时段里挑最好……这些**都是最大值统计量**：
 * 候选越多，极差越大是构造性的，哪怕每一条都纯是噪声。
 *
 * N 个独立标准正态的极值期望 ≈ √(2·ln N)。所以先取这批条目标准误的**中位数**
 * （代表典型条目有多不确定），再乘这个系数，就是「光靠挑最大能造出多大差距」。
 *
 * 用法：把返回值跟候选里最大的那个偏离比。**小于它，说明这个"最"是挑出来的，不是测出来的。**
 */
export function noiseCeiling(entries: Array<{ games: number; rate: number }>): number {
  if (!entries.length) return 0;
  const ses = entries.map((e) => Math.sqrt(Math.max(e.rate * (100 - e.rate), 1) / Math.max(e.games, 1)));
  ses.sort((a, b) => a - b);
  const med = ses[Math.floor(ses.length / 2)];
  return med * Math.sqrt(2 * Math.log(Math.max(entries.length, 2)));
}

/**
 * 某一条的比率偏离基准约几倍**它自己的**标准误。
 *
 * 注意它和 noiseCeiling 回答的是**不同问题**，两个一起给才不矛盾：
 *   · 这个数 = 「这一条比不比 0 大」（单次比较）
 *   · noiseCeiling = 「这一组里挑最大，最高本来就有这么大」（整组尺度）
 * 判断某一条值不值得信，看前者；判断「它是第一名」算不算证据，看后者。
 */
export function noiseMultiple(games: number, rate: number, base = 50): number {
  const se = Math.sqrt(Math.max(rate * (100 - rate), 1) / Math.max(games, 1));
  return se > 0 ? Math.abs(rate - base) / se : 0;
}
