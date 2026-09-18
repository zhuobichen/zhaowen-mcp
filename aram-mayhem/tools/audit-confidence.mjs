// 置信措辞审计：结论说的「有多确定」，跟它点名的那个对象的样本量匹配吗？
//
// 这是「结论有没有意义」里唯一能机器判的部分。别的（结论有不有用）要人看，
// 但**置信度与样本不匹配**是可查的，而且是真 bug：
//
//   结论：最吃力的是对面有 X（12 把，残差 -20.3）… 样本量够，这几条可以当真。
//
// 12 把的胜率 95% 区间大约 ±28 个百分点，残差 -20.3 跟 0 根本区分不开 ——
// 说「可以当真」是**超出数据撑得起的把握**。用户照着改出装，可能是在追噪声。
//
// 判据：从结论里抽出它点名的样本量（「N 把」），取最小值；
// 再看措辞是「强把握」还是「有保留」。强把握 + 样本小 = 过度声称。
//
// 阈值 30 的来由：这是本仓库各处用的「单个分组下结论」门槛量级
// （matchups 用 12、combat 用 15、trend 用 5 局/周但至少 2 周）——
// 对**被点名的单个对象**来说，30 以下都撑不起「可以当真」这种话。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 强把握措辞：出现这些就等于在对用户说「信我」
const STRONG = /可以当真|够下结论|明显|确凿|确定是|样本量够|很稳|相当明显/;
// 有保留的措辞：出现这些说明工具自己已经打了折扣
const HEDGED = /样本少|样本不足|先当参考|仅供参考|不足以|可能|大概|谨慎|还不多|样本还/;

/** 判据本体（抽出来便于自测） */
export function overclaim(verdict) {
  if (HEDGED.test(verdict)) return null; // 自己已打折扣就不算过度声称
  if (!STRONG.test(verdict)) return null; // 没有强把握措辞
  // 只数**样本量**。要排除「连输 3 把及以上」这种门槛数字 —— 那个 3 是连败计数，
  // 不是样本量（第一版把它当成样本，误报了 get_my_tilt）。
  const samples = [...verdict.matchAll(/(\d+)\s*(?:把|局|次)(?!及以上|以上)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0);
  if (!samples.length) return null;
  const min = Math.min(...samples);
  if (min >= 30) return null;
  return `说「${(verdict.match(STRONG) ?? [""])[0]}」，但结论点名的对象最小的样本只有 ${min}（阈值 30）`;
}

if (process.argv.includes("--selftest")) {
  const cases = [
    ["结论：最吃力的是对面有 X（12 把，残差 -20.3）—— 样本量够，这几条可以当真。", true],
    ["结论：最近 4 个有效周 58 把 50.0%，之前 4 个 42 把 40.5% —— 最近好了 9.5 个百分点。", false],
    ["结论：连输 2 把及以上之后 71 局 49.3% —— 明显走低。", false],
    ["结论：你伤害全队第一时 110 局 61.8%，排到第三及以后 128 局 49.2% —— 差得明显。", false],
    ["结论：最吃力的是对面有 X（12 把）—— 但样本还不多，先当参考。", false],
    ["结论：输一把后 143 局 50.3%，连输 3 把及以上 36 局 47.2% —— 明显走低。", false],
  ];
  let bad = 0;
  for (const [text, shouldCatch] of cases) {
    const hit = overclaim(text);
    const ok = shouldCatch ? !!hit : !hit;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${shouldCatch ? "应报错" : "应放过"}：${text.slice(0, 66)}`);
    if (hit) console.log(`      → ${hit}`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过` : `✓ 自测通过（${cases.length} 条）`);
  process.exit(bad ? 1 : 0);
}

const CASES = [
  "get_my_trend", "get_my_tilt", "get_my_contribution", "get_my_patches",
  "get_enemy_comps", "get_combat_profile", "get_my_matchups", "get_my_checkup",
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

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "conf", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

let problems = 0;
let checked = 0;
for (const tool of CASES) {
  const r = await send("tools/call", { name: tool, arguments: {} });
  const text = r.result?.content?.[0]?.text ?? "";
  const verdicts = text.split("\n").filter((l) => l.startsWith("结论：") || /：队内第一 .*差 .* 个百分点/.test(l));
  for (const v of verdicts) {
    checked++;
    const bad = overclaim(v);
    if (bad) {
      problems++;
      console.log(`✗ ${tool}\n    ${bad}\n    ${v.slice(0, 130)}`);
    }
  }
}
child.kill();

console.log("");
console.log(problems ? `✗ ${problems} 处结论的把握超出了样本撑得起的程度（共查 ${checked} 处）` : `✓ ${checked} 处结论的置信措辞都与样本相符`);
process.exit(problems ? 1 : 0);
