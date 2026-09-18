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

// ---------------------------------------------------------------- 另外三个维度独立重算
//
// 上一轮只对账了局数和胜率。这三个维度各有自己的过滤，**正是容易算错的地方**：
//   · 装备：成装 vs 散件（价格门槛）、二级鞋算不算、同一局同一件只算一次
//   · 队友：多局要合并、「同一局数了两次」是最经典的错
//   · 符文：同一局拿到重复符文要去重；「其他人」基线还要剔掉自己
// 每一处都按 lib/ 里的**完整规格**重新实现（上一轮教训：独立验证要复现完整规格，
// 不是复现我脑子里那个简化版）。

const items = JSON.parse(readFileSync(path.join(ROOT, "data/items.json"), "utf8"));
const augDefs = JSON.parse(readFileSync(path.join(ROOT, "data/augments.json"), "utf8"));
const archive = JSON.parse(readFileSync(path.join(ROOT, "data/archive/lol-matches.json"), "utf8"));
const mayhemGames = Object.values(archive.games).filter(
  (g) =>
    MAYHEM_QUEUES.includes(Number(g.queueId)) ||
    MAYHEM_MODES.includes(String(g.gameMode ?? "").toUpperCase())
);

/** 复现 store.ts isBuildItem 的规格：成装，或已升级的二级鞋 */
function isBuildItem(it) {
  if (!it) return false;
  if (it.categories.includes("Trinket") || it.categories.includes("Consumable")) return false;
  if (it.categories.includes("Boots")) return it.price >= 900;
  return it.price >= 2000;
}

// ① 装备
{
  const stat = new Map();
  for (const g of mayhemGames) {
    const me = (g.participants ?? []).find((p) => p.puuid === ME);
    if (!me?.stats || me.stats.win === undefined) continue;
    const seen = new Set();
    for (let i = 0; i <= 6; i++) {
      const id = Number(me.stats[`item${i}`] ?? 0);
      if (!id || seen.has(id) || !isBuildItem(items[String(id)])) continue;
      seen.add(id);
      const c = stat.get(id) ?? { g: 0, w: 0 };
      c.g++;
      if (me.stats.win === true) c.w++;
      stat.set(id, c);
    }
  }
  const top = [...stat.entries()].sort((a, b) => b[1].g - a[1].g)[0];
  const name = top ? items[String(top[0])]?.name : null;
  if (name) {
    const m = new RegExp(name + "[^\\n]*?(\\d+)\\s*把").exec(reported["get_my_builds"] ?? "");
    const ok = m && Number(m[1]) === top[1].g;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} 装备：最常出 ${name}　工具报 ${m ? m[1] : "—"} 把　独立重算 ${top[1].g} 把`);
  }
}

// ② 队友
{
  const mates = new Map();
  for (const g of mayhemGames) {
    const parts = g.participants ?? [];
    if (parts.length < 2) continue;
    const me = parts.find((p) => p.puuid === ME);
    if (!me) continue;
    for (const p of parts) {
      if (!p.puuid || p.puuid === ME || p.teamId !== me.teamId) continue;
      mates.set(p.puuid, (mates.get(p.puuid) ?? 0) + 1);
    }
  }
  const top = [...mates.entries()].sort((a, b) => b[1] - a[1])[0];
  let name = null;
  for (const g of mayhemGames) {
    const p = (g.participants ?? []).find((x) => x.puuid === top?.[0]);
    if (p?.name) {
      name = p.name;
      break;
    }
  }
  if (name) {
    const m = new RegExp(name + "[^\\n]*?同队\\s*(\\d+)\\s*局").exec(reported["get_my_teammates"] ?? "");
    const ok = m && Number(m[1]) === top[1];
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} 队友：同队最多的是 ${name}　工具报 ${m ? m[1] : "—"} 局　独立重算 ${top[1]} 局`);
  } else {
    console.log("· 队友：归档里没找到该账号的显示名，跳过");
  }
}

// ③ 符文：我自己拿过的符文，以及「其他人」基线的样本量
{
  const others = new Map();
  let otherRows = 0;
  for (const g of mayhemGames) {
    for (const p of g.participants ?? []) {
      if (p.puuid === ME) continue; // ← othersAugmentRates 的关键过滤
      const s = p.stats ?? {};
      if (s.win === undefined) continue;
      const ids = new Set();
      for (let i = 1; i <= 6; i++) {
        const v = Number(s[`playerAugment${i}`] ?? 0);
        if (v) ids.add(v); // ← 同一局重复拿到要去重
      }
      if (!ids.size) continue;
      otherRows++;
      for (const id of ids) {
        const c = others.get(id) ?? { g: 0, w: 0 };
        c.g++;
        if (s.win === true) c.w++;
        others.set(id, c);
      }
    }
  }
  const freq = new Map();
  for (const g of mayhemGames) {
    const me = (g.participants ?? []).find((p) => p.puuid === ME);
    const s = me?.stats ?? {};
    const seen = new Set();
    for (let i = 1; i <= 6; i++) {
      const v = Number(s[`playerAugment${i}`] ?? 0);
      if (v && !seen.has(v)) {
        seen.add(v);
        freq.set(v, (freq.get(v) ?? 0) + 1);
      }
    }
  }
  // 拿 checkup 实际点名的那件符文来对账 —— 它会说「X：你 N 把低于同批人 M 个百分点」，
  // 这句里的 N、M 都能从归档独立算出来。「其他人」基线有剔除自己这个关键过滤，
  // 算错了这条就是错的（而且是往「显得你有问题」的方向错）。
  const chk = reported["get_my_checkup"] ?? "";
  const named = /【符文用不[来好]的?】([^：]+)：你 (\d+) 把[^\d]*([\d.]+) 个百分点/.exec(chk);
  if (named) {
    const [, augName, myGames, gapStr] = named;
    const def = augDefs.find((a) => a.name === augName);
    const mine = freq.get(def?.officialId) ?? 0;
    // 我自己拿它的胜率
    let mw = 0;
    let mg = 0;
    for (const g of mayhemGames) {
      const me = (g.participants ?? []).find((p) => p.puuid === ME);
      const s = me?.stats ?? {};
      if (s.win === undefined) continue;
      const ids = new Set();
      for (let i = 1; i <= 6; i++) {
        const v = Number(s[`playerAugment${i}`] ?? 0);
        if (v) ids.add(v);
      }
      if (!ids.has(def?.officialId)) continue;
      mg++;
      if (s.win === true) mw++;
    }
    const o = others.get(def?.officialId);
    const myRate = mg ? (mw / mg) * 100 : 0;
    const otherRate = o ? (o.w / o.g) * 100 : 0;
    const gap = myRate - otherRate;
    const gamesOk = Number(myGames) === mg;
    const gapOk = Math.abs(gap + Number(gapStr)) < 0.15; // checkup 说的是「低于」，取负
    const ok = gamesOk && gapOk;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 符文：${augName}　工具报「你 ${myGames} 把，低于同批人 ${gapStr} 个百分点」` +
        `　独立重算「你 ${mg} 把（${myRate.toFixed(1)}%），同批人 ${o?.g ?? 0} 行（${otherRate.toFixed(1)}%）→ 差 ${gap.toFixed(1)}」`
    );
    if (!ok) {
      if (!gamesOk) console.log(`      局数不符：工具 ${myGames} vs 重算 ${mg}`);
      if (!gapOk) console.log(`      差值不符：工具 ${gapStr} vs 重算 ${Math.abs(gap).toFixed(1)}`);
    }
  } else {
    console.log(`· 符文：checkup 这次没有点名符文（样本不足），跳过对账；全归档非我行数 ${otherRows}`);
  }
}

console.log("");
console.log(bad ? `✗ ${bad} 处与原始数据对不上` : "✓ 所有抽查项都与原始数据一致");
process.exit(bad ? 1 : 0);
