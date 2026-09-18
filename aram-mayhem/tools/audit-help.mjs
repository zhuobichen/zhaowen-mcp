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

let contentBad = 0;
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

// 第三查：引导表**内容本身**的质量。
//
// contentBad 单独计数，**不借用 ghosts 数组**：第一版图省事往 ghosts 里塞了个哨兵字符串
// 来让退出码非零，结果收尾行把它报成「1 个不存在的工具」—— 原因说错了。
// 报错行说错原因比不报还坏，会把人引到错的地方查。
//
// 上面只查「覆盖」（每个工具能不能被找到），查不出「找到了但没用」：
// 一个场景如果 asks 全是同义句、或 what 写得跟工具名一样，覆盖检查照样是绿的。
// 这几条判据都先量过现状（全绿）再加 —— 判据如果一上来就误报，它很快就会没人看。
try {
  const { parseScenarios } = await import("./gen-help-table.mjs");
  const sc = parseScenarios();
  const qual = [];
  const raw = read("lib/help.ts").replace(/\r\n/g, "\n");
  const whats = [...raw.matchAll(/\{ name: "([a-z_]+)", what: "([^"]*)" \}/g)].map((m) => [m[1], m[2]]);

  // when 重复 = 两个场景其实是同一个，用户看两遍同样的东西
  const whens = sc.map((s) => s.when);
  const dupWhen = whens.filter((w, i) => whens.indexOf(w) !== i);
  if (dupWhen.length) qual.push(`场景的 when 重复：${[...new Set(dupWhen)].join("、")}`);

  // 同一个说法出现在两个场景 = 引导有歧义，用户不知道点哪个
  const askWhere = new Map();
  for (const s of sc) for (const a of s.asks) askWhere.set(a, [...(askWhere.get(a) ?? []), s.when]);
  const dupAsk = [...askWhere].filter(([, v]) => v.length > 1);
  if (dupAsk.length) {
    qual.push(`同一句「你可能说」出现在多个场景（用户会被指到两处）：${dupAsk.map(([a, v]) => `「${a}」在 ${v.length} 个场景`).join("；")}`);
  }

  for (const s of sc) {
    if (!s.asks.length) qual.push(`场景「${s.when}」一句「你可能说」都没有`);
    if (new Set(s.asks).size !== s.asks.length) qual.push(`场景「${s.when}」的 asks 有重复项`);
    // asks 是「用户会怎么说」，出现 snake_case 标识符就说明写成了工具名
    const snake = s.asks.filter((a) => /[a-z]+_[a-z]+/.test(a));
    if (snake.length) qual.push(`场景「${s.when}」的 asks 里出现工具名式的标识符（用户不会这么说）：${snake.join("、")}`);
  }
  // 刻意**不查 asks 的长度**：「复盘」「体检」只有两个字，但它们正是用户会说的话 ——
  // 加了「太短就报」会直接误报。长度在中文里不等于信息量，这一条量过之后就放弃了。

  const wmap = new Map();
  for (const [n, w] of whats) wmap.set(w, [...(wmap.get(w) ?? []), n]);
  const dupWhat = [...wmap].filter(([, v]) => v.length > 1);
  if (dupWhat.length) qual.push(`what 完全重复（复制粘贴没改）：${dupWhat.map(([, v]) => v.join("/")).join("；")}`);
  const selfNamed = whats.filter(([n, w]) => w.trim() === n);
  if (selfNamed.length) qual.push(`what 就是工具名本身，等于没写：${selfNamed.map(([n]) => n).join("、")}`);
  const tooShort = whats.filter(([, w]) => w.trim().length < 4);
  if (tooShort.length) qual.push(`what 太短：${tooShort.map(([n, w]) => `${n}「${w}」`).join("、")}`);

  if (qual.length) {
    console.log("");
    contentBad += qual.length;
    for (const q of qual) console.log(`✗ ${q}`);
  } else {
    console.log(`✓ 引导表内容没有重复的 when / 歧义的说法 / 空描述（${sc.length} 个场景、${whats.length} 条 what）`);
  }
} catch (e) {
  console.log(`\n✗ 没法核对引导表内容：${e.message}`);
  contentBad += 1;
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
// 这里其实是三查（工具覆盖 / 引导表内容 / README 漂移），只留最后一行的输出
// 会让「引导覆盖」那一格显示成最后一查的结果 —— 所以合并成一句，且**逐项说清是哪个坏了**。
console.log("");
const badCount = missing.length + ghosts.length + drifted + contentBad;
console.log(
  badCount
    ? `✗ 引导有问题：${[
        ghosts.length ? `${ghosts.length} 个不存在的工具` : "",
        missing.length ? `${missing.length} 个工具没进任何场景` : "",
        contentBad ? `引导表内容有 ${contentBad} 处问题（重复/歧义/空描述）` : "",
        drifted ? "README 那张表跟 help.ts 不一致" : "",
      ]
        .filter(Boolean)
        .join("、")}`
    : `✓ ${tools.length} 个工具都能从场景引导里被找到；引导表内容无重复/歧义/空描述；README 那张表也与 help.ts 一致`
);
process.exit(badCount ? 1 : 0);
