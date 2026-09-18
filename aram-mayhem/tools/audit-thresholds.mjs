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
  "lib/matchups.ts:minGames": {
    tool: "get_my_matchups",
    splits: "对面出现过的英雄（约 170 个）",
    why: "实测（thresholds:sweep）：门槛从 5 升到 20，点名英雄的残差从 -32.3 → -20.3 → -17.9 一路缩小 —— 典型的「低门槛把噪声算进来了」。默认 12 时比值 1.4，跟噪声分不开，所以结论里必须带「样本太少」的折扣（代码里已经有）",
  },
  "lib/matchups.ts:minChampionGames": { tool: "get_my_matchups", splits: "我玩过的英雄", why: "未说明" },
  "lib/matchups.ts:perPairGames": {
    tool: "get_my_matchups",
    splits: "我×对面 的组合（英雄视角）",
    why: "未说明。原先是读 opts.minGames 的，跟整体视角共用输入但默认值不同 —— 已拆开（见该文件注释）",
  },

  "lib/contribution.ts:minGames": {
    tool: "get_my_contribution",
    splits: "队内名次档（第 1 / 2 / 3 / 4 及以后）",
    why: "实测（thresholds:sweep）：5~80 之间取值都不改变结论的数值 —— 它只决定「够不够下结论」，不改变效应本身。效应 12.6pp / 标准误 6.4 / 比值 2.0，在临界。这个号 306 局的量级下，门槛定多少都一样",
  },
  "lib/combat-profile.ts:minGames": { tool: "get_combat_profile", splits: "队内名次档（同上）", why: "未说明" },
  "lib/tilt.ts:minGames": {
    tool: "get_my_tilt",
    splits: "连败/连胜长度档",
    why: "实测（thresholds:sweep）：门槛 20→40→80 会依次把「连输 3 把及以上」那档挤出去（3 档→2 档→1 档），效应也跟着从 -6.0 缩到 -2.9。默认 20 保住了三档，是有意义的下限。**这次扫描正是发现它结论过度声称的起因**（详见 lib/tilt.ts 注释）",
  },
  "lib/patches.ts:minGames": { tool: "get_my_patches", splits: "补丁（通常 5~10 个）", why: "只用于「列进明细」，不下结论" },
  "lib/patches.ts:verdictMinGames": {
    tool: "get_my_patches",
    splits: "同上，但用于跨版本结论",
    why: "刻意比列明细的门槛高 —— 列出来是陈述事实，下结论才有样本要求",
  },

  "lib/comps.ts:minGames": {
    tool: "get_enemy_comps",
    splits: "对面 6 类标签 × 胜负",
    why: "实测（thresholds:sweep）：5~200 之间取值都不改变结论 —— 六类标签本来就都过线。效应（极差）只有 3.0pp，而噪声 4.6pp，比值 0.7：这个量级下根本看不出差别，门槛高低无所谓",
  },
  "lib/counters.ts:minItemGames": { tool: "get_counter_items", splits: "装备（成装约 150 件）", why: "未说明" },
  "lib/counters.ts:minBucketGames": { tool: "get_counter_items", splits: "对面阵容档 × 装备", why: "全库最高的门槛 —— 二维交叉，单元最多" },

  "lib/empirical.ts:minGames": {
    tool: "get_empirical_augments 等",
    splits: "符文 / 组合 / 羁绊（该文件有 6 处不同门槛）",
    why: "同一个文件里 20/30/60/100 都出现了，未说明为何不同",
  },
  "lib/builds.ts:minGames": { tool: "get_my_builds", splits: "装备 × 槽位", why: "未说明" },
  "lib/queue-stats.ts:minGames": { tool: "get_queue_stats", splits: "队列（4~6 个）", why: "未说明" },
  "lib/tft-detail.ts:minGames": { tool: "get_tft_detail", splits: "棋子 / 装备", why: "未说明" },
  "lib/leaderboard.ts:minGames": { tool: "get_friend_leaderboard", splits: "账号（个位数）", why: "上榜最低局数，不是统计门槛" },
  "lib/trend.ts:minGamesPerWeek": { tool: "get_my_trend", splits: "自然周", why: "未说明" },
  "lib/social.ts:minGames": { tool: "get_my_teammates", splits: "队友 / 对手", why: "未说明" },
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
const found = [];
for (const f of readdirSync(path.join(ROOT, "lib")).filter((x) => x.endsWith(".ts"))) {
  read(`lib/${f}`).split("\n").forEach((l, i) => {
    for (const m of l.matchAll(/opts\.(\w+)\s*\?\?\s*(\d+)/g)) {
      if (!/^(min|verdictMin|perPair)/.test(m[1])) continue;
      found.push({ file: `lib/${f}`, line: i + 1, name: m[1], value: Number(m[2]), key: `lib/${f}:${m[1]}` });
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
const problems = [];
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
      `| \`${r.name}\` | ${vals.join(" / ")} | \`${r.file}:${r.lines.join(",")}\` | ${r.reg.splits} | ` +
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
  out.push(`共 ${sampleRows.length} 个样本门槛 + ${diffs.length} 个差值阈值登记在册；其中 ${unstated} 个的理由是「未说明」。`);
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
  console.log(`✓ 已写出 ${DOC}（${merged.size} 个样本门槛 + ${diffs.length} 个差值阈值）`);
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
    : `✓ ${merged.size} 个样本门槛 + ${diffs.length} 个差值阈值都已登记、配对一致、文档与源码同步（其中 ${unstated} 个理由是「未说明」）`
);
process.exit(problems.length ? 1 : 0);
