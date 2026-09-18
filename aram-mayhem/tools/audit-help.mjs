// 引导覆盖审计：每个工具都能从「场景引导」里被找到吗？
//
// 为什么要有这个：工具靠罗列名字没法用 —— 用户会说「我最近老被打爆」，
// 不会说「调用 get_my_matchups」。引导表（lib/help.ts）就是「人话 → 工具」的映射，
// 漏了一个工具等于那个工具从入口上消失了 —— 功能还在，但没人会想起来用。
//
// 这是可见性审计（audit:surfaced）的上一层：那个查「分析有没有进报告」，
// 这个查「工具有没有进引导」。
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

const idx = read("index.ts");
const tools = [...idx.matchAll(/^        name: "([a-z_]+)",/gm)].map((m) => m[1]);

const help = read("lib/help.ts");
const guided = new Set([...help.matchAll(/\{ name: "([a-z_]+)"/g)].map((m) => m[1]));

const missing = tools.filter((t) => !guided.has(t));
const ghosts = [...guided].filter((g) => !tools.includes(g));

console.log(`工具 ${tools.length} 个；场景引导里出现 ${guided.size} 个`);

if (ghosts.length) {
  console.log(`\n✗ 引导里写了不存在的工具：${ghosts.join(", ")}`);
}
if (missing.length) {
  console.log(`\n✗ ${missing.length} 个工具没有出现在任何场景里（用户从引导里找不到它）：`);
  for (const m of missing) {
    const desc = new RegExp('name: "' + m + '",\\s*\\n\\s*description:\\s*\\n?\\s*"([^"]+)').exec(idx)?.[1] ?? "";
    console.log(`  · ${m} —— ${desc.slice(0, 44) || "(无描述)"}`);
  }
  console.log("\n修法：把它加进 lib/help.ts 里某个场景的 tools 数组（挑最贴近用户意图的那个）。");
} else if (!ghosts.length) {
  console.log("✓ 所有工具都能从场景引导里被找到");
}

process.exit(missing.length || ghosts.length ? 1 : 0);
