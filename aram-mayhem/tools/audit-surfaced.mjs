// 可见性审计：分析做了，但用户看得到吗？
//
// 判据一层层收紧（每收紧一次都会冒出新的缺口）：
//   1. audit:fields    字段被读过吗？        → 0 个未读
//   2. audit:analysis  字段被分析过吗？      → 34/34
//   3. 本脚本          分析结果出现在哪？    → 只在对话里返回、还是也进了报告/Markdown？
//
// 为什么这一层重要：MCP 工具的文本输出只有当场问才看得到；报告是能反复看、
// 能对比、能留档的东西。一个分析只活在工具输出里，等于「有，但你不会想起来用」。
//
// 判据的实现细节（前两版都错了，记下来）：
//   · 第一版查 index.ts 里 `from "./x.js"` —— 实际是 `from "./lib/x.js"`，于是全判 ✗
//   · 第一版还拿「报告有没有 import 这个模块」当证据 —— 但报告里很多东西是**内联算的**
//     （队内名次、周趋势、按补丁都是），不 import 也算有。改成查**生成出来的图注**。
import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

// 分析模块 → { 标签, 在报告里对应什么关键词 }；关键词按实际图注/小节标题写
// 每一项都要给关键词 —— 留空的话它永远匹配不上，等于这个检查对那几项是瞎的
// （第三版就是这个毛病：5 项关键词留空，报告里明明加了还说「没有」）
const ANALYSIS = [
  ["comps", "对面阵容构成", ["对面阵容构成"]],
  ["counters", "对面阵容 → 赢家出装", ["赢家出什么"]],
  ["matchups", "英雄对位残差", ["对位残差"]],
  ["builds", "我的出装", ["出装与胜率"]],
  ["social", "队友 / 对手", ["常一起打的人"]],
  ["contribution", "队内名次 vs 胜负", ["队内排第几"]],
  ["combat-profile", "伤害以外的贡献（承伤/控制/治疗/存活/目标伤害）", ["伤害以外的贡献"]],
  ["tilt", "连败 / 连胜之后的表现", ["连败 / 连胜之后的表现"]],
  ["trend", "周趋势", ["逐周场次"]],
  ["patches", "按补丁看自己", ["按补丁的胜率"]],
  ["queue-stats", "按队列拆分", ["按队列拆分"]],
  ["empirical", "符文/组合/羁绊实证", ["符文使用效果"]],
];

// 真的生成一份 demo 报告，拿它的图注当证据 —— 比猜 import 靠谱
const tmp = mkdtempSync(path.join(tmpdir(), "mayhem-audit-"));
const reports = {};
for (const [file, label] of [
  ["lib/report.ts", "海斗"],
  ["lib/report-tft.ts", "云顶"],
]) {
  const out = path.join(tmp, `${label}.html`);
  try {
    execFileSync("node", ["node_modules/tsx/dist/cli.mjs", file, "--demo", "--out", out], {
      cwd: ROOT,
      stdio: "pipe",
    });
    const html = readFileSync(out, "utf8");
    // 两种证据都算：图注（figcaption）和「深入分析」小节标题（h3）。
    // 后者是做可见性审计时补的 —— 那几项是表格式结论，不适合画图。
    reports[label] = [
      ...[...html.matchAll(/<span class="fignum">图 \d+\.<\/span>([^<]*)/g)].map((m) => m[1]),
      ...[...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]),
    ];
  } catch (e) {
    reports[label] = null;
  }
}

const indexText = read("index.ts");
const mdText = read("lib/report-md.ts");

console.log(`分析模块 ${ANALYSIS.length} 个`);
console.log(`报告图注：海斗 ${reports["海斗"]?.length ?? "?"} 张 · 云顶 ${reports["云顶"]?.length ?? "?"} 张\n`);
console.log("分析".padEnd(34) + "MCP工具   海斗报告");
console.log("-".repeat(76));

const missing = [];
for (const [base, label, keywords] of ANALYSIS) {
  const hasTool = new RegExp('from "\\./lib/' + base + '\\.js"').test(indexText);
  const caps = reports["海斗"] ?? [];
  const hit = caps.find((c) => keywords.some((k) => c.includes(k)));
  console.log(
    label.padEnd(32) + (hasTool ? "  ✓" : "  ✗") + "        " + (hit ? "✓ " + hit.slice(0, 26) : "✗ 没有")
  );
  if (!hit) missing.push({ base, label, inMd: mdText.includes(base) });
}

console.log("");
if (missing.length) {
  console.log(`⚠ ${missing.length} 个分析的结果只活在 MCP 工具输出里，没进海斗报告：`);
  for (const r of missing) console.log(`  · ${r.label}${r.inMd ? "（Markdown 里有）" : ""}`);
  console.log("\n不是 bug，但意味着：不问就看不到、也没法对比和留档。");
} else {
  console.log("所有分析都在报告里有体现。");
}
