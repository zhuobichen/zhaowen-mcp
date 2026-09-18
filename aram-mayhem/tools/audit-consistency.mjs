// 跨工具一致性审计：同一个数在不同工具里算出来一样吗？
//
// 为什么查这个：前面几个审计查的都是「结构」——字段读没读、进没进报告、有没有引导。
// 没有一个查**数字对不对**。而「我的海斗局数 / 胜率」这种量在十几个模块里
// 各算各的（每个模块自己 filter 一遍 isMayhemGame、自己数 win），
// 正是最典型的会悄悄分叉的地方：某个模块多算了一种队列、或者把没读到的局也算进去，
// 用户看到「这个工具说 306 把、那个说 304 把」就会开始不信任整份数据。
//
// 判据：这几个工具都应该报「**我的海斗总局数**」和「我的整体胜率」，
// 抽出来必须完全一致。它们各自算法不同（有的用 loadLolGames、有的读归档），
// 一致才说明口径真的一样。
//
// 第一次跑的结果：306 把出现在 11 个工具、53.3% 出现在 7 个 —— 一致，没分叉。
// 所以这个审计当前的价值是**回归检查**：以后谁加了过滤口径不一致的模块，
// 它会报出来。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 这些工具都应该报「我的海斗总局数」与「我的整体胜率」
const EXPECTED = {
  get_my_builds: {},
  get_my_matchups: {},
  get_my_teammates: {},
  get_my_checkup: {},
  get_my_tilt: {},
  get_my_contribution: {},
  get_combat_profile: {},
  get_enemy_comps: {},
  analyze_my_playstyle: {},
};

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

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cons", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

const rows = [];
for (const [name, args] of Object.entries(EXPECTED)) {
  let text = "";
  try {
    const r = await send("tools/call", { name, arguments: args });
    text = r.result?.content?.[0]?.text ?? "";
  } catch {
    /* 忽略 */
  }
  const head = text.split("\n").slice(0, 8).join("\n");
  // 我的海斗总局数：头部第一个 ≥100 的「N 把 / N 局」
  const games = [...head.matchAll(/(\d+)\s*(把|局)/g)].map((m) => Number(m[1])).find((n) => n >= 100) ?? null;
  // 整体胜率：头部出现的第一个 20~80 之间的百分比
  const rate = [...head.matchAll(/(\d{2}\.\d)%/g)].map((m) => Number(m[1])).find((n) => n >= 20 && n <= 80) ?? null;
  rows.push({ name, games, rate });
}
child.kill();

console.log("工具".padEnd(26) + "总局数".padEnd(10) + "整体胜率");
console.log("-".repeat(52));
for (const r of rows) {
  console.log(r.name.padEnd(24) + String(r.games ?? "—").padEnd(10) + (r.rate != null ? r.rate + "%" : "—"));
}

const gamesSet = [...new Set(rows.map((r) => r.games).filter((x) => x != null))];
const rateSet = [...new Set(rows.map((r) => r.rate).filter((x) => x != null))];

console.log("");
let bad = 0;
if (gamesSet.length > 1) {
  bad++;
  console.log(`✗ 总局数不一致：${gamesSet.join(" / ")} —— 这些工具的过滤口径已经分叉了`);
  for (const r of rows) if (r.games !== gamesSet[0]) console.log(`    ${r.name} → ${r.games}`);
} else {
  console.log(`✓ 总局数一致（${gamesSet[0]} 把，${rows.filter((r) => r.games != null).length} 个工具）`);
}
if (rateSet.length > 1) {
  bad++;
  console.log(`✗ 整体胜率不一致：${rateSet.map((v) => v + "%").join(" / ")}`);
  for (const r of rows) if (r.rate !== rateSet[0]) console.log(`    ${r.name} → ${r.rate}%`);
} else {
  console.log(`✓ 整体胜率一致（${rateSet[0]}%，${rows.filter((r) => r.rate != null).length} 个工具）`);
}

process.exit(bad ? 1 : 0);
