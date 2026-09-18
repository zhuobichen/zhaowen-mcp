// 字段覆盖审计（可重跑）：归档采集的统计字段，有哪些从没被任何模块读过？
//
// 两种读法都要认：① 字面字段名 item0；② 模板串循环 `item${i}`（item1..5 就是这种）。
// 只认 ① 会误报 item1..5 是「没人读」—— 第一版脚本就是这么被骗的。
import { readFileSync, readdirSync } from "node:fs";

const arch = readFileSync("lib/archive.ts", "utf8");
const block = arch.match(/export const LOL_STAT_KEYS = \[([\s\S]*?)\];/)[1];
const keys = [...block.matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]);

const files = readdirSync("lib").filter((f) => f.endsWith(".ts") && !f.includes("probe") && f !== "archive.ts");
const used = new Map(keys.map((k) => [k, []]));
for (const f of files) {
  const t = readFileSync("lib/" + f, "utf8");
  for (const k of keys) {
    const literal = new RegExp("\\b" + k + "\\b").test(t);
    const m = k.match(/^([A-Za-z]+?)(\d+)$/);
    const loopRead = !!m && t.includes("`" + m[1] + "${");
    if (literal || loopRead) used.get(k).push(f);
  }
}

const never = keys.filter((k) => !used.get(k).length);
console.log(`采集字段 ${keys.length} 个；从没有被读过的 ${never.length} 个`);
console.log("（识别两种读法：字面字段名，以及 `item${i}` 这种模板串循环）");

// 对每个没被读的字段，去归档里看它到底有没有值 —— 「没值」和「有值但没分析」是两回事
const j = JSON.parse(readFileSync("data/archive/lol-matches.json", "utf8"));
const games = Object.values(j.games);
console.log("\n没被读的字段在归档里的实际情况：");
for (const k of never) {
  let n = 0;
  let nz = 0;
  for (const g of games)
    for (const p of g.participants ?? []) {
      const s = p.stats ?? {};
      if (s[k] === undefined) continue;
      n++;
      if (Number(s[k]) > 0) nz++;
    }
  const verdict =
    n === 0
      ? "源里没有 → 不分析（已在输出里说明）"
      : nz / n < 0.1
        ? `有值但 ${(100 - (nz / n) * 100).toFixed(0)}% 是 0 → 该模式下无意义（已在输出里说明）`
        : `⚠ 有值可分析（${((nz / n) * 100).toFixed(0)}% 非零）但没有任何模块在读`;
  console.log(`  ${k.padEnd(28)} ${String(n).padStart(6)} 行 · 非零 ${String(nz).padStart(6)} → ${verdict}`);
}
