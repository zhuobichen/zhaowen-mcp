// 样本门槛登记与体检：每个「至少 N 局才下结论」的门槛，都要登记，并且算出它买到的是什么。
//
// 为什么要做：这些数是散在各个 lib/ 模块里的裸数字（8/12/15/20/30/60/100/150/300…），
// 全库没有一处写明了推导。裸数字的危险不是「可能写错」，而是**没人知道它对不对** ——
// 改它的时候只能靠感觉，也没法判断某个结论是否撑得起它那句话。
//
// 所以这里做两件事：
//   1. **登记**：每个门槛都要在下面的 REGISTRY 里有条目（新增门槛不登记就报错）。
//   2. **体检**：算出这个门槛在 95% 置信下能分辨多大的胜率差，写进文档。
//      两个比例、每组 n 局时，可分辨差 ≈ 1.96·√(0.5/n)（取 p≈0.5 最坏情况）。
//      这一步把「N 局」翻译成「能看出多少个百分点」，门槛够不够就一目了然了。
//
// 用法：
//   node tools/audit-thresholds.mjs           # 检查（登记齐全 + 文档不漂）
//   node tools/audit-thresholds.mjs --write   # 重新生成 docs/THRESHOLDS.md
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "docs/THRESHOLDS.md";

/**
 * 登记表。每条：这个门槛用在哪、分的是什么桶、为什么是这个数。
 * key 形如 "文件:变量名"；value 里 why 必须写实话 —— 想不出来就写「未说明」，
 * 不要编一个听起来合理的理由（那比没有更坏，下一个人会照着它改）。
 */
const REGISTRY = {
  "lib/matchups.ts:minGames": { tool: "get_my_matchups", splits: "对面出现过的英雄（约 170 个）", why: "未说明" },
  "lib/matchups.ts:minChampionGames": { tool: "get_my_matchups", splits: "我玩过的英雄", why: "未说明" },
  "lib/matchups.ts:perPairGames": {
    tool: "get_my_matchups",
    splits: "我×对面 的组合（英雄视角）",
    why: "未说明。原先是读 opts.minGames 的，跟整体视角共用输入但默认值不同 —— 已拆开（见该文件注释）",
  },

  "lib/contribution.ts:minGames": { tool: "get_my_contribution", splits: "队内名次档（第 1 / 2 / 3 / 4 及以后）", why: "未说明" },
  "lib/combat-profile.ts:minGames": { tool: "get_combat_profile", splits: "队内名次档（同上）", why: "未说明" },
  "lib/tilt.ts:minGames": { tool: "get_my_tilt", splits: "连败/连胜长度档", why: "未说明" },
  "lib/patches.ts:minGames": { tool: "get_my_patches", splits: "补丁（通常 5~10 个）", why: "只用于「列进明细」，不下结论" },
  "lib/patches.ts:verdictMinGames": { tool: "get_my_patches", splits: "同上，但用于跨版本结论", why: "刻意比列明细的门槛高 —— 列出来是陈述事实，下结论才有样本要求" },

  "lib/comps.ts:minGames": { tool: "get_enemy_comps", splits: "对面 6 类标签 × 胜负", why: "未说明" },
  "lib/counters.ts:minItemGames": { tool: "get_counter_items", splits: "装备（成装约 150 件）", why: "未说明" },
  "lib/counters.ts:minBucketGames": { tool: "get_counter_items", splits: "对面阵容档 × 装备", why: "全库最高的门槛 —— 二维交叉，单元最多" },

  "lib/empirical.ts:minGames": { tool: "get_empirical_augments 等", splits: "符文 / 组合 / 羁绊（该文件有 6 处不同门槛）", why: "同一个文件里 20/30/60/100 都出现了，未说明为何不同" },
  "lib/builds.ts:minGames": { tool: "get_my_builds", splits: "装备 × 槽位", why: "未说明" },
  "lib/queue-stats.ts:minGames": { tool: "get_queue_stats", splits: "队列（4~6 个）", why: "未说明" },
  "lib/tft-detail.ts:minGames": { tool: "get_tft_detail", splits: "棋子 / 装备", why: "未说明" },
  "lib/leaderboard.ts:minGames": { tool: "get_friend_leaderboard", splits: "账号（个位数）", why: "上榜最低局数，不是统计门槛" },
  "lib/trend.ts:minGamesPerWeek": { tool: "get_my_trend", splits: "自然周", why: "未说明" },
  "lib/social.ts:minGames": { tool: "get_my_teammates", splits: "队友 / 对手", why: "未说明" },
};

/** 两个比例、每组 n 局时，95% 置信下能分辨的胜率差（百分点）。取 p=0.5 最坏情况。 */
function detectableDiff(n) {
  return 1.96 * Math.sqrt(0.5 / n) * 100;
}

// ---- 扫描源码里的门槛
const thresholdRe = /opts\.(\w+)\s*\?\?\s*(\d+)/g;
const found = [];
for (const f of readdirSync(path.join(ROOT, "lib")).filter((x) => x.endsWith(".ts"))) {
  const lines = readFileSync(path.join(ROOT, "lib", f), "utf8").replace(/\r\n/g, "\n").split("\n");
  lines.forEach((l, i) => {
    for (const m of l.matchAll(thresholdRe)) {
      const [, name, val] = m;
      // 只看「样本门槛」语义的：min* / verdictMin* / perPair
      if (!/^(min|verdictMin|perPair)/.test(name)) continue;
      found.push({ file: `lib/${f}`, line: i + 1, name, value: Number(val), key: `lib/${f}:${name}` });
    }
  });
}
// 同一个 key 出现多次（如 empirical 里 6 处）时合并，值列全
const merged = new Map();
for (const t of found) {
  const cur = merged.get(t.key) ?? { ...t, values: new Set(), lines: [] };
  cur.values.add(t.value);
  cur.lines.push(t.line);
  merged.set(t.key, cur);
}

const unregistered = [...merged.keys()].filter((k) => !REGISTRY[k]);
const staleRegistry = Object.keys(REGISTRY).filter((k) => !merged.has(k));

// ---- 生成文档
function render() {
  const rows = [...merged.entries()]
    .map(([k, t]) => ({ ...t, reg: REGISTRY[k] }))
    .sort((a, b) => Math.min(...a.values) - Math.min(...b.values));
  const unstated = rows.filter((r) => /未说明/.test(r.reg?.why ?? "")).length;
  const out = [];
  out.push("# 样本门槛登记表");
  out.push("");
  out.push("> 由 `npm run thresholds:doc` 生成（`tools/audit-thresholds.mjs`）。**不要手改**。");
  out.push("");
  out.push("这些「至少 N 局才下结论」的数是散在各模块里的裸数字，全库没有一处写明推导。");
  out.push("这里把每个都登记出来，并算清它**买到的是什么** —— 门槛够不够，看最后一列比看数字直观。");
  out.push("");
  out.push("**可分辨差**：两组各 n 局、比胜率时，95% 置信下能分辨的最小差（百分点）。");
  out.push("算法 `1.96·√(0.5/n)`，取 p≈0.5 的最坏情况。约等于说：小于这个差，结论跟噪声分不开。");
  out.push("");
  out.push("| 门槛 | 值 | 位置 | 分的是什么桶 | 可分辨差 | 为什么是这个数 |");
  out.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    const vals = [...r.values].sort((a, b) => a - b).join(" / ");
    const diffs = [...r.values].sort((a, b) => a - b).map((v) => `${detectableDiff(v).toFixed(0)}pp`).join(" / ");
    out.push(
      `| \`${r.name}\` | ${vals} | \`${r.file}:${r.lines.join(",")}\` | ${r.reg.splits} | ${diffs} | ${r.reg.why} |`
    );
  }
  out.push("");
  out.push("## 怎么看这张表");
  out.push("");
  out.push("- **可分辨差大于你要讲的那句话，那个结论就撑不起来。** 例如门槛 15 局只能分辨 ~36 个");
  out.push("  百分点的差 —— 想讲「这项做得多就赢得多」，得那个差真的很大才行。");
  out.push("- 全库最高的是 `minBucketGames`（300 局 → 可分辨 ~8pp），最低的是 `minGamesPerWeek`（5 局 →");
  out.push("  ~62pp）。这两个差得很远是对的：分桶越多、单元越细，每个桶需要的样本越多。");
  out.push("- 但**同类语义用了不同数字且没写理由**的地方仍然存在（见表中「未说明」）。");
  out.push("  这不是 bug，是「没人知道该是多少」—— 记在这里，改的时候至少知道自己在改一个有记录的空缺。");
  out.push("");
  out.push(`共 ${rows.length} 个门槛登记在册，其中 ${unstated} 个的理由是「未说明」。`);
  out.push("");
  out.push("## 怎么维护");
  out.push("");
  out.push("新增一个样本门槛（`opts.min* ?? N`）后，`npm run audit:thresholds` 会报「有门槛没登记」。");
  out.push("在 `tools/audit-thresholds.mjs` 的 `REGISTRY` 里加上条目再 `npm run thresholds:doc`。");
  out.push("**理由写不出来就写「未说明」**，不要编一个听起来合理的 —— 那比没有更坏，下一个人会照着它改。");
  return out.join("\n") + "\n";
}

if (process.argv.includes("--selftest")) {
  // 判据自测：可分辨差的算法本身
  const cases = [[15, 36], [30, 25], [60, 18], [100, 14], [300, 8]];
  let bad = 0;
  for (const [n, want] of cases) {
    const got = Math.round(detectableDiff(n));
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} n=${n} 期望 ~${want}pp，得到 ${got}pp`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过` : `✓ 自测通过（${cases.length} 条）`);
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--write")) {
  if (unregistered.length) {
    console.log("✗ 有门槛没登记，先把它们加进 REGISTRY：");
    for (const k of unregistered) console.log(`  · ${k}（值 ${[...merged.get(k).values].join("/")}，${merged.get(k).file}:${merged.get(k).lines.join(",")}）`);
    process.exit(1);
  }
  if (!existsSync(path.join(ROOT, "docs"))) mkdirSync(path.join(ROOT, "docs"));
  writeFileSync(path.join(ROOT, DOC), render(), "utf8");
  console.log(`✓ 已写出 ${DOC}（${merged.size} 个门槛）`);
  process.exit(0);
}

// ---- 默认：检查
let problems = 0;
if (unregistered.length) {
  problems += unregistered.length;
  console.log("✗ 这些样本门槛没登记（新增的话请在 REGISTRY 里加一条）：");
  for (const k of unregistered) console.log(`  · ${k} = ${[...merged.get(k).values].join("/")}（${merged.get(k).file}:${merged.get(k).lines.join(",")}）`);
}
if (staleRegistry.length) {
  problems += staleRegistry.length;
  console.log("✗ 登记表里这些条目已经不存在了（门槛被删或改名）：");
  for (const k of staleRegistry) console.log(`  · ${k}`);
}
// 登记的值跟源码对不对得上
for (const [k, t] of merged) {
  const reg = REGISTRY[k];
  if (!reg) continue;
  const want = reg.value;
  if (want !== undefined && !t.values.has(want)) {
    problems++;
    console.log(`✗ ${k} 登记的值是 ${want}，源码里是 ${[...t.values].join("/")}`);
  }
}
if (!problems) {
  const docPath = path.join(ROOT, DOC);
  const drifted = !existsSync(docPath) || readFileSync(docPath, "utf8").replace(/\r\n/g, "\n") !== render();
  if (drifted) {
    problems++;
    console.log(`✗ ${DOC} 与源码不一致（跑 npm run thresholds:doc 重生成）`);
  }
}
console.log("");
const unstated = [...merged.keys()].filter((k) => /未说明/.test(REGISTRY[k]?.why ?? "")).length;
console.log(
  problems
    ? `✗ 样本门槛登记有 ${problems} 处问题`
    : `✓ ${merged.size} 个样本门槛都已登记、文档与源码一致（其中 ${unstated} 个的理由是「未说明」）`
);
process.exit(problems ? 1 : 0);
