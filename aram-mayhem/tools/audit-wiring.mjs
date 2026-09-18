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

console.log(`\n${problems === 0 ? "全部通过。" : `发现 ${problems} 个问题。`}`);
process.exit(problems === 0 ? 0 : 1);
