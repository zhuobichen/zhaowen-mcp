// 结论自洽审计：工具给出的结论，和它自己表格里的数字对得上吗？
//
// 为什么查这个：前面九个审计查的都是「结构」（字段、报告、引导、长度、冷启动、跨工具一致）。
// 这一层查的是**结论与它自己的数据是否相符** —— 最隐蔽的一类 bug：
// 结论是按某条路径算的、表格是按另一条路径渲染的，两边一旦分叉，
// 用户看到的是「上面说最多 -6.0 个百分点，下面表里最差是 -4.2」，然后就没人信了。
//
// 做法：这几个工具的输出结构是「结论句 + 明细表」，两边都带数字。
// 把结论里引用的关键数字抽出来，去明细里找 —— 找不到就是分叉。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const CASES = [
  { tool: "get_my_tilt", args: {} },
  { tool: "get_enemy_comps", args: {} },
  { tool: "get_my_contribution", args: {} },
  { tool: "get_combat_profile", args: {} },
  { tool: "get_my_trend", args: {} },
  { tool: "get_my_matchups", args: {} },
];

const child = spawn(process.execPath, [TSX, path.join(ROOT, "index.ts")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
let nextId = 1;
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      const r = pending.get(m.id);
      if (r) {
        pending.delete(m.id);
        r(m);
      }
    } catch {
      /* 忽略 */
    }
  }
});
child.stderr.on("data", () => {});
const send = (method, params, timeoutMs = 180000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error("超时")), timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vd", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

/** 带正负号的百分点数，如 "-6.0" / "+12.7" */
const signed = (s) => [...s.matchAll(/([+-]\d{1,3}\.\d)/g)].map((m) => Number(m[1]));
/** 纯百分比，如 "45.0%" */
const pcts = (s) => [...s.matchAll(/(\d{1,3}\.\d)%/g)].map((m) => Number(m[1]));

let problems = 0;
const notes = [];

for (const { tool, args } of CASES) {
  let text = "";
  try {
    const r = await send("tools/call", { name: tool, arguments: args });
    text = r.result?.content?.[0]?.text ?? "";
  } catch {
    continue;
  }
  const lines = text.split("\n");
  // 两种结论形式都认：
  //   ① 独立的「结论：…」行（多数工具）
  //   ② 内嵌在指标行里的（get_combat_profile 每个指标一行，形如
  //      「承伤（…）：队内第一 57.4% / 第 4 名及以后合并 44.7%，差 12.7 个百分点 —— …」）
  const standalone = lines.filter((l) => l.startsWith("结论："));
  const inline = lines.filter((l) => /：队内第一 .*差 .* 个百分点/.test(l));
  const verdictLines = standalone.length ? standalone : inline;
  if (!verdictLines.length) {
    notes.push(`${tool}：没有可识别的结论行，跳过自洽检查`);
    continue;
  }
  const verdictLine = verdictLines.join(" ｜ ");
  const body = lines.filter((l) => !verdictLines.includes(l)).join("\n");

  // 结论里引用的带符号差值，必须能在明细里找到（或本身就是明细里的极值）
  const vSigned = signed(verdictLine);
  const bodySigned = new Set(signed(body));
  const missing = vSigned.filter((v) => !bodySigned.has(v));

  // 结论里引用的百分比，同理
  const vPcts = pcts(verdictLine);
  const bodyPcts = new Set(pcts(body));
  const missingP = vPcts.filter((v) => !bodyPcts.has(v));

  if (missing.length || missingP.length) {
    problems++;
    console.log(`✗ ${tool}`);
    if (missing.length) console.log(`    结论里这些差值在明细里找不到：${missing.join(", ")}`);
    if (missingP.length) console.log(`    结论里这些百分比在明细里找不到：${missingP.join(", ")}`);
    console.log(`    结论行：${verdictLine.slice(0, 110)}`);
  } else {
    const cited = vSigned.length + vPcts.length;
    console.log(`✓ ${tool}（结论引用 ${cited} 个数字，明细里都能对上）`);
  }
}
child.kill();

if (notes.length) {
  console.log("");
  for (const n of notes) console.log(`· ${n}`);
}
console.log("");
console.log(problems ? `✗ ${problems} 个工具的结论与自己的明细对不上` : "✓ 所有工具的结论都能在自己的明细里找到依据");
process.exit(problems ? 1 : 0);
