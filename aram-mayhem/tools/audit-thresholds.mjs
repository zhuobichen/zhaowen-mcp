// 门槛登记与体检：把散在各模块里的裸数字登记出来，并算清每个**买到的是什么**。
//
// 两类数，是配套的：
//   · **样本门槛**（`opts.min* ?? N`）：决定「能不能看出这个差」
//   · **差值阈值**（`Math.abs(diff) < N`）：决定「看出多大的差才值得说」
// 只登记一半，两个数就对不上账 —— 门槛说「15 局就能下结论」，
// 而差值阈值要求的是「差 3 个百分点」，可 15 局根本分辨不出 3 个百分点。
// 所以这一版把两类都登记，并给差值阈值算出「要分辨它需要多少样本」。
//
// 用法：
//   node tools/audit-thresholds.mjs           # 检查（登记齐全 + 配对一致 + 文档不漂）
//   node tools/audit-thresholds.mjs --selftest
//   node tools/audit-thresholds.mjs --write   # 重新生成 docs/THRESHOLDS.md
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "docs/THRESHOLDS.md";
const read = (p) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

/**
 * 样本门槛登记表（`opts.X ?? N` 扫描出来的，必须全部有条目）。
 * why 写不出理由就写「未说明」—— 不要编一个听起来合理的，那比没有更坏，下一个人会照着改。
 */
const SAMPLE_REGISTRY = {
  // ---- get_my_matchups（一个分析里三个门槛）
  "lib/matchups.ts:analyzeMatchups:minGames": {
    tool: "get_my_matchups",
    splits: "对面出现过的英雄（约 170 个）",
    why: "实测（thresholds:sweep）：门槛从 5 升到 20，条目 132→8、点名英雄的残差从 -32.3 → -20.3 → -17.9 一路缩小（典型的「低门槛把噪声算进来了」）；**30 就一个都不剩**。整段比值都在 1.4~2.0，即任何门槛下都跟噪声分不开 —— 所以结论里必须带「样本太少」的折扣（代码里已经有）",
  },
  "lib/matchups.ts:analyzeMatchups:minChampionGames": {
    tool: "get_my_matchups",
    splits: "我玩过的英雄",
    why: "实测（thresholds:sweep）：门槛 5→20 时列出 22→0 个英雄，**20 就一个都没有了**；本号够样本的只有 2 个（霞 17 把、库奇 16 把）。它的作用只是「别把只玩过两三次的英雄列出来」，不是统计门槛 —— 但 15 这个数本身仍未说明",
  },
  "lib/matchups.ts:analyzeMatchups:perPairGames": {
    tool: "get_my_matchups",
    splits: "我×对面 的组合（英雄视角）",
    why: "实测（thresholds:sweep）：**这个门槛是惰性的** —— 本号那两个够样本的英雄（17 / 16 把），对位数在任何门槛（5~200）下都是 0。原因是它和外层的「英雄至少 15 把」互相打架：十几把摊到一百多个可能的对手上，没有谁碰得到 5 次。取值 5 是上一轮从 opts.minGames 拆出来时照抄的旧默认值，**没有任何依据**。处理方式：不改数（改了也没用，单元本来就薄），改成**在输出里说明为什么空** —— 「列不出对位：这个英雄只有 N 把，摊到一百多个可能的对手上，没有谁碰到 5 次以上」",
  },

  // ---- 队内名次那一族（三个分析各 15/15/20，分桶方式其实是同一套）
  "lib/contribution.ts:analyzeContribution:minGames": {
    tool: "get_my_contribution",
    splits: "队内名次档（第 1 / 2 / 3 / 4 及以后）",
    why: "**已与 get_combat_profile 合并成共用常量** `RANK_BUCKET_MIN_GAMES`（lib/thresholds.ts）—— 两处是同一套「队内名次分档」，原先各写了一个 15，数值碰巧一样，但改一处忘另一处不会有任何提示。取值 15 本身仍然**未说明**：实测（thresholds:sweep）它在 5~80 之间都不改变结论，没有任何观测支持 15 比别的更好",
  },
  "lib/combat-profile.ts:analyzeCombat:minGames": {
    tool: "get_combat_profile",
    splits: "队内名次档（同上，6 个指标各分一次）",
    why: "**已与 get_my_contribution 合并成共用常量** `RANK_BUCKET_MIN_GAMES`（lib/thresholds.ts）。get_my_tilt 的 20 是**有意独立**的（它分的是连败/连胜长度桶，不是队内名次，桶的含义与分布都不同），已在常量文件里注明。实测（thresholds:sweep）：这几处在 5~80 之间都不改变结论",
  },
  "lib/tilt.ts:analyzeTilt:minGames": {
    tool: "get_my_tilt",
    splits: "连败/连胜长度档",
    why: "实测（thresholds:sweep）：门槛 20→40→80 会依次把「连输 3 把及以上」那档挤出去（3 档→2 档→1 档），效应也跟着从 -6.0 缩到 -2.9。默认 20 保住了三档，是有意义的下限。**这次扫描正是发现它结论过度声称的起因**（详见 lib/tilt.ts 注释）",
  },

  // ---- get_my_patches
  "lib/patches.ts:analyzePatches:minGames": {
    tool: "get_my_patches",
    splits: "补丁（通常 5~10 个）",
    why: "只用于「列进明细」，不下结论",
  },
  "lib/patches.ts:analyzePatches:verdictMinGames": {
    tool: "get_my_patches",
    splits: "同上，但用于跨版本结论（第 216 行判定、第 294 行注释文本各读一次）",
    why: "刻意比列明细的门槛高 —— 列出来是陈述事实，下结论才有样本要求",
  },

  // ---- 对面阵容
  "lib/comps.ts:analyzeComps:minGames": {
    tool: "get_enemy_comps",
    splits: "对面 6 类标签 × 胜负",
    why: "实测（thresholds:sweep）：5~200 之间取值都不改变结论 —— 六类标签本来就都过线。效应（极差）只有 3.0pp，而噪声 4.6pp，比值 0.7：这个量级下根本看不出差别，门槛高低无所谓",
  },
  "lib/counters.ts:analyzeCounters:minItemGames": {
    tool: "get_counter_items",
    splits: "装备（成装约 150 件）",
    why: "实测（thresholds:sweep）：门槛 5→120 幸存条目一直是 50，说明这些装备本来就都过线，门槛不 bind；极差 23pp 全程不变（同样是最大值统计量，别当效应量）",
  },
  "lib/counters.ts:analyzeCounters:minBucketGames": {
    tool: "get_counter_items",
    splits: "对面阵容档 × 装备",
    why: "全库最高的门槛 —— 二维交叉，单元最多",
  },

  // ---- lib/empirical.ts：**一个文件 8 处、7 个函数**，之前只能合并成一行写「未说明为何不同」。
  //      键细到函数级之后才拆得开。
  //      量过之后这一族的样子：**多数不 bind**（单符文榜 100 保留 76%、其他玩家口径 30 保留 92%、
  //      羁绊 30 因为前提不成立而全程 0 条），只有符文对 60 是真的在筛（22164 个单元里留 455）。
  //      英雄×符文 20 是唯一**确实偏低**的一个（门槛 30 时效应就掉到 0.6 倍、60 局以上一条没有）。
  "lib/empirical.ts:empiricalAugments:minGames": {
    tool: "get_empirical_augments",
    splits: "符文（约 200 件，本号归档 2 万行符文记录）",
    why: "实测（thresholds:sweep）：277 件符文里，门槛 100 保留约 210 条（76%），噪声尺度 ±7.3pp —— **基本不 bind**（全归档 2 万行摊下来每件样本都够）。所以它更像「兜底，别把长尾露出来」，而不是在筛噪声。同族的另外两个口径见下面两条",
  },
  "lib/empirical.ts:empiricalPairs:minGames": {
    tool: "get_augment_pairs",
    splits: "符文两两组合（组合数远多于单件）",
    why: "实测（thresholds:sweep）：组合有 **22164 个单元**，门槛 60 下仍留 455 条（2%）—— 这个是**真的在 bind**。数字本身仍未说明（方向还是反的：单元比单件多两个数量级、门槛反而更低），但**后果已经在输出里处理了**：现在会算出「从 455 条里挑最大、光噪声就有 ±19pp」并逐条标出各自的倍数",
  },
  "lib/empirical.ts:augmentEmpirical:minGames": {
    tool: "get_augment（本机实证段）",
    splits: "单件符文（与 empiricalAugments 同类）",
    why: "**未说明**：与 empiricalAugments 是同一类统计（单件符文的胜率），门槛却是 60 vs 100。实测（thresholds:sweep）那边 100 保住 210/277 条（基本不 bind），这边 60 更松 —— 两者的差别没有依据，只是两处各写了一遍",
  },
  "lib/empirical.ts:othersAugmentRates:minGames": {
    tool: "get_augment / get_empirical_augments（对照口径）",
    splits: "其他人的符文使用率",
    why: "实测（thresholds:sweep）：它排除的只是我自己那 306 局（占全库 3861 的 8%），所以候选数与单符文榜**逐行完全相同**（266/262/261/…/179）。门槛 30 保留 256/277（92%），基本不筛。与单符文榜的 100 是同一种统计、两个口径，数字不同但都没什么筛选作用",
  },
  "lib/empirical.ts:checkSynergySets:minGames": {
    tool: "check_synergy_sets",
    splits: "羁绊（约几十套）",
    why: "实测（thresholds:sweep）：门槛 5~200 **全程 0 套够样本** —— 全库 3861 把里一次都没凑齐过。所以这个门槛本身不 bind，因为前提就不成立。工具的输出里已经说明了这是设计使然（羁绊要 4~8 件指定符文，而一局里多数人只有 4 个符文位），这条扫描只是**独立证实了它的那句话**",
  },
  "lib/empirical.ts:championAugmentEmpirical:minGames": {
    tool: "get_champion_guide（本机实证段）",
    splits: "英雄 × 符文（二维交叉，单元最多）",
    why: "实测（thresholds:sweep，按榜首样本量看）：门槛 5 时榜首是 5 局 100%（纯噪声）；20/25 时是 27 局 70.4%（约 2 倍标准误，临界）；30 时是 38 局 57.9%（0.6 倍，分不开）；**60 局以上一条都没有**。所以这个门槛确实偏低 —— 而且单元天生薄（玩得最多的英雄 264 局也凑不出 60 局的符文）。数字未说明，但**后果已在输出里处理**：get_champion_guide 现在逐条标「约是噪声的几倍」，首位不过 2 倍时表头降调成「可能特别搭，都还在噪声范围内」",
  },
  "lib/empirical.ts:synergyCheckText:minGames": {
    tool: "check_synergy_sets（输出层）",
    splits: "同上，第 648/677 行各读一次",
    why: "同一个选项在判定与文案里各读一次，值一致（30）",
  },

  // ---- 其余
  "lib/builds.ts:analyzeBuilds:minGames": {
    tool: "get_my_builds",
    splits: "装备 × 槽位（成装约 150 件，本号够样本的 30~50 件）",
    why: "实测（thresholds:sweep）：门槛从 5 升到 80，幸存条目 52→4，而「幸存者极差」从 69pp 一路缩到 5pp —— 典型的低门槛把噪声算进来了。但**极差是最大值统计量**（条目越多必然越大），不能当效应量读，所以这组数字只能说明「极差随门槛单调缩小」",
  },
  "lib/queue-stats.ts:queueStats:minGames": {
    tool: "get_queue_stats",
    splits: "队列（4~6 个）",
    why: "实测（thresholds:sweep）：门槛从 5 扫到 200，**幸存队列始终是 1 个** —— 这个号的局几乎全在一个队列里，门槛定多少都不影响结论。在玩多个模式的账号上才会起作用",
  },
  "lib/queue-stats.ts:queueStatsText:minGames": {
    tool: "get_queue_stats（输出层）",
    splits: "同上，注释文本里重读一次",
    why: "是同一个选项在文案里重读，值一致（10）。**但两处各写了一遍默认值**，改一处忘另一处就会让文案和判定对不上",
  },
  "lib/tft-detail.ts:tftDetail:minGames": {
    tool: "get_tft_detail",
    splits: "棋子 / 装备（本号够样本的 90~110 个棋子）",
    why: "实测（thresholds:sweep）：门槛 12→200，名次极差从 -4.3 缩到 -0.4，而比值一直在 0.5 上下 —— 整段都跟噪声分不开。也就是说棋子之间的名次差异这份数据看不出来，门槛高低都改变不了这一点",
  },
  "lib/leaderboard.ts:leaderboard:minGames": {
    tool: "get_friend_leaderboard",
    splits: "账号（个位数）",
    why: "上榜最低局数，不是统计门槛",
  },
  "lib/social.ts:analyzeSocial:minGames": {
    tool: "get_my_teammates（队友/对手榜）",
    splits: "队友 / 对手（本号同队过的 12 个账号）",
    why: "实测（thresholds:sweep）：门槛 5→40 幸存账号 12→2，极差 41pp→15.5pp，比值 1.9~2.1 卡在线上。默认 1 等于不过滤，但那个 41pp 是 12 个账号里的极差（同样是最大值统计量）",
  },
  "lib/social.ts:socialText:minGames": {
    tool: "get_my_teammates（结论段）",
    splits: "同上，判定用 1、下结论用 3",
    why: "同一个分析里两个门槛：榜单用 1（全列）、结论用 3（只对够局的账号下结论）—— 这个分层是有意的，但两处默认值不同且没有共用常量",
  },
  "lib/trend.ts:analyzeTrend:minGamesPerWeek": {
    tool: "get_my_trend",
    splits: "自然周",
    why: "未说明。5 局/周是全库最低的样本门槛，而它后面还要拿这个去下「有没有趋势」的结论 —— 实测（thresholds:sweep 相关那一节）：4 个有效周加起来也分辨不了 10 个百分点",
  },
};


/**
 * 差值阈值登记表：手动登记（这类写法太多样，扫不干净），但**核对值有没有被改**。
 * 每条带 `find`：在原文件里定位的那个片段，捕获组 1 必须是当前的值。
 * `unit`：pp=百分点、placement=云顶名次、min=分钟、share=比例。
 */
const DIFF_REGISTRY = [
  {
    key: "trend.lol",
    file: "lib/trend.ts",
    tool: "get_my_trend",
    what: "海斗周趋势：最近 4 个有效周 vs 之前 4 个，差多少才叫「有趋势」（现在按标准误倍数）",
    find: /[ (]k <= (\d+(?:\.\d+)?)/,
    unit: "se",
    why: "从固定 3pp 改成 2 倍标准误。实测：58 把 50.0% vs 42 把 40.5%，差 9.5pp 而噪声 10.0pp —— 原写法会报「是在变强」。口径：两个窗口各当成一个整体、按局数算标准误（周内不独立，已在结论里注明偏乐观）",
    hedged: false,
  },
  {
    key: "trend.tft",
    file: "lib/trend.ts",
    tool: "get_my_trend",
    what: "云顶周趋势：前段 vs 后段的平均名次差（现在按标准误倍数）",
    find: /\(kP <= (\d+(?:\.\d+)?)/,
    unit: "se",
    why: "从固定 0.2 名改成 2 倍标准误。名次标准差约 2.2，10 局时标准误就有 0.7 —— 固定 0.2 分不开。实测：3.75 → 4.56，差 0.80 而噪声 0.16（5.0 倍），是真结论",
    hedged: false,
  },
  {
    key: "patches.tft",
    file: "lib/patches.ts",
    tool: "get_my_patches",
    what: "云顶跨补丁：平均名次差多少才算「变好/变差」（现在按标准误倍数）",
    find: /k <= (\d+(?:\.\d+)?)/,
    unit: "se",
    why: "从固定 0.2 名改成 2 倍标准误：名次标准差约 2.2，15 局时均值差的标准误就有 0.57，固定的 0.2 分不开",
    hedged: false,
  },
  {
    key: "patches.lol",
    file: "lib/patches.ts",
    tool: "get_my_patches",
    what: "海斗跨补丁：胜率差多少才算「变好/变差」（现在按标准误倍数）",
    find: /\(kW <= (\d+(?:\.\d+)?)/,
    unit: "se",
    why: "从固定 3pp 改成 2 倍标准误，与云顶那边同口径。实测：27 局 vs 40 局差 4.4pp，噪声 12.3，0.36 倍 —— 原写法会报「新版好了 4.4」",
    hedged: false,
  },
  {
    key: "contribution",
    file: "lib/contribution.ts",
    tool: "get_my_contribution",
    what: "伤害队内第一 vs 第三及以后：差多少才算「有关系」（现在按标准误倍数，不再用固定百分点）",
    find: /if \(k < (\d+(?:\.\d+)?)\)/,
    unit: "se",
    // 原先是固定的 `Math.abs(top.winRate - lowWr) < 5`。门槛扫描（thresholds:sweep）量出
    // 这个号是 12.6pp / 标准误 6.4 = 1.97 倍 —— 固定 5pp 判它「差得明显」，太满。
    // 已改成按标准误倍数，与 lib/tilt.ts、lib/comps.ts 一致。
    why: "从固定 5pp 改成 2.5 倍标准误：固定阈值在 400 局的组里和 36 局的组里含义完全不同",
    hedged: false,
  },
  {
    key: "tilt",
    file: "lib/tilt.ts",
    tool: "get_my_tilt",
    what: "连败之后偏离基准多少才算「明显走低」（按标准误倍数）",
    find: /const significant = k > (\d+(?:\.\d+)?)/,
    unit: "se",
    why: "从固定 5pp 改成 2 倍标准误：原来的写法在 36 局的桶上会拿 6.0pp 当「明显」，而它的标准误有 8.3",
    hedged: false,
  },
  {
    key: "combat",
    file: "lib/combat-profile.ts",
    tool: "get_combat_profile",
    what: "队内第一 vs 垫底：差多少才算「这项跟胜负有关」（现在按标准误倍数）",
    find: /if \(k < (\d+(?:\.\d+)?)\)/,
    unit: "se",
    // 原先是固定的 `Math.abs(spread) < 5`，和 tilt / contribution 同一个毛病。
    // 实测这个号：承伤 12.7pp = 1.71 倍 → 原写法会说「这项做得多，赢得更多」，
    // 对目标伤害 -14.5pp = 2.02 倍 → 边缘。都改成按标准误倍数后如实标「卡在线上」。
    why: "从固定 5pp 改成 2.5 倍标准误；同时给结论补上了各自的局数（只报百分比没法核对，也推不出噪声）",
    hedged: false,
  },
  {
    key: "combat.duration",
    file: "lib/combat-profile.ts",
    tool: "get_combat_profile",
    what: "两组的**中位时长**差几分钟以内算「时长差不多」（用来排除「久局」这个解释）",
    find: /Math\.abs\(durationFirst - durationLast\) < (\d+(?:\.\d+)?)/,
    unit: "min",
    why: "不是统计阈值，是「时长可比」的实用判断",
    hedged: true,
  },
  {
    key: "compare.winrate",
    file: "lib/compare.ts",
    tool: "compare_accounts",
    what: "双账号：胜率差多少以内算「同一档」（现在按标准误倍数）",
    find: /if \(k < (\d+(?:\.\d+)?)\)/,
    unit: "se",
    why: "从固定 1.5pp 改成 1.5 倍标准误：两个账号局数常差很多，小号上固定 1.5pp 会得出「同一档」而噪声可能有好几个点。实测：差 1.9pp / 噪声 3.2（0.60 倍）",
    hedged: true,
  },
  {
    key: "compare.augment",
    file: "lib/compare.ts",
    tool: "compare_accounts",
    what: "双账号（文字版）：符文偏好差多少才值得列",
    find: /Math\.abs\(x\.gap\) >= (\d+(?:\.\d+)?)/,
    unit: "share",
    why: "与下面 report-compare 那条是同一个语义，值却不同",
    sameAs: "reportcompare.augment",
  },
  {
    key: "reportcompare.augment",
    file: "lib/report-compare.ts",
    tool: "export_compare_report",
    what: "双账号（HTML 版）：符文偏好差多少才值得列",
    find: /Math\.abs\(x\.gap\) >= (\d+(?:\.\d+)?)/,
    unit: "share",
    why: "与上面 compare.augment 是同一个语义",
    sameAs: "compare.augment",
  },
  {
    key: "report.gap",
    file: "lib/report.ts",
    tool: "（HTML 报告内部）",
    what: "某英雄胜率比同批人高多少个百分点才列进「高光」",
    find: /a\.gap >= (\d+(?:\.\d+)?)/,
    unit: "pp",
    why: "未说明",
    hedged: true,
  },
  {
    key: "comps.noise",
    file: "lib/comps.ts",
    tool: "get_enemy_comps",
    what: "对面标签间的极差要超过多少个标准误才算「有影响」",
    // 这条没有捕获组 —— 值直接声明（见下面 raw 的取法）
    find: /4 个标准误/,
    value: 4,
    unit: "se",
    why: "全库唯一一个**跟着样本量走**的差值判据（其余都是固定数字）—— 这是对的写法",
    hedged: true,
  },
  {
    key: "combat.degenerate",
    file: "lib/combat-profile.ts",
    tool: "get_combat_profile",
    what: "队内第一占比超过多少就认定「这项没有区分度」（退化检测，不是差值阈值）",
    find: /topShare > (\d+(?:\.\d+)?)/,
    unit: "share",
    why: "不是差值阈值，是「分组本身失效」的检测",
    hedged: true,
    // 不是「差多少才值得说」，所以不参与「要分辨它需要多少样本」那套换算 ——
    // 第一版没标这个，它被当成比例阈值算出「每组约 6 局」，纯属胡说
    notDiff: true,
  },
];

/**
 * 内联样本过滤登记表（第三类）。
 *
 * 为什么还要一张：前两张表的扫描只认 `opts.X ?? N`，而代码里还有一批**写死在过滤条件里**的
 * 阈值 —— 例如 buildsText 的「出了它胜率最高（≥10 把）」「出得多但胜率偏低（≥15 把）」。
 * 这些从来没被登记过，而登记表当时还在说「全部登记」。**扫描面不够，那句「全部」就是假的。**
 *
 * 分类：
 *   · 统计门槛 —— 它撑着一句主张（「胜率最高」「胜率偏低」），漏了会让结论没依据
 *   · 显示阈值 —— 只决定图表里哪些柱子标数字、哪段文字列出来，不影响任何主张
 */
const INLINE_REGISTRY = {
  "lib/builds.ts:buildsText:inline:>=10": {
    tool: "get_my_builds",
    kind: "统计门槛",
    why: "撑着「出了它胜率最高（≥10 把）」这句 —— 而它是在**所有 ≥10 把的装备里挑胜率最高**，是最大值统计量。实测（thresholds:sweep，按榜首样本量看）：门槛 5→15→30 时榜首分别是 6 局 83.3%（2.2 倍噪声）、18 局 77.8%（2.8 倍）、69 局 59.4%（1.6 倍）—— 10 把这一档榜首多半只有十来局，2 倍出头正是「从几十条里挑最大」能造出的水平",
  },
  "lib/builds.ts:buildsText:inline:>=15": {
    tool: "get_my_builds",
    kind: "统计门槛",
    why: "撑着「出得多但胜率偏低（≥15 把，可以考虑换）」。与上一条同源、方向相反；实测同上：15 把时榜首 18 局，倍数 2.8 —— 同样落在「挑最大」能造出的范围里",
  },
  "lib/checkup.ts:checkup:inline:>=15": {
    tool: "get_my_checkup",
    kind: "统计门槛",
    why: "未说明。它决定体检里哪些维度够格进「该看哪几条」",
  },
  "lib/compare.ts:profileOf:inline:>=5": {
    tool: "compare_accounts",
    kind: "统计门槛",
    why: "未说明。决定双账号对比里「常玩英雄」列出哪些",
  },
  "lib/compare.ts:compareAccounts:inline:>=10": {
    tool: "compare_accounts",
    kind: "统计门槛",
    why: "未说明。两处同值，决定「两人都拿过的符文」里胜率差最大的那几件从哪些里挑",
  },
  "lib/comps.ts:analyzeComps:inline:>=30": {
    tool: "get_enemy_comps",
    kind: "统计门槛",
    why: "与同文件的 opts.minGames 作用相同（哪些标签够格进极差比较），**但一个是参数默认值、一个是硬编码** —— 传了参数就绕开它，两处会不一致",
  },
  "lib/playstyle.ts:analyzeMyPlaystyle:inline:>=10": {
    tool: "analyze_my_playstyle",
    kind: "统计门槛",
    why: "未说明。两处同值，决定时段 / 英雄池统计里哪些分组够格",
  },
  "lib/report-tft.ts:weeklyPlacement:inline:<5": { tool: "（云顶 HTML 报告）", kind: "显示阈值", why: "图表里样本不足的柱子不标数字" },
  "lib/report-tft.ts:patchPlacement:inline:<15": { tool: "（云顶 HTML 报告）", kind: "显示阈值", why: "同上" },
  "lib/report-tft.ts:weekdayPlacement:inline:<15": { tool: "（云顶 HTML 报告）", kind: "显示阈值", why: "同上" },
  "lib/report.ts:collect:inline:>=3": { tool: "（海斗 HTML 报告）", kind: "显示阈值", why: "收集阶段的过滤，不直接对应某句话" },
  "lib/report.ts:weekdayChart:inline:<15": { tool: "（海斗 HTML 报告）", kind: "显示阈值", why: "图表里样本不足的柱子不标数字" },
  "lib/report.ts:damageRankBars:inline:<15": { tool: "（海斗 HTML 报告）", kind: "显示阈值", why: "同上" },
  "lib/report.ts:patchChart:inline:<15": { tool: "（海斗 HTML 报告）", kind: "显示阈值", why: "同上" },
  "lib/report.ts:weeklyChart:inline:<5": { tool: "（海斗 HTML 报告）", kind: "显示阈值", why: "同上" },
  "lib/report.ts:findings:inline:>=8": {
    tool: "（海斗 HTML 报告）",
    kind: "统计门槛",
    why: "撑着报告里「发现」那一段的几条结论。8 未说明，而且它比同一份报告别处用的 15 低不少",
  },
  "lib/report.ts:findings:inline:>=5": {
    tool: "（海斗 HTML 报告）",
    kind: "统计门槛",
    why: "**同一个函数里 8 和 5 并存**，未说明为何不同",
  },
  "lib/report.ts:advice:inline:>=8": {
    tool: "（海斗 HTML 报告）",
    kind: "统计门槛",
    why: "撑着「建议」那一段。与 findings 同值但没有共用常量",
  },
  "lib/report.ts:advice:inline:>=5": { tool: "（海斗 HTML 报告）", kind: "统计门槛", why: "同上" },
  "lib/report.ts:render:inline:>=5": { tool: "（海斗 HTML 报告）", kind: "显示阈值", why: "渲染阶段过滤" },
  "lib/tools.ts:championGuideAsync:inline:<30": {
    tool: "get_champion_guide",
    kind: "统计门槛",
    why: "「这个英雄在你归档里只打过 N 局，样本太少，不下结论」—— 这句判据本身，有意独立于符文层的门槛",
  },
};

/** 两个比例、每组 n 局时，95% 置信下能分辨的胜率差（百分点）。取 p=0.5 最坏情况。 */
const detectable = (n) => 1.96 * Math.sqrt(0.5 / n) * 100;
/** 反过来：要分辨 d 个百分点，每组需要多少局。 */
const nToResolve = (dPP) => Math.ceil(0.5 * Math.pow(1.96 / (dPP / 100), 2));

if (process.argv.includes("--selftest")) {
  const c1 = [[15, 36], [30, 25], [60, 18], [100, 14], [300, 8]];
  const c2 = [[3, 2135], [5, 769], [10, 193], [20, 49]];
  let bad = 0;
  for (const [n, want] of c1) {
    const got = Math.round(detectable(n));
    if (got !== want) { bad++; console.log(`✗ 可分辨差 n=${n} 期望 ~${want}pp，得到 ${got}pp`); }
    else console.log(`✓ 可分辨差 n=${n} → ${got}pp`);
  }
  for (const [d, want] of c2) {
    const got = nToResolve(d);
    // 允许 ±2 的取整差
    if (Math.abs(got - want) > 2) { bad++; console.log(`✗ 反解 ${d}pp 期望 ~${want} 局，得到 ${got} 局`); }
    else console.log(`✓ 反解 ${d}pp → 每组约 ${got} 局`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过` : `✓ 自测通过（${c1.length + c2.length} 条）`);
  process.exit(bad ? 1 : 0);
}

// ---- 扫描样本门槛
// 键要细到**函数**级：lib/empirical.ts 一个文件里有 8 处 `minGames`，分属 7 个函数
// （符文榜 100 / 组合 60 / 羁绊 30 / 英雄×符文 20…）。只用 `文件:变量名` 当键，
// 它们会被合并成一条，登记表里就只能写「同文件多个门槛，未说明为何不同」——
// 而那个「为何不同」正是要回答的问题。
// 共用常量也要认：`opts.minGames ?? RANK_BUCKET_MIN_GAMES` 这种写法没有裸数字，
// 只有一条正则认数字的话，两条门槛会被报成「已不存在」——
// 而把它们提成共用常量恰恰是这一版做的事（见 lib/thresholds.ts）。
const sharedConsts = new Map();
for (const m of read("lib/thresholds.ts").matchAll(/export const (\w+)[^=]*=\s*(\d+)/g)) {
  sharedConsts.set(m[1], Number(m[2]));
}

const found = [];
const unresolvedConsts = [];
/** 内联过滤（`.games >= N`）—— 按 key 合并 */
const inlineFound = new Map();
for (const f of readdirSync(path.join(ROOT, "lib")).filter((x) => x.endsWith(".ts"))) {
  let fn = "(顶层)";
  read(`lib/${f}`).split("\n").forEach((l, i) => {
    const fm = l.match(/^(?:export )?(?:async )?function (\w+)/);
    if (fm) fn = fm[1];
    for (const m of l.matchAll(/opts\.(\w+)\s*\?\?\s*(\d+|\w+)/g)) {
      if (!/^(min|verdictMin|perPair)/.test(m[1])) continue;
      const raw = m[2];
      let value;
      let viaConst = null;
      if (/^\d+$/.test(raw)) value = Number(raw);
      else if (sharedConsts.has(raw)) {
        value = sharedConsts.get(raw);
        viaConst = raw;
      } else {
        unresolvedConsts.push(`lib/${f}:${i + 1} 的 ${m[1]} ?? ${raw} —— 常量 ${raw} 不在 lib/thresholds.ts 里`);
        continue;
      }
      found.push({ file: `lib/${f}`, line: i + 1, name: m[1], value, fn, viaConst, key: `lib/${f}:${fn}:${m[1]}` });
    }
    // 第三类：**写死在过滤条件里**的样本阈值（`.games >= 10` 这种）。
    // 前两张表原先都看不见它们 —— 而它们照样撑着一句主张
    // （如 buildsText 的「出了它胜率最高（≥10 把）」）。扫描面不够，那句「全部登记」就是假的。
    // 排除 `> 0`：那是「别把空桶算进来」，不是样本门槛。
    for (const m of l.matchAll(/\.games\s*(>=|>|<|<=)\s*(\d+)/g)) {
      if (m[2] === "0") continue;
      const key = `lib/${f}:${fn}:inline:${m[1]}${m[2]}`;
      const cur = inlineFound.get(key) ?? { key, file: `lib/${f}`, fn, op: m[1], val: Number(m[2]), lines: [] };
      cur.lines.push(i + 1);
      inlineFound.set(key, cur);
    }
  });
}
const merged = new Map();
for (const t of found) {
  const cur = merged.get(t.key) ?? { ...t, values: new Set(), lines: [] };
  cur.values.add(t.value);
  cur.lines.push(t.line);
  merged.set(t.key, cur);
}
const problems = [...unresolvedConsts];
// 内联过滤也要登记 —— 这是「全部登记」这句话能不能成立的关键：前两张表看不见它们。
for (const k of inlineFound.keys()) {
  if (!INLINE_REGISTRY[k]) problems.push(`内联样本过滤没登记：${k}（${inlineFound.get(k).file}:${inlineFound.get(k).lines.join(",")}）`);
}
for (const k of Object.keys(INLINE_REGISTRY)) {
  if (!inlineFound.has(k)) problems.push(`登记表里的内联过滤已不存在：${k}`);
}
for (const k of merged.keys()) if (!SAMPLE_REGISTRY[k]) problems.push(`样本门槛没登记：${k} = ${[...merged.get(k).values].join("/")}（${merged.get(k).file}:${merged.get(k).lines.join(",")}）`);
for (const k of Object.keys(SAMPLE_REGISTRY)) if (!merged.has(k)) problems.push(`登记表里的样本门槛已不存在：${k}`);

// ---- 核对差值阈值（值有没有被改）
const diffs = [];
for (const d of DIFF_REGISTRY) {
  const src = read(d.file);
  const m = src.match(d.find);
  if (!m) {
    problems.push(`差值阈值定位失败：${d.key}（${d.file} 里找不到 ${d.find}）`);
    continue;
  }
  // 有捕获组就从源码里取值（顺便核对有没有被改动）；没有捕获组的用声明值
  const raw = m.slice(1).find((x) => x !== undefined) ?? d.value;
  diffs.push({ ...d, value: Number(raw) });
}
// 配对一致性：声明 sameAs 的两条必须同值
for (const d of diffs) {
  if (!d.sameAs) continue;
  const other = diffs.find((x) => x.key === d.sameAs);
  if (!other) { problems.push(`sameAs 指向不存在的条目：${d.key} → ${d.sameAs}`); continue; }
  // 只在 key 字典序靠前的那一侧报，否则同一处不一致会被报两遍（两个方向各一次）
  if (d.key > other.key) continue;
  if (other.value !== d.value) {
    problems.push(
      `同一语义的两个阈值不一致：${d.key}=${d.value} vs ${other.key}=${other.value}` +
        `（${d.tool} 与 ${other.tool} 讲的是同一件事，用户会看到两套结果）`
    );
  }
}

// ---- 渲染
function render() {
  const sampleRows = [...merged.entries()]
    .map(([k, t]) => ({ ...t, reg: SAMPLE_REGISTRY[k] }))
    .sort((a, b) => Math.min(...a.values) - Math.min(...b.values));
  const out = [];
  out.push("# 门槛登记表");
  out.push("");
  out.push("> 由 `npm run thresholds:doc` 生成（`tools/audit-thresholds.mjs`）。**不要手改**。");
  out.push("");
  out.push("这些数字散在各模块里，全库没有一处写明推导。这里把每个都登记出来，并算清它**买到的是什么**。");
  out.push("");
  out.push("## 一、样本门槛（决定「能不能看出这个差」）");
  out.push("");
  out.push("**可分辨差**：两组各 n 局、比胜率时，95% 置信下能分辨的最小差（百分点），算法 `1.96·√(0.5/n)`。");
  out.push("小于这个差，结论跟噪声分不开。");
  out.push("");
  out.push("| 门槛 | 值 | 位置 | 分的是什么桶 | 可分辨差 | 为什么是这个数 |");
  out.push("|---|---|---|---|---|---|");
  for (const r of sampleRows) {
    const vals = [...r.values].sort((a, b) => a - b);
    out.push(
      `| \`${r.name}\`${r.viaConst ? "（共用常量）" : ""} | ${vals.join(" / ")} | \`${r.file}:${r.lines.join(",")}\` | ${r.reg.splits} | ` +
        `${vals.map((v) => `${detectable(v).toFixed(0)}pp`).join(" / ")} | ${r.reg.why} |`
    );
  }
  out.push("");
  out.push("## 二、差值阈值（决定「看出多大的差才值得说」）");
  out.push("");
  out.push("**要分辨它需要多少局**：把阈值反解成所需样本（每组）。拿它跟该分析实际能拿到的样本比 ——");
  out.push("差得越远，说明这个阈值越像是「希望」而不是「能测出来的」。");
  out.push("");
  out.push("| 判据 | 值 | 位置 | 讲的是什么 | 要分辨它需要 | 为什么是这个数 |");
  out.push("|---|---|---|---|---|---|");
  for (const d of diffs) {
    const need =
      d.notDiff ? "不适用（不是差值阈值）"
      : d.unit === "pp" ? `每组约 ${nToResolve(d.value).toLocaleString("en-US")} 局`
      : d.unit === "share" ? `每组约 ${nToResolve(d.value * 100).toLocaleString("en-US")} 局`
      : "不适用（不是比例）";
    out.push(`| \`${d.key}\` | ${d.value}${d.unit === "pp" ? "pp" : d.unit === "min" ? " 分钟" : d.unit === "se" ? " 个标准误" : ""} | \`${d.file}\` | ${d.what} | ${need} | ${d.why} |`);
  }
  out.push("");
  out.push("## 三、这两类数要对得上账");
  out.push("");
  out.push("样本门槛决定「能不能看出这个差」，差值阈值决定「看出多大的差才值得说」—— 两者是配套的。");
  out.push("如果差值阈值对应的样本需求**远大于**该分析实际拿得到的样本，那它报出来的「有趋势/有关系」");
  out.push("就可能是噪声。这不是说数字写错了，而是说：**它现在只能当方向参考，不能当结论。**");
  out.push("");
  out.push(
    `**大部分已经改成按标准误倍数**（${diffs.filter((d) => d.unit === "se").length}/${diffs.length} 条）：` +
      "判据自己随样本量收紧，不再需要「这个数定多少」这种没法回答的问题。"
  );
  out.push("");
  out.push("**还剩下这些固定数字**，按「要分辨它需要的样本」从大到小排（同一语义的配对只列一次）：");
  out.push("");
  out.push("| 判据 | 阈值 | 要分辨它需要 | 该分析的典型样本 | 措辞有没有打折扣 |");
  out.push("|---|---|---|---|---|");
  const seenPair = new Set();
  const worst = diffs
    .filter((d) => !d.notDiff && (d.unit === "pp" || d.unit === "share"))
    .filter((d) => {
      if (!d.sameAs) return true;
      const pairKey = [d.key, d.sameAs].sort().join("|");
      if (seenPair.has(pairKey)) return false;
      seenPair.add(pairKey);
      return true;
    })
    .map((d) => ({ ...d, need: nToResolve(d.unit === "share" ? d.value * 100 : d.value) }))
    .sort((a, b) => b.need - a.need);
  for (const w of worst) {
    const pp = w.unit === "share" ? `${(w.value * 100).toFixed(1)}pp` : `${w.value}pp`;
    const typical = w.unit === "share" ? "分组样本通常几百" : "几十~几百局";
    out.push(`| \`${w.key}\` | ${pp} | 每组约 ${w.need.toLocaleString("en-US")} 局 | ${typical} | ${w.hedged ? "有" : "**没有**"} |`);
  }
  out.push("");
  out.push("改造的样板是 `lib/comps.ts`（4 个标准误）—— 它是全库第一个跟着样本量走的判据，");
  out.push("其余几处（tilt / contribution / combat-profile / compare_accounts / patches / trend）都是照着它改的。");
  out.push("剩两个固定的：`compare.augment` 是「出现比例差」，两侧样本按比例算不出干净的标准误，");
  out.push("`report.gap` 是展示用的「高光」门槛（不主张因果，所以措辞本身就带折扣）。");
  out.push("");
  const unstated = sampleRows.filter((r) => /未说明/.test(r.reg.why)).length + diffs.filter((d) => /未说明/.test(d.why)).length;
  out.push("## 四、内联在过滤条件里的阈值（第三类）");
  out.push("");
  out.push("上面两张表原先只扫 `opts.X ?? N`，**看不见这一类** —— 而它们照样撑着一句主张：");
  out.push("例如 `buildsText` 的「出了它胜率最高（≥10 把）」就是在**所有 ≥10 把的装备里挑胜率最高**。");
  out.push("登记表当时还在说「全部登记」——扫描面不够，那句话就是假的。");
  out.push("");
  out.push("| 位置 | 值 | 类别 | 撑着什么 / 为什么 |");
  out.push("|---|---|---|---|");
  const inlineRows = [...inlineFound.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const r of inlineRows) {
    const reg = INLINE_REGISTRY[r.key];
    out.push(`| \`${r.file}:${r.lines.join(",")}\` | \`.games ${r.op}${r.val}\` | ${reg?.kind ?? "?"} | ${reg?.why ?? "?"} |`);
  }
  const statCount = inlineRows.filter((r) => INLINE_REGISTRY[r.key]?.kind === "统计门槛").length;
  out.push("");
  out.push(`共 ${inlineRows.length} 处，其中 **${statCount} 处是统计门槛**（撑着一句主张）、${inlineRows.length - statCount} 处只影响图表显示。`);
  out.push("");
  out.push(`共 ${sampleRows.length} 个样本门槛 + ${diffs.length} 个差值阈值 + ${inlineRows.length} 处内联过滤登记在册；其中 ${unstated} 个的理由是「未说明」。`);
  out.push("理由写不出来就写「未说明」—— 不要编一个听起来合理的，那比没有更坏，下一个人会照着它改。");
  out.push("");
  out.push("## 怎么维护");
  out.push("");
  out.push("新增样本门槛（`opts.min* ?? N`）后，`npm run audit:thresholds` 会报「没登记」；");
  out.push("在 `SAMPLE_REGISTRY` 加条目。新增差值阈值则在 `DIFF_REGISTRY` 加条目（带定位用的 `find` 正则）。");
  out.push("声明为同一语义的两条（`sameAs`）值不一致时会直接报错。");
  return out.join("\n") + "\n";
}

if (process.argv.includes("--write")) {
  if (problems.length) {
    console.log("✗ 先把这些问题解决再生成：");
    for (const p of problems) console.log(`  · ${p}`);
    process.exit(1);
  }
  if (!existsSync(path.join(ROOT, "docs"))) mkdirSync(path.join(ROOT, "docs"));
  writeFileSync(path.join(ROOT, DOC), render(), "utf8");
  console.log(`✓ 已写出 ${DOC}（${merged.size} 个样本门槛 + ${diffs.length} 个差值阈值 + ${inlineFound.size} 处内联过滤）`);
  process.exit(0);
}

const docPath = path.join(ROOT, DOC);
if (!problems.length && (!existsSync(docPath) || read(DOC) !== render())) {
  problems.push(`${DOC} 与源码不一致（跑 npm run thresholds:doc 重生成）`);
}

console.log("");
for (const p of problems) console.log(`  ✗ ${p}`);
const unstated = [...merged.keys()].filter((k) => /未说明/.test(SAMPLE_REGISTRY[k]?.why ?? "")).length
  + diffs.filter((d) => /未说明/.test(d.why)).length;
console.log(
  problems.length
    ? `✗ 门槛登记有 ${problems.length} 处问题`
    : `✓ ${merged.size} 个样本门槛 + ${diffs.length} 个差值阈值 + ${inlineFound.size} 处内联过滤都已登记、配对一致、文档与源码同步（其中 ${unstated} 个理由是「未说明」）`
);
process.exit(problems.length ? 1 : 0);
