// 结论方向审计：结论说的方向，跟数字的方向一致吗？
//
// audit-verdict 查的是「结论引用的数字在不在明细里」——那是**引对没有**。
// 这个查的是**说反没有**：
//   · 方向词与数字符号不一致（说「变强了」但差值是负的）
//   · 点名的对象不是极值（说「最吃力的是 X」，但 X 的残差不是最低的）
//
// 这类错误比数字抄错更严重 —— 数字错了读者能自己看出来，方向说反了读者会直接信。
//
// 判据完全基于工具自己的输出：从结论行取方向词，从输出里取数字，比符号。
// 不依赖任何外部真值，所以以后改了算法这个检查依然有效。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 方向词表：看到这些词，结论就在断言某个方向
const UP_WORDS = /变强|好了|有所提升|赢了更多|赢面更大|更高|更稳|进步/;
const DOWN_WORDS = /变差|差了|下滑|走低|掉了|更低|没找到手感|退步/;
const FLAT_WORDS = /基本持平|看不出|没有明显影响|差不多|没有趋势/;

const CASES = [
  { tool: "get_my_trend", args: {} },
  { tool: "get_my_tilt", args: {} },
  { tool: "get_my_contribution", args: {} },
  { tool: "get_my_patches", args: {} },
  { tool: "get_enemy_comps", args: {} },
  { tool: "get_combat_profile", args: {} },
  { tool: "get_my_matchups", args: {} },
];

/**
 * 判据本体：给一句结论，返回矛盾说明或 null。
 * 抽成函数是为了能自测 —— **一个从没报过错的检查等于没有检查**，
 * 得先确认它真的会为矛盾的说法报警，再去信它的「全部通过」。
 */
function contradiction(v) {
  const pctMatches = [...v.matchAll(/([+-]?\d{1,3}\.\d)\s*个百分点/g)];
  if (!pctMatches.length) return null;
  const delta = Number(pctMatches[pctMatches.length - 1][1]);
  const hasUp = UP_WORDS.test(v);
  const hasDown = DOWN_WORDS.test(v);
  const hasFlat = FLAT_WORDS.test(v);
  if (hasUp && !hasDown && delta < 0) return `说「${(v.match(UP_WORDS) ?? [""])[0]}」但幅度是负的（${delta}）`;
  if (hasDown && !hasUp && delta > 0) return `说「${(v.match(DOWN_WORDS) ?? [""])[0]}」但幅度是正的（${delta}）`;
  if (hasFlat && Math.abs(delta) >= 8) return `说「差不多/没有影响」但幅度到了 ${delta} 个百分点`;
  return null;
}

// 自测：合成的矛盾句必须被抓住，正常的必须放过
if (process.argv.includes("--selftest")) {
  const cases = [
    ["结论：最近好了 -9.5 个百分点，是在变强。", true],
    ["结论：状态在下滑，差了 +4.0 个百分点。", true],
    ["结论：两人基本持平（差 12.0 个百分点）。", true],
    ["结论：最近好了 +9.5 个百分点，是在变强。", false],
    ["结论：状态在下滑，差了 -4.0 个百分点。", false],
    ["结论：基本持平（差 1.2 个百分点）。", false],
    ["结论：对面阵容构成对你没有明显影响：极差只有 3.0 个百分点。", false],
  ];
  let bad = 0;
  for (const [text, shouldCatch] of cases) {
    const hit = contradiction(text);
    const ok = shouldCatch ? !!hit : !hit;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${shouldCatch ? "应报错" : "应放过"}：${text}`);
    if (hit) console.log(`      → ${hit}`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过 —— 判据本身有问题` : `✓ 自测通过（${cases.length} 条）`);
  process.exit(bad ? 1 : 0);
}

const child = spawn(process.execPath, [TSX, path.join(ROOT, "index.ts")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MAYHEM_NO_WRITES: "1" } });
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

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dir", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

let problems = 0;
let checked = 0;

for (const { tool, args } of CASES) {
  let text = "";
  try {
    const r = await send("tools/call", { name: tool, arguments: args });
    text = r.result?.content?.[0]?.text ?? "";
  } catch {
    continue;
  }
  const lines = text.split("\n");
  const verdicts = lines.filter((l) => l.startsWith("结论：") || /：队内第一 .*差 .* 个百分点/.test(l));
  if (!verdicts.length) continue;

  for (const v of verdicts) {
    // 结论里最后出现的那个「X 个百分点」是它给出的关键幅度
    checked++;
    const bad = contradiction(v);
    if (bad) {
      problems++;
      console.log(`✗ ${tool}`);
      console.log(`    ${bad}`);
      console.log(`    结论：${v.slice(0, 120)}`);
    }
  }
}

// 结构性检查：点名的对象是不是极值
{
  const r = await send("tools/call", { name: "get_my_matchups", arguments: {} });
  const text = r.result?.content?.[0]?.text ?? "";
  const verdict = text.split("\n").find((l) => l.startsWith("结论："));
  if (verdict) {
    checked++;
    // 列表行形如：  · 对面有 X：12 把 · ... → 残差 -20.3
    const rows = [...text.matchAll(/对面有\s*(\S+?)：(\d+)\s*把[\s\S]*?残差\s*([+-]?\d+\.\d)/g)].map((m) => ({
      champ: m[1],
      residual: Number(m[3]),
    }));
    const namedWorst = /最吃力的是对面有\s*(\S+?)（/.exec(verdict)?.[1];
    const namedBest = /最稳的是对面有\s*(\S+?)（/.exec(verdict)?.[1];
    if (rows.length > 1) {
      const minR = Math.min(...rows.map((x) => x.residual));
      const maxR = Math.max(...rows.map((x) => x.residual));
      const worstRow = rows.find((x) => x.champ === namedWorst);
      const bestRow = rows.find((x) => x.champ === namedBest);
      let bad = null;
      if (worstRow && namedWorst && worstRow.residual !== minR) {
        bad = `点名「最吃力」是 ${namedWorst}（残差 ${worstRow.residual}），但列表里最低的是 ${minR}`;
      }
      if (bestRow && namedBest && bestRow.residual !== maxR) {
        bad = `点名「最稳」是 ${namedBest}（残差 ${bestRow.residual}），但列表里最高的是 ${maxR}`;
      }
      if (bad) {
        problems++;
        console.log(`✗ get_my_matchups（点名与极值不符）\n    ${bad}`);
      } else {
        console.log(`✓ get_my_matchups：点名的克星/提款机确实是列表里的两个极值（${minR} / ${maxR}）`);
      }
    }
  }
}
child.kill();

console.log("");
console.log(
  problems
    ? `✗ ${problems} 处结论的方向与数字对不上`
    : `✓ 检查了 ${checked} 处结论，方向词与数字符号全部一致`
);
process.exit(problems ? 1 : 0);
