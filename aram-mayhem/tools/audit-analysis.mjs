// 分析覆盖审计：字段是「被读了」还是「被真正分析了」？
//
// 前一个审计（audit:fields）的判据是「有没有模块引用这个字段」——
// 但**只在导出 CSV 里出现过，不等于分析过**。这个用更严的判据重查：
//   分析 = 除了「导出/落库/展示」之外的模块读了它
//   仅导出 = 只有 export.ts / report-md.ts 这类输出层读它
//
// 两者都算「没浪费采集」，但只有前者算「这个维度被分析过」。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

const block = read("lib/archive.ts").match(/export const LOL_STAT_KEYS = \[([\s\S]*?)\];/)[1];
const keys = [...block.matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]);

// 输出层：只负责把数据搬出去，不做判断
const OUTPUT_LAYER = new Set(["export.ts", "report-md.ts"]);

const files = readdirSync(path.join(ROOT, "lib"))
  .filter((f) => f.endsWith(".ts") && !f.includes("probe") && f !== "archive.ts")
  .map((f) => "lib/" + f);
// 根目录脚本也算读者（lcuprobe.ts 之类）
for (const f of readdirSync(ROOT)) if (/\.(ts|mjs)$/.test(f)) files.push(f);

const analyzed = new Map(keys.map((k) => [k, []]));
const onlyOutput = new Map(keys.map((k) => [k, []]));
for (const f of files) {
  if (!f.startsWith("lib/") && f !== "index.ts") continue; // 根脚本只用于「被读」判断
  const t = read(f);
  const base = path.basename(f);
  for (const k of keys) {
    const literal = new RegExp("\\b" + k + "\\b").test(t);
    const m = k.match(/^([A-Za-z]+?)(\d+)$/);
    const loopRead = !!m && t.includes("`" + m[1] + "${");
    if (!literal && !loopRead) continue;
    if (OUTPUT_LAYER.has(base)) onlyOutput.get(k).push(base);
    else analyzed.get(k).push(base);
  }
}

const notAnalyzed = keys.filter((k) => !analyzed.get(k).length);
console.log(`采集字段 ${keys.length} 个`);
console.log(`  被分析过：${keys.length - notAnalyzed.length}`);
console.log(`  只被导出、没被分析：${notAnalyzed.length}\n`);

if (notAnalyzed.length) {
  console.log("只在输出层出现、没有任何模块对它做判断的字段：");
  for (const k of notAnalyzed) {
    const where = onlyOutput.get(k);
    console.log(`  ${k.padEnd(28)} 只出现在 ${where.join(", ") || "（哪儿都没出现）"}`);
  }
  console.log("\n注意：这不等于是缺口 —— 有些字段本来就是纯记录用（比如给 CSV 用的原始值）。");
  console.log("但每一个都该能回答：「分析它有意义吗？有意义为什么没做？」");
} else {
  console.log("所有采集字段都至少有一个模块在做判断，不只是搬运。");
}
