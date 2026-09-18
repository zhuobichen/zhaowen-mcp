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

// 第二查：README 上那张「按处境查」的表，跟 lib/help.ts 还是同一份内容吗？
// 原先那是**手抄的第二份副本**，早就停在十几个工具的版本 —— 一个只在 GitHub 上读
// README、调不了 get_help 的人，看到的是过期的功能清单。现在改成生成 + 这里查漂移。
let drifted = 0;
try {
  const { parseScenarios, renderTable, currentBlock } = await import("./gen-help-table.mjs");
  const want = renderTable(parseScenarios());
  const cur = currentBlock(read("README.md"));
  if (cur === null) {
    console.log("\n✗ README 里没有 help-table 标记（没法确认那张表是不是最新的）");
    drifted = 1;
  } else if (cur !== want) {
    console.log("\n✗ README 的处境表与 lib/help.ts 不一致（跑 npm run help:readme 重生成）");
    drifted = 1;
  } else {
    console.log("✓ README 的处境表与 lib/help.ts 一致");
  }
} catch (e) {
  console.log(`\n✗ 没法核对 README 的处境表：${e.message}`);
  drifted = 1;
}

// 收尾结论行：健康报告按这一行的前缀分档（✓ 通过 / ⚠ 注意 / ✗ 失败）。
// 这一查其实是两件事（工具有没有进引导、README 有没有漂移），只留最后一行的输出
// 会让「引导覆盖」那一格显示成漂移检查的结果 —— 所以合并成一句。
console.log("");
const bad = missing.length || ghosts.length || drifted;
console.log(
  bad
    ? `✗ 引导有问题：${[
        ghosts.length ? `${ghosts.length} 个不存在的工具` : "",
        missing.length ? `${missing.length} 个工具没进任何场景` : "",
        drifted ? "README 那张表跟 help.ts 不一致" : "",
      ]
        .filter(Boolean)
        .join("、")}`
    : `✓ ${tools.length} 个工具都能从场景引导里被找到，README 那张表也与 help.ts 一致`
);
process.exit(bad ? 1 : 0);
