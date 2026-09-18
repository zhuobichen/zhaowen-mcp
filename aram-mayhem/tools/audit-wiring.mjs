// 接线审计（可重跑）：功能写好了，但有没有真的接上？
//
// 字段审计（audit:fields）查的是「数据采了没用」；这个查的是**代码与文档的断头路**：
//   A. lib/ 里有没有游离文件或死代码（写了却没人调）
//   B. MCP 工具 ↔ README 工具表是否两边对得上
//   C. package.json 的 scripts 指向的文件在不在
//   D. lib/ 和 tools/ 下的 probe / CLI 脚本有没有配套的 npm script
//
// 这些不会让程序报错，但会让「以为有」和「实际有」错位 —— 正是最该被检查的那类问题。
//
// 写这个脚本时踩过两次误报，都记在注释里：文本判据太naive就会喊狼来了，
// 喊多了这个检查本身就没人看了。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

let problems = 0;
const bad = (s) => {
  problems++;
  console.log("  ✗ " + s);
};
const ok = (s) => console.log("  ✓ " + s);

const pkg = JSON.parse(read("package.json"));
const scriptText = Object.values(pkg.scripts ?? {}).join(" ");

/** 取一个文件里 import 了哪些本地模块（含动态 import） */
function importsOf(file) {
  const t = read(file);
  const out = [];
  const push = (spec) => {
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    out.push(rel.endsWith(".js") ? rel.replace(/\.js$/, ".ts") : rel);
  };
  for (const m of t.matchAll(/from\s+"(\.[^"]+)"/g)) push(m[1]);
  for (const m of t.matchAll(/import\(\s*"(\.[^"]+)"\s*\)/g)) push(m[1]);
  return out;
}

const libFiles = readdirSync(path.join(ROOT, "lib"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => "lib/" + f);

// ---------------------------------------------------------------- A. 游离文件与死代码
console.log("A. lib/ 的接线情况");

// 自己的入口：由 npm script 直接跑，本来就不该被 index.ts import。
// report.ts / report-tft.ts / archive-sync.ts 是 CLI，*-probe.ts 是手动探针。
// 不排除它们会把一堆正常入口报成「走不到的死代码」—— 第一版就是这么误报的。
const isEntryPoint = (f) => /-(probe|cli)\.ts$/.test(f) || scriptText.includes(path.basename(f));

// 种子要包含**所有入口**，不只是 index.ts —— 否则只被 report.ts（CLI 入口）
// 引用的 report-style.ts 会被当成游离文件。这是第三次同类误报。
const reachable = new Set();
const queue = ["index.ts", ...libFiles.filter(isEntryPoint)];
while (queue.length) {
  const f = queue.pop();
  if (reachable.has(f) || !existsSync(path.join(ROOT, f))) continue;
  reachable.add(f);
  for (const dep of importsOf(f)) if (!reachable.has(dep)) queue.push(dep);
}
console.log(`  （从 ${libFiles.filter(isEntryPoint).length + 1} 个入口合计可达 ${reachable.size} 个文件）`);

const strays = libFiles.filter((f) => !reachable.has(f) && !isEntryPoint(f));
if (strays.length) bad(`既不在 index.ts 的引用链上、也不是自己的入口（死代码？）：${strays.join(", ")}`);
else ok("没有游离文件（其余要么被 index.ts 引用，要么是自己的入口）");

// 导出但全项目任何文件都没引用的函数。
// 「同文件内自用」不算没人用 —— 那只是可以收回 export，不影响功能，所以当提示而非问题。
// 扫描范围必须包含**根目录脚本**（lcuprobe.ts / smoke.ts）—— 第一版只扫 lib/ 和
// index.ts，于是 lcuprobe.ts 在用的 getRecentGames 被判成死代码删掉了。这是第四次同类误报。
const rootScripts = readdirSync(ROOT).filter((f) => /\.(ts|mjs)$/.test(f));
const allSrc = [...new Set([...reachable, ...libFiles, ...rootScripts])].filter((f) => existsSync(path.join(ROOT, f)));
const srcCache = new Map(allSrc.map((f) => [f, read(f)]));
const dead = [];
const overExported = [];
for (const f of libFiles) {
  if (!reachable.has(f)) continue;
  const self = srcCache.get(f) ?? read(f);
  for (const m of self.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)) {
    const name = m[1];
    const re = new RegExp("\\b" + name + "\\b");
    if (allSrc.some((g) => g !== f && re.test(srcCache.get(g) ?? read(g)))) continue;
    const inSelf = (self.match(new RegExp("\\b" + name + "\\b", "g")) ?? []).length;
    if (inSelf <= 1) dead.push(`${f}:${name}`);
    else overExported.push(`${f}:${name}`);
  }
}
if (dead.length) bad(`真·死代码（声明了、哪儿都没引用）：\n      ${dead.join("\n      ")}`);
else ok("没有死代码");
if (overExported.length) console.log(`  · 提示：${overExported.length} 个函数只在自己文件内使用（可收回 export，不影响功能）`);

// ---------------------------------------------------------------- B. 工具 ↔ README
console.log("\nB. MCP 工具 ↔ README 工具表");
const idx = read("index.ts");
const tools = [...idx.matchAll(/^        name: "([a-z_]+)",/gm)].map((m) => m[1]);
const cases = [...idx.matchAll(/^        case "([a-z_]+)":/gm)].map((m) => m[1]);
const readme = read("README.md");
const table = [...readme.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);

const noDispatch = tools.filter((t) => !cases.includes(t));
const noDeclare = cases.filter((c) => !tools.includes(c));
if (noDispatch.length) bad(`声明了但没分发：${noDispatch.join(", ")}`);
if (noDeclare.length) bad(`分发了但没声明：${noDeclare.join(", ")}`);
if (!noDispatch.length && !noDeclare.length) ok(`${tools.length} 个工具声明与分发一一对应`);

const missDoc = tools.filter((t) => !table.includes(t));
const extraDoc = table.filter((t) => !tools.includes(t));
if (missDoc.length) bad(`README 工具表漏了：${missDoc.join(", ")}`);
if (extraDoc.length) bad(`README 工具表多出（已不存在）：${extraDoc.join(", ")}`);
if (!missDoc.length && !extraDoc.length) ok(`README 工具表与代码一致（${table.length} 条）`);

// 文档/代码里引用到的其它工具名，是否真的存在
const ghosts = new Set();
for (const src of [readme, idx]) {
  for (const m of src.matchAll(/`([a-z_]{4,})`/g)) {
    const n = m[1];
    if (/^(get|list|analyze|compare|search|check|send|export|refresh)_/.test(n) && !tools.includes(n)) ghosts.add(n);
  }
}
if (ghosts.size) bad(`引用了不存在的工具：${[...ghosts].join(", ")}`);
else ok("没有指向不存在工具的引用");

// ---------------------------------------------------------------- C. scripts 指向的文件
console.log("\nC. package.json scripts 指向的文件");
const missingScriptFiles = [];
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  for (const m of cmd.matchAll(/([\w./-]+\.(?:ts|mjs|js|ps1|sh|py))/g)) {
    const p = m[1];
    if (p.startsWith("node_modules")) continue;
    if (!existsSync(path.join(ROOT, p))) missingScriptFiles.push(`${name} → ${p}`);
  }
}
if (missingScriptFiles.length) bad(`指向不存在的文件：\n      ${missingScriptFiles.join("\n      ")}`);
else ok(`${Object.keys(pkg.scripts ?? {}).length} 个 script 指向的文件都存在`);

// ---------------------------------------------------------------- C2. 每个 script 在 README 里被提到了吗
//
// README 的「数据刷新与自检」那段也是**手工维护的第二份清单** —— 和刚修掉的
// 「按处境查」表是同一类问题：加了个 script 忘了写进 README，用户就不知道它存在。
// 这里不生成（那些中文说明手写才有价值），只查「有没有漏」。
console.log("\nC2. 每个 script 有没有在 README 里露面");

// 明确不写进 README 的：要么是上面那些的开关，要么是内部调试用。每个都要有理由。
const UNDOCUMENTED_OK = new Map([
  ["start", "就是 `npx tsx index.ts`，MCP 客户端自己会拉起，不是给人手打的"],
  ["help:readme:check", "help:readme 的 --check 形式，README 里已一并说明"],
  ["audit:recompute:html", "audit:recompute 的重活开关，默认不开（要 90 秒），README 里已一并说明"],
  ["pc:capture:chained", "pc:capture 的链式代理变体，属排障用法"],
  ["pc:proxy-status", "pc:proxy-on 的状态查询"],
  ["wegame:probe", "是一次性的接口摸底探针，结论已写在 README 的抓包那节"],
  ["wegame:enum", "同上，枚举 WeGame 接口用"],
  ["export:csv", "export_games_csv 的命令行版"],
  ["report:md", "export_report_markdown 的命令行版"],
  ["matchups", "get_my_matchups 的命令行版"],
  ["empirical", "符文实证榜的命令行版"],
  ["tft:detail", "get_tft_detail 的命令行版"],
  ["trend", "get_my_trend 的命令行版"],
  ["queue:stats", "get_queue_stats 的命令行版"],
  ["patches", "get_my_patches 的命令行版"],
  ["comps", "get_enemy_comps 的命令行版"],
  ["counters", "get_counter_items 的命令行版"],
  ["contribution", "get_my_contribution 的命令行版"],
  ["tilt", "get_my_tilt 的命令行版"],
  ["checkup", "get_my_checkup 的命令行版"],
  ["game", "get_game_detail 的命令行版"],
  ["combat", "get_combat_profile 的命令行版"],
]);

const readmeText = read("README.md").replace(/\r\n/g, "\n"); // 仓库是 CRLF，不归一化则围栏一条都匹配不上
const shBlocks = [...readmeText.matchAll(/```(?:sh|bash)\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
const documented = new Set([...shBlocks.matchAll(/npm run ([a-z0-9:_-]+)/g)].map((m) => m[1]));

const scriptNames = Object.keys(pkg.scripts ?? {});
const undocumented = scriptNames.filter((s) => !documented.has(s) && !UNDOCUMENTED_OK.has(s));
const documentedGhosts = [...documented].filter((s) => !scriptNames.includes(s));
const staleAllowlist = [...UNDOCUMENTED_OK.keys()].filter((s) => !scriptNames.includes(s));
// 豁免名单里「其实 README 已经写了」的条目：说明那条豁免的理由是假的，
// 留着会让「README 列了 N 个 + 豁免 M 个」这个加法对不上（数量会超过 script 总数）。
const pointlessAllowlist = [...UNDOCUMENTED_OK.keys()].filter((s) => documented.has(s) && scriptNames.includes(s));

if (documentedGhosts.length) bad(`README 里写了不存在的 script：${documentedGhosts.join(", ")}`);
if (staleAllowlist.length) bad(`豁免名单里有过期的条目（script 已经删了）：${staleAllowlist.join(", ")}`);
if (pointlessAllowlist.length) {
  bad(`豁免名单里这些其实 README 已经列了（豁免理由不成立，删掉这几条）：${pointlessAllowlist.join(", ")}`);
}
if (undocumented.length) {
  bad(`${undocumented.length} 个 script 既没进 README、也不在豁免名单里：\n      ${undocumented.join("\n      ")}`);
}
// 只有这一节三项都干净时才报 ✓ —— 否则会出现「✗ 上面一条 + ✓ 这一条」的自我矛盾
if (!undocumented.length && !documentedGhosts.length && !staleAllowlist.length && !pointlessAllowlist.length) {
  ok(
    `${scriptNames.length} 个 script 都有交代 —— README 列了 ${documented.size} 个，` +
      `另有 ${UNDOCUMENTED_OK.size} 个在豁免名单里、各写了理由`
  );
}

// ---------------------------------------------------------------- D. probe/CLI 有没有 npm script
console.log("\nD. probe / CLI 脚本有没有配套 npm script");
const loose = [];
for (const dir of ["lib", "tools"]) {
  for (const f of readdirSync(path.join(ROOT, dir))) {
    if (!/-(probe|cli)\.(ts|mjs)$/.test(f)) continue;
    if (!scriptText.includes(f)) loose.push(`${dir}/${f}`);
  }
}
if (loose.length) bad(`有脚本但没接进 npm scripts（只能靠手打路径跑）：\n      ${loose.join("\n      ")}`);
else ok("所有 probe / CLI 都有配套 npm script");

// ---------------------------------------------------------------- E. 审计进程不许写盘
//
// 这是真出过一次的事故：冷启动审计遍历**全部**工具，参数表里漏了 `refresh_data`，
// 于是 `ARGS[name] ?? {}` 让它以 dryRun 缺省跑了 —— 一次只读审计发起了联网刷新、
// 改写了 data/meta.json 的 updatedAt。更坏的是它不报错：`get_data_info` 显示的
// 「数据更新时间」会变成用户从没要求过的刷新，而没人会想到去怀疑一个审计。
//
// 闸设在 lib/refresh.ts 的写盘处（环境变量 MAYHEM_NO_WRITES）。
// 这里查「凡是会起 MCP 服务的审计，有没有设这道闸」—— 靠「记得加 dry_run」已经漏过一次。
console.log("\nE. 审计进程有没有设「不许写盘」的闸");
const spawners = [...readdirSync(path.join(ROOT, "tools"))]
  .filter((f) => /^audit-.*\.mjs$/.test(f))
  .map((f) => `tools/${f}`)
  .concat(["mcp-smoke.mjs"]);
const unguarded = spawners.filter((f) => {
  const t = read(f);
  if (!/\bspawn\(/.test(t)) return false; // 不起服务的（纯静态检查）不用管
  return !t.includes("MAYHEM_NO_WRITES");
});
if (unguarded.length) {
  bad(`这些脚本会起 MCP 服务但没设写盘闸，可能悄悄改数据：\n      ${unguarded.join("\n      ")}`);
} else {
  const n = spawners.filter((f) => /\bspawn\(/.test(read(f))).length;
  ok(`${n} 个会起服务的审计/冒烟脚本都设了 MAYHEM_NO_WRITES`);
}

// 收尾结论行：健康报告按这一行的前缀分档（✓ 通过 / ⚠ 注意 / ✗ 失败）。
// 原先只写「全部通过。」—— 绿是绿的，但没说什么通过了，聚合到一张表上等于没信息。
console.log("");
console.log(
  problems === 0
    ? `✓ 工具、文档、scripts 三方对得上（${tools.length} 个工具 / ${Object.keys(pkg.scripts ?? {}).length} 个 script）`
    : `✗ 接线有 ${problems} 处对不上`
);
process.exit(problems === 0 ? 0 : 1);
