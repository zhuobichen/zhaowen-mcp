// 与原始数据对账：工具报的数，跟直接从归档里独立算出来的对得上吗？
//
// 为什么这一层比前面十二层都强：前面全是**拿工具跟自己比** ——
// 跨工具一致、结论在明细里、方向没反、置信措辞与样本匹配……
// 但如果某个过滤器悄悄算错了（多算一种队列、同一局数了两次、漏掉没读到的行），
// 十二层内部检查会**全部通过**，因为它们会一致地同意那个错数。
//
// 这一层不看工具，只看 data/archive/lol-matches.json：自己 filter、自己数，
// 再跟工具打印的数字比。这是唯一一次「有外部真值」的检查。
//
// 顺序很重要：先调工具（它会把实时对局并进归档），**再**读归档来算 ——
// 否则工具能看到比归档更新的数据，比出来全是「工具多算了几局」的假差异。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 海斗的判据是**两条取并集**（见 lib/lcu.ts isMayhemGame）：
//   · queueId 在 [2400, 2410, 2450, 3270]
//   · 或者 gameMode 属于 KIWI 系（SGP 记录里 gameMode 可能为空，队列 id 一定在）
// 第一版只写了 queueId 那条，于是少算一局（4310 + JADE），报出「工具多算了 1 局」。
// **教训：独立验证要复现完整的规格，不是复现我脑子里那个简化版。**
// 查下来是审计错了、工具对的 —— 这个结论只有把两条都实现之后才站得住。
const MAYHEM_QUEUES = [2400, 2410, 2450, 3270];
const MAYHEM_MODES = ["KIWI", "KIWI_JADE", "JADE", "ARAM_MAYHEM", "MAYHEM"];
const profile = JSON.parse(readFileSync(path.join(ROOT, "data/profile.json"), "utf8"));
const ME = profile.puuid;
const ME_NAME = profile.summonerName ?? "";

/** 独立实现：从归档里算我的海斗战绩。刻意不复用 lib/ 的任何代码 —— 那样才有对账意义。 */
function recompute() {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "data/archive/lol-matches.json"), "utf8"));
  const games = Object.values(raw.games);
  let games_ = 0;
  let wins = 0;
  let kills = 0;
  const champs = new Map();
  for (const g of games) {
    const isMayhem =
      MAYHEM_QUEUES.includes(Number(g.queueId)) ||
      MAYHEM_MODES.includes(String(g.gameMode ?? "").toUpperCase());
    if (!isMayhem) continue;
    const me = (g.participants ?? []).find((p) => p.puuid === ME);
    const s = me?.stats;
    if (!s || s.win === undefined) continue;
    games_++;
    if (s.win === true) wins++;
    kills += Number(s.kills ?? 0);
    const cid = String(me.championId ?? "");
    champs.set(cid, (champs.get(cid) ?? 0) + 1);
  }
  return { games: games_, wins, winRate: games_ ? (wins / games_) * 100 : 0, kills, champs };
}

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

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "recompute", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

// 先调几个会报「我的总局数 / 胜率」的工具 —— 顺带把它们看到的新对局并进归档
const PROBES = ["get_my_checkup", "get_my_matchups", "get_my_teammates", "get_my_builds"];
const reported = {};
for (const tool of PROBES) {
  const r = await send("tools/call", { name: tool, arguments: {} });
  reported[tool] = r.result?.content?.[0]?.text ?? "";
}
child.kill();

// **再**读归档算 —— 顺序不能反
const truth = recompute();

console.log(`独立重算（只读 data/archive/lol-matches.json，不复用 lib/ 任何代码）：`);
console.log(`  我的海斗局数 ${truth.games} · 胜 ${truth.wins} · 胜率 ${truth.winRate.toFixed(1)}% · 累计击杀 ${truth.kills}`);
console.log(`  账号：${ME_NAME}（${ME.slice(0, 8)}…）\n`);

let bad = 0;
const CHECKS = [
  ["get_my_checkup", /(\d+)\s*把海斗/],
  ["get_my_matchups", /(\d+)\s*把海斗里/],
  ["get_my_teammates", /(\d+)\s*把海斗里/],
  ["get_my_builds", /(\d+)\s*把海斗中/],
];
for (const [tool, re] of CHECKS) {
  const text = reported[tool] ?? "";
  const m = re.exec(text);
  const got = m ? Number(m[1]) : null;
  const ok = got === truth.games;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${tool.padEnd(22)} 报 ${got ?? "—"} 把　独立重算 ${truth.games} 把`);
}

// 胜率
const rateChecks = [
  ["get_my_checkup", /胜率\s*(\d+\.\d)%/],
  ["get_my_matchups", /基准胜率\s*(\d+\.\d)%/],
];
for (const [tool, re] of rateChecks) {
  const text = reported[tool] ?? "";
  const m = re.exec(text);
  const got = m ? Number(m[1]) : null;
  const ok = got != null && Math.abs(got - truth.winRate) < 0.06; // 允许四舍五入
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${tool.padEnd(22)} 报 ${got ?? "—"}%　独立重算 ${truth.winRate.toFixed(1)}%`);
}

// 英雄维度：出装/英雄池里提到的最常玩英雄，出现次数对不对
{
  const text = reported["get_my_builds"] ?? "";
  const top = [...truth.champs.entries()].sort((a, b) => b[1] - a[1])[0];
  const cidMap = JSON.parse(readFileSync(path.join(ROOT, "data/champion-ids.json"), "utf8"));
  const name = cidMap[top?.[0]]?.name ?? null;
  if (name) {
    const re = new RegExp(name + "[^\\n]*?(\\d+)\\s*把");
    const m = re.exec(text);
    if (m) {
      const ok = Number(m[1]) === top[1];
      if (!ok) bad++;
      console.log(`${ok ? "✓" : "✗"} 取数抽查：最常玩 ${name}　出装报告里 ${m[1]} 把　独立重算 ${top[1]} 把`);
    } else {
      console.log(`· 取数抽查：${name} 在出装报告里没有对应行（那个工具统计的是装备不是英雄），跳过`);
    }
  }
}

console.log("");
console.log(bad ? `✗ ${bad} 处与原始数据对不上` : "✓ 所有抽查项都与原始数据一致");
process.exit(bad ? 1 : 0);
