// 从 lib/help.ts 生成 README 里那张「按处境查」的表。
//
// 为什么要有它：README 上那张表原先**是手抄的第二份副本**，跟 lib/help.ts 各自演化，
// 结果 README 那份停在早期版本 —— 只列了十几个工具，后加的二十多个在表里根本没有。
// 一个只在 GitHub 上读 README 的人（没法调 get_help）看到的是过期的功能清单。
//
// 手抄必然会再烂，所以改成生成 + 漂移检查：
//   node tools/gen-help-table.mjs --write   # 重新生成并写回 README
//   node tools/gen-help-table.mjs --check   # 只检查有没有漂移（audit:help 用这个）
//
// 唯一的真相源是 lib/help.ts；这里只负责排版。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

export const BEGIN = "<!-- BEGIN:help-table（由 tools/gen-help-table.mjs 生成，勿手改） -->";
export const END = "<!-- END:help-table -->";

/** 解析 lib/help.ts 的 SCENARIOS。格式固定，但不假设它永远不变 —— 解析不出就抛错，不静默出一张空表 */
export function parseScenarios() {
  // 本仓库在 Windows 上是 CRLF —— 不归一化的话 `\n  {\n` 这种分隔符一条都匹配不上
  // （第一版就是这么静默失败的，报的错是「一个场景都没解析出来」）。
  const src = read("lib/help.ts").replace(/\r\n/g, "\n");
  const start = src.indexOf("export const SCENARIOS");
  if (start < 0) throw new Error("lib/help.ts 里找不到 SCENARIOS");
  const end = src.indexOf("\n];", start);
  if (end < 0) throw new Error("SCENARIOS 数组没有闭合");
  // 末尾补一个换行：最后一个场景是以 `  },\n];` 收尾的，切到 `\n];` 会把它的换行也切掉，
  // 于是前瞻 `(?=,?\n)` 匹配不上 —— 表现是「最后一个场景凭空消失」（8 个只出 7 个）。
  const body = src.slice(start, end) + "\n";

  // 收尾用**前瞻** `(?=,?\n)`，不能直接写 `,?\n` ——
  // 那样每个匹配会把分隔的换行也吃掉，下一个场景的 `\n  {\n` 就没了前导换行、匹配不上，
  // 结果是隔一个吞一个（8 个场景只解析出 4 个，且看着还挺正常，不容易发现）。
  const blocks = [...body.matchAll(/\n  \{\n([\s\S]*?)\n  \}(?=,?\n)/g)].map((m) => m[1]);
  if (!blocks.length) throw new Error("SCENARIOS 里一个场景都没解析出来");

  return blocks.map((b, i) => {
    const when = unquote(/when:\s*"((?:[^"\\]|\\.)*)"/.exec(b)?.[1]);
    if (!when) throw new Error(`第 ${i + 1} 个场景没有 when`);
    const asksRaw = /asks:\s*\[([\s\S]*?)\]/.exec(b)?.[1] ?? "";
    const asks = [...asksRaw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unquote(m[1]));
    const toolsRaw = /\n    tools:\s*\[([\s\S]*?)\n    \]/.exec(b)?.[1];
    if (toolsRaw === undefined) throw new Error(`场景「${when}」没有 tools 数组（缩进变了？）`);
    const tools = [...toolsRaw.matchAll(/\{\s*name:\s*"([a-z_0-9]+)"/g)].map((m) => m[1]);
    if (!tools.length) throw new Error(`场景「${when}」的 tools 是空的`);
    return { when, asks, tools };
  });
}

/** TS 字符串字面量里可能带转义（当前没有，但别让它某天悄悄出问题） */
function unquote(s) {
  if (s === undefined) return undefined;
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function renderTable(scenarios) {
  const lines = ["| 你的处境 | 你可能会说 | 该用哪些 |", "|---|---|---|"];
  for (const s of scenarios) {
    // 「你可能会说」只放前 3 句：全放会把表格撑爆，而前 3 句已经够触发联想了
    const asks = s.asks.slice(0, 3).map((a) => `「${a}」`).join(" · ") + (s.asks.length > 3 ? " …" : "");
    const tools = s.tools.map((t) => `\`${t}\``).join(" · ");
    lines.push(`| ${s.when} | ${asks} | ${tools} |`);
  }
  return lines.join("\n");
}

/** 把 README 里两个标记之间的内容替换掉；标记不存在就报错，不猜位置 */
export function splice(readme, table) {
  const i = readme.indexOf(BEGIN);
  const j = readme.indexOf(END);
  if (i < 0 || j < 0) throw new Error(`README 里找不到 ${i < 0 ? BEGIN : END} 标记`);
  if (j < i) throw new Error("README 的标记顺序反了");
  // README 是 CRLF，插进去的内容也得是 CRLF —— 否则每次生成都会把这一段的行尾改掉，
  // git diff 里就会看到整段「变了」而其实内容没变。
  const nl = readme.includes("\r\n") ? "\r\n" : "\n";
  const body = table.split("\n").join(nl);
  return readme.slice(0, i + BEGIN.length) + nl + nl + body + nl + nl + readme.slice(j);
}

/** 当前 README 里那段表格（用于比对漂移）。比对前统一成 LF，免得行尾差异被当成内容漂移 */
export function currentBlock(readme) {
  const i = readme.indexOf(BEGIN);
  const j = readme.indexOf(END);
  if (i < 0 || j < 0) return null;
  return readme.slice(i + BEGIN.length, j).replace(/\r\n/g, "\n").trim();
}

if (import.meta.filename === process.argv[1]) {
  const mode = process.argv.includes("--write") ? "write" : "check";
  let table;
  try {
    table = renderTable(parseScenarios());
  } catch (e) {
    console.log(`✗ 解析 lib/help.ts 失败：${e.message}`);
    process.exit(1);
  }
  const readmePath = path.join(ROOT, "README.md");
  const readme = readFileSync(readmePath, "utf8");
  const cur = currentBlock(readme);
  if (cur === null) {
    console.log("✗ README 里没有 help-table 标记");
    process.exit(1);
  }
  if (mode === "write") {
    const next = splice(readme, table);
    if (next === readme) {
      console.log("✓ README 的处境表已是最新，无需改动");
    } else {
      writeFileSync(readmePath, next, "utf8");
      console.log(`✓ 已按 lib/help.ts 重写 README 的处境表（${parseScenarios().length} 个场景）`);
    }
  } else {
    const same = cur === table;
    console.log(
      same
        ? "✓ README 的处境表与 lib/help.ts 一致"
        : "✗ README 的处境表与 lib/help.ts 不一致（跑 npm run help:readme 重生成）"
    );
    process.exit(same ? 0 : 1);
  }
}
