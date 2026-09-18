// 健康报告：把 13 个审计跑一遍，汇成一张表 + 一份 Markdown。
//
// 为什么要它：`npm run audit` 已经把 13 个审计串起来了，但输出是十几段各自为政的文本，
// 想看「现在到底什么状态」得从头读到尾。这份只保留**每个审计的结论行**，
// 一眼看全，并且能存成文件对照历史。
//
// 用法：
//   node tools/audit-health.mjs              # 跑全部（约 3~5 分钟）
//   node tools/audit-health.mjs --md out.md  # 同时写一份 Markdown
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

// 每个审计：脚本、跑几次（有的要正反两个方向）、最后一行是结论行
const AUDITS = [
  { key: "fields", title: "字段审计", cmd: ["tools/audit-fields.mjs"], what: "归档采集的字段有没有「采了但从没被读」的" },
  { key: "analysis", title: "分析审计", cmd: ["tools/audit-analysis.mjs"], what: "字段是「被读过」还是「真被分析过」" },
  { key: "wiring", title: "接线审计", cmd: ["tools/audit-wiring.mjs"], what: "游离文件/死代码/工具↔文档↔scripts 是否对得上" },
  { key: "surfaced", title: "可见性审计", cmd: ["tools/audit-surfaced.mjs"], what: "分析结果有没有进报告" },
  { key: "help", title: "引导覆盖", cmd: ["tools/audit-help.mjs"], what: "每个工具能否从场景引导里被找到" },
  { key: "length", title: "输出长度", cmd: ["tools/audit-length.mjs"], what: "真的调一遍量行数，超过 120 行就报" },
  { key: "coldstart", title: "冷启动", cmd: ["tools/audit-coldstart.mjs"], what: "空归档+离线时会不会只回空壳" },
  { key: "healthy", title: "冷启动反向", cmd: ["tools/audit-coldstart.mjs", "--healthy"], what: "有数据时**不该**被补「没有数据」提示" },
  { key: "consistency", title: "跨工具一致", cmd: ["tools/audit-consistency.mjs"], what: "同一个数在各工具里是否一致" },
  { key: "verdict", title: "结论自洽", cmd: ["tools/audit-verdict.mjs"], what: "结论引用的数字能否在自己的明细里找到" },
  { key: "direction_self", title: "方向判据自测", cmd: ["tools/audit-verdict-direction.mjs", "--selftest"], what: "方向判据本身会不会报警" },
  { key: "direction", title: "结论方向", cmd: ["tools/audit-verdict-direction.mjs"], what: "方向词与数字符号是否一致、点名的是否极值" },
  { key: "confidence_self", title: "置信判据自测", cmd: ["tools/audit-confidence.mjs", "--selftest"], what: "置信判据本身会不会报警" },
  { key: "confidence", title: "置信措辞", cmd: ["tools/audit-confidence.mjs"], what: "说「可以当真」时点名的对象样本够不够" },
  { key: "recompute", title: "与原始数据对账", cmd: ["tools/audit-recompute.mjs"], what: "工具报的数 vs 独立重算（唯一有外部真值的一层）" },
];
const MARK = { pass: "✓", warn: "⚠", fail: "✗" };
const LABEL = { pass: "通过", warn: "注意", fail: "失败" };

/**
 * 从一份审计的原始输出里判定它的状态。
 *
 * 结论行 = 最后一个非空行，但如果它是「悬空小标题」（以：结尾、下面没内容）就往前退。
 * 第一版这里挑的是「最后一行带 ✓/✗ 的」，结果把接线审计的**子项**
 * （「✓ 所有 probe / CLI 都有配套 npm script」）当成了整份审计的结论。
 *
 * 档位取自结论行前缀，**不**取自退出码 —— 有的审计按自己的语义「有疑点但不算错」
 * （如 analysis：未分析≠缺口、surfaced：没进报告≠bug），故意返回 0；
 * 只看退出码会把 ⚠ 显示成通过，那就等于把它们的提醒吞掉了。
 */
function classify(out, code) {
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  let verdict = "(无输出)";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].endsWith("：")) {
      verdict = lines[i];
      break;
    }
  }
  // 硬信号（退出码、✗）优先于软信号（⚠）：脚本自己声明了失败，就不能被一句 ⚠ 降级成「注意」。
  const level = code !== 0 || /^✗/.test(verdict) ? "fail" : /^⚠/.test(verdict) ? "warn" : "pass";
  return { level, verdict: verdict.replace(/^[✓⚠✗]\s*/, "") };
}

if (argv.includes("--selftest")) {
  // 这一层的 ⚠ 档从来没被真实触发过 —— 没失败过的判据不算判据。
  // 用合成输出把三档、以及「悬空小标题要往前退」都测一遍。
  const cases = [
    ["✓ 34 个采集字段全部至少被一个模块读过", 0, "pass"],
    ["⚠ 34 个字段中 2 个只被搬运、没被判断", 0, "warn"],
    ["✗ 3 个工具的输出超长", 1, "fail"],
    ["全部通过。", 0, "pass"],
    // 悬空小标题：最后一行是标题，结论在它上面。
    // 这条必须能**区分**出「跳标题」这个逻辑 —— 去掉跳标题后，判据会读到
    // 「它们在归档里的实际情况：」（无前缀、退出码 0）而误判成 pass，
    // 所以期望值刻意取了跟 pass 不同的 warn。
    ["⚠ 2 个字段需人看一眼\n\n它们在归档里的实际情况：\n", 0, "warn"],
    // 退出码非零但结论行没写 ✗ —— 按失败算（退出码兜底）
    ["好像出了点问题", 1, "fail"],
    // 空输出
    ["", 1, "fail"],
    // ⚠ 但退出码是 1：算失败 —— 退出码是硬信号，不能被一句 ⚠ 降级
    ["⚠ 有疑点", 1, "fail"],
    // ✗ 但退出码是 0：也算失败，✗ 是脚本自己写的
    ["✗ 对不上", 0, "fail"],
  ];
  let bad = 0;
  for (const [out, code, want] of cases) {
    const got = classify(out, code).level;
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} 期望 ${want}，得到 ${got}：${JSON.stringify(out.slice(0, 44))}`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过` : `✓ 自测通过（${cases.length} 条）`);
  process.exit(bad ? 1 : 0);
}

const rows = [];
for (const a of AUDITS) {
  const started = Date.now();
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, a.cmd, { cwd: ROOT, encoding: "utf8", timeout: 900000 });
  } catch (e) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
    code = e.status ?? 1;
  }
  const { level, verdict } = classify(out, code);
  rows.push({ ...a, level, verdict, ms: Date.now() - started });
  process.stdout.write(`${MARK[level]} ${a.title}\n`);
}

const w = Math.max(...rows.map((r) => [...r.title].reduce((n, c) => n + (/[一-龥]/.test(c) ? 2 : 1), 0)));
const pad = (s) => s + " ".repeat(Math.max(0, w - [...s].reduce((n, c) => n + (/[一-龥]/.test(c) ? 2 : 1), 0)));

console.log("\n================ 健康报告 ================");
console.log(`${pad("审计")}  结果  结论`);
for (const r of rows) {
  console.log(`${pad(r.title)}  ${MARK[r.level]} ${LABEL[r.level]}  ${r.verdict.slice(0, 88)}`);
}
const passed = rows.filter((r) => r.level === "pass").length;
const warned = rows.filter((r) => r.level === "warn").length;
const failed = rows.filter((r) => r.level === "fail").length;
console.log(
  `\n${passed}/${rows.length} 通过` +
    (warned ? ` · ${warned} 需人看一眼` : "") +
    (failed ? ` · ${failed} 失败` : "") +
    ` · 共耗时 ${(rows.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(0)} 秒`
);

const md = flag("--md");
if (md) {
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  const lines = [
    "# aram-mayhem 健康报告",
    "",
    `生成于 ${now} · **${passed}/${rows.length} 通过**` +
      (warned ? ` · ${warned} 需人看一眼` : "") +
      (failed ? ` · ${failed} 失败` : ""),
    "",
    "| 审计 | 结果 | 查什么 | 结论 |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.title} | ${MARK[r.level]} ${LABEL[r.level]} | ${r.what} | ${r.verdict.replace(/\|/g, "/")} |`),
    "",
    "每个审计的详细输出见 `npm run audit` 或对应的 `tools/audit-*.mjs`。",
    "",
    "说明：这 13 个审计分四类 —— 结构（字段/分析/接线/引导/长度）、自洽（跨工具/结论/方向/置信）、",
    "行为（冷启动正反）、对账（与原始数据独立重算）。前两类查「内部一致」，",
    "只有最后那一类有外部真值。",
  ];
  writeFileSync(md, lines.join("\n") + "\n", "utf8");
  console.log(`已写出：${md}`);
}
// 只有硬失败才让退出码非零 —— ⚠ 是「人来判」，不该卡住 CI 里串在后面的步骤
process.exit(failed ? 1 : 0);
