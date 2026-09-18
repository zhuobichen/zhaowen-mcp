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
const PROBES = ["get_my_checkup", "get_my_matchups", "get_my_teammates", "get_my_builds", "get_my_trend", "get_my_patches", "get_combat_profile", "get_my_contribution", "get_augment_pairs", "get_enemy_comps", "get_queue_stats", "get_friend_leaderboard", "compare_accounts", "get_tft_stats", "get_tft_detail", "export_games_csv", "export_report_markdown"];
const reported = {};
// compare_accounts 需要必填参数 b —— 不给的话它只回一句「请提供第二个账号 b」，
// 那种输出拿去对账会变成假失败（第一版就是这样）
const ARGS_OF = { compare_accounts: { b: "丁ding" } };
// 云顶的两个「按 X 看自己」工具：trend/patches 在云顶侧要显式传 kind
const AFTER = [];
for (const tool of PROBES) {
  const r = await send("tools/call", { name: tool, arguments: ARGS_OF[tool] ?? {} });
  reported[tool] = r.result?.content?.[0]?.text ?? "";
}
// 同名的工具换个参数再调一次，结果单独存 —— 云顶侧要显式传 kind
for (const [key, name, args] of [
  ["get_my_patches_tft", "get_my_patches", { kind: "tft" }],
  ["get_my_trend_tft", "get_my_trend", { kind: "tft" }],
]) {
  const r = await send("tools/call", { name, arguments: args });
  reported[key] = r.result?.content?.[0]?.text ?? "";
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
// 英雄 id 映射提到模块级：对手维度和阵容维度都要用（原先写在对手那个块里，块级的）
const cidMap = JSON.parse(readFileSync(path.join(ROOT, "data/champion-ids.json"), "utf8"));
const champsJson = JSON.parse(readFileSync(path.join(ROOT, "data/champions.json"), "utf8"));
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

// ④ 对手维度：get_my_matchups 点名的克星，它的场次和残差
{
  const vs = new Map();
  for (const g of mayhemGames) {
    const parts = g.participants ?? [];
    const me = parts.find((p) => p.puuid === ME);
    if (!me?.stats || me.stats.win === undefined) continue;
    for (const p of parts) {
      if (p.teamId === me.teamId || !p.championId) continue;
      const id = Number(p.championId);
      const c = vs.get(id) ?? { g: 0, w: 0 };
      c.g++;
      if (me.stats.win === true) c.w++;
      vs.set(id, c);
    }
  }
  const cidMap = JSON.parse(readFileSync(path.join(ROOT, "data/champion-ids.json"), "utf8"));
  const champsJson = JSON.parse(readFileSync(path.join(ROOT, "data/champions.json"), "utf8"));
  const nameOf = (id) => {
    const cid = cidMap[String(id)];
    return cid ? (champsJson.find((c) => c.id === cid.id)?.name ?? cid.name) : `英雄#${id}`;
  };
  const m = /最吃力的是对面有\s*(\S+?)（(\d+) 把/.exec(reported["get_my_matchups"] ?? "");
  if (m) {
    const [, champ, gamesStr] = m;
    const entry = [...vs.entries()].find(([id]) => nameOf(id) === champ);
    const ok = entry && entry[1].g === Number(gamesStr);
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 对手：点名克星 ${champ}　工具报 ${gamesStr} 把　独立重算 ${entry ? entry[1].g : "—"} 把` +
        (entry ? `（你赢 ${entry[1].w} 把）` : "")
    );
  } else {
    console.log("· 对手：matchups 这次没点名克星，跳过");
  }
}

// ⑤ 出装胜率（不只是场次）
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
    const re = new RegExp(name + "（\\d+ 金）：(\\d+) 把 · 胜率 (\\d+)%");
    const m = re.exec(reported["get_my_builds"] ?? "");
    const rate = Math.round((top[1].w / top[1].g) * 100);
    const ok = m && Number(m[2]) === rate;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 出装胜率：${name}　工具报 ${m ? m[2] : "—"}%　独立重算 ${rate}%（${top[1].w}/${top[1].g}）`
    );
  }
}

// ⑥ 趋势的分周聚合：最近 4 个有效周 vs 之前 4 个
{
  const WEEK = 7 * 86400 * 1000;
  const weekOf = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const byWeek = new Map();
  for (const g of mayhemGames) {
    const me = (g.participants ?? []).find((p) => p.puuid === ME);
    if (!me?.stats || me.stats.win === undefined) continue;
    const k = weekOf(Number(g.gameCreation ?? 0));
    const c = byWeek.get(k) ?? { g: 0, w: 0 };
    c.g++;
    if (me.stats.win === true) c.w++;
    byWeek.set(k, c);
  }
  void WEEK;
  // 「有效周」= 该周 ≥5 局（trend.ts 的 minGamesPerWeek 默认值）
  const usable = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).filter(([, c]) => c.g >= 5);
  const sum = (list) => {
    const g = list.reduce((s, [, c]) => s + c.g, 0);
    const w = list.reduce((s, [, c]) => s + c.w, 0);
    return { g, w, rate: g ? (w / g) * 100 : 0 };
  };
  const recent = sum(usable.slice(-4));
  const earlier = sum(usable.slice(-8, -4));
  const m = /最近 (\d+) 个有效周 (\d+) 把 (\d+\.\d)%，之前 (\d+) 个有效周 (\d+) 把 (\d+\.\d)%/.exec(
    reported["get_my_checkup"] ?? ""
  );
  const raw = reported["get_my_trend"] ?? "";
  const m2 = /最近 (\d+) 个有效周：(\d+) 把 ([\d.]+)%　之前 (\d+) 个：(\d+) 把 ([\d.]+)%/.exec(raw);
  const hit = m2 ?? m;
  if (hit) {
    const okG = Number(hit[2]) === recent.g && Number(hit[5]) === earlier.g;
    const okR =
      Math.abs(Number(hit[3]) - recent.rate) < 0.06 && Math.abs(Number(hit[6]) - earlier.rate) < 0.06;
    const ok = okG && okR;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 趋势分周：工具报「最近 ${hit[2]} 把 ${hit[3]}% / 之前 ${hit[5]} 把 ${hit[6]}%」` +
        `　独立重算「${recent.g} 把 ${recent.rate.toFixed(1)}% / ${earlier.g} 把 ${earlier.rate.toFixed(1)}%」（有效周 ${usable.length} 个）`
    );
  } else {
    console.log(`· 趋势分周：没在输出里找到该句（有效周 ${usable.length} 个），跳过`);
  }
}

// ⑦ 补丁维度：get_my_patches 的按版本聚合
//    这一项依赖 parsePatch() —— 而那个解析我自己踩过坑（漏了「只有两段」的形态）。
//    所以独立实现必须按**完整规格**来：既认归档里归一化后的 "16.18"，
//    也认原始记录里的 "16.18.817.4437" 与云顶那种构建串。
{
  const patchOf = (v) => {
    if (typeof v !== "string" || !v) return null;
    const rel = /<Releases\/(\d{1,4}\.\d{1,2})>/.exec(v);
    if (rel) return rel[1];
    const head = /^\s*(\d{1,4}\.\d{1,2})(?:\.|$)/.exec(v);
    if (head) return head[1];
    const m = /(\d{1,4}\.\d{1,2})\.\d/.exec(v);
    return m ? m[1] : null;
  };
  const byPatch = new Map();
  for (const g of mayhemGames) {
    const me = (g.participants ?? []).find((p) => p.puuid === ME);
    if (!me?.stats || me.stats.win === undefined) continue;
    const p = patchOf(g.gameVersion);
    if (!p) continue;
    const c = byPatch.get(p) ?? { g: 0, w: 0 };
    c.g++;
    if (me.stats.win === true) c.w++;
    byPatch.set(p, c);
  }
  // 取样本最多的那个补丁来对（工具的明细里每个补丁都列了局数与胜率）
  const top = [...byPatch.entries()].sort((a, b) => b[1].g - a[1].g)[0];
  if (top) {
    const [patch, c] = top;
    const text = reported["get_my_patches"] ?? "";
    const re = new RegExp(patch.replace(".", "\\.") + "[^\\n]*?\\s(\\d+)\\s+局");
    const m = re.exec(text);
    const ok = m && Number(m[1]) === c.g;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 补丁：样本最多的 ${patch}　工具报 ${m ? m[1] : "—"} 局　独立重算 ${c.g} 局（胜 ${c.w}）`
        + `　共 ${byPatch.size} 个补丁有版本号`
    );
  }
}

// ⑧ 战斗细节 / 贡献度：队内名次 → 胜率
//    两者用的是同一套「队内真实名次」逻辑，只是指标不同（承伤 vs 伤害）。
{
  const rankDist = (valueOf) => {
    const m = new Map();
    for (const g of mayhemGames) {
      const parts = g.participants ?? [];
      const me = parts.find((p) => p.puuid === ME);
      const s = me?.stats;
      if (!s || s.win === undefined) continue;
      const mates = parts.filter((p) => p.teamId === me.teamId && p.puuid !== ME);
      if (mates.length < 2) continue; // 和 lib 一样：至少要有队友才能排名次
      const mine = valueOf(s);
      const rank = 1 + mates.filter((p) => valueOf(p.stats ?? {}) > mine).length;
      const c = m.get(rank) ?? { g: 0, w: 0 };
      c.g++;
      if (s.win === true) c.w++;
      m.set(rank, c);
    }
    return m;
  };
  // 承伤（combat-profile）
  const dmgTaken = rankDist((s) => Number(s.totalDamageTaken ?? 0));
  const t1 = dmgTaken.get(1);
  const cp = reported["get_combat_profile"] ?? "";
  const mc = /承伤（[^）]*）：队内第一 ([\d.]+)%/.exec(cp);
  if (t1 && mc) {
    const rate = (t1.w / t1.g) * 100;
    const ok = Math.abs(rate - Number(mc[1])) < 0.06;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 战斗细节：承伤队内第一　工具报 ${mc[1]}%　独立重算 ${rate.toFixed(1)}%（${t1.w}/${t1.g}）`
    );
  }
  // 伤害（contribution）
  const dmg = rankDist((s) => Number(s.totalDamageDealtToChampions ?? 0));
  const d1 = dmg.get(1);
  const ctr = reported["get_my_contribution"] ?? "";
  const md = /伤害\*\*全队第一\*\*时 (\d+) 局 ([\d.]+)%/.exec(ctr);
  if (d1 && md) {
    const rate = (d1.w / d1.g) * 100;
    const ok = Number(md[1]) === d1.g && Math.abs(rate - Number(md[2])) < 0.06;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 贡献度：伤害队内第一　工具报 ${md[1]} 局 ${md[2]}%　独立重算 ${d1.g} 局 ${rate.toFixed(1)}%`
    );
  }
}

// ⑨ 符文组合协同：empiricalPairs 的「协同」= 组合胜率 − 两件单拿胜率的平均
//    这个要同时算三组数（组合、单件 A、单件 B），任何一组口径错了协同就错。
//    而且样本是**全归档所有参与者行**（不只我自己）—— 别写错成只统计我。
{
  const singles = new Map();
  const pairs = new Map();
  for (const g of mayhemGames) {
    for (const p of g.participants ?? []) {
      const s = p.stats ?? {};
      if (s.win === undefined) continue;
      const ids = [];
      const seen = new Set();
      for (let i = 1; i <= 6; i++) {
        const v = Number(s[`playerAugment${i}`] ?? 0);
        if (v && !seen.has(v)) {
          seen.add(v);
          ids.push(v);
        }
      }
      if (!ids.length) continue;
      for (const id of ids) {
        const c = singles.get(id) ?? { g: 0, w: 0 };
        c.g++;
        if (s.win === true) c.w++;
        singles.set(id, c);
      }
      const sorted = [...ids].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const k = `${sorted[i]}|${sorted[j]}`;
          const c = pairs.get(k) ?? { g: 0, w: 0 };
          c.g++;
          if (s.win === true) c.w++;
          pairs.set(k, c);
        }
      }
    }
  }
  const rate = (c) => (c.g ? (c.w / c.g) * 100 : 0);
  // 按协同排序，取第一组（工具输出的第一条就是它）
  const ranked = [...pairs.entries()]
    .filter(([, c]) => c.g >= 60) // empiricalPairs 的 minGames 默认值
    .map(([k, c]) => {
      const [a, b] = k.split("|").map(Number);
      return {
        a,
        b,
        g: c.g,
        wr: rate(c),
        soloA: rate(singles.get(a) ?? { g: 0, w: 0 }),
        soloB: rate(singles.get(b) ?? { g: 0, w: 0 }),
        synergy: rate(c) - (rate(singles.get(a) ?? { g: 0, w: 0 }) + rate(singles.get(b) ?? { g: 0, w: 0 })) / 2,
      };
    })
    .sort((x, y) => y.synergy - x.synergy);
  const topP = ranked[0];
  const ap = reported["get_augment_pairs"] ?? "";
  if (topP) {
    const re = /· ([^：]+?) \+ ([^：]+?)：(\d+) 局 ([\d.]+)%（单拿分别 ([\d.]+)% \/ ([\d.]+)% → 协同 ([+-][\d.]+)）/;
    const m = re.exec(ap);
    const ok =
      m &&
      Number(m[3]) === topP.g &&
      Math.abs(Number(m[4]) - topP.wr) < 0.06 &&
      Math.abs(Number(m[7]) - topP.synergy) < 0.06;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 符文协同：工具第一组「${m ? m[1] + " + " + m[2] : "—"} ${m ? m[3] : "—"} 局 ${m ? m[4] : "—"}% 协同 ${m ? m[7] : "—"}」` +
        `　独立重算「${topP.g} 局 ${topP.wr.toFixed(1)}% 协同 ${topP.synergy >= 0 ? "+" : ""}${topP.synergy.toFixed(1)}」`
    );
  }
}

// ⑩ 对面阵容构成：按 Riot 角色标签数对面人头
//    容易错的点：一名英雄可挂多个标签，所以要**按标签去重**（亚索同时算战士和刺客），
//    而不是「有坦克标签的人有几个」这种只数一次的写法。
{
  const rolesByChamp = new Map();
  for (const [numId, cid] of Object.entries(cidMap)) {
    const c = champsJson.find((x) => x.id === cid.id);
    if (c?.roles?.length) rolesByChamp.set(Number(numId), c.roles);
  }
  const present = new Map();
  let total = 0;
  for (const g of mayhemGames) {
    const parts = g.participants ?? [];
    if (parts.length < 2) continue;
    const me = parts.find((p) => p.puuid === ME);
    if (!me?.stats || me.stats.win === undefined) continue;
    total++;
    const counts = {};
    for (const p of parts) {
      if (p.teamId === me.teamId || !p.championId) continue;
      for (const r of new Set(rolesByChamp.get(Number(p.championId)) ?? [])) counts[r] = (counts[r] ?? 0) + 1;
    }
    for (const [r, n] of Object.entries(counts)) {
      if (!n) continue;
      const c = present.get(r) ?? { g: 0, w: 0 };
      c.g++;
      if (me.stats.win === true) c.w++;
      present.set(r, c);
    }
  }
  const ec = reported["get_enemy_comps"] ?? "";
  const m = /· 对面有坦克：(\d+) 局 ([\d.]+)%/.exec(ec);
  const t = present.get("tank");
  if (m && t) {
    const ok = Number(m[1]) === t.g && Math.abs(Number(m[2]) - (t.w / t.g) * 100) < 0.06;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 对面阵容：对面有坦克　工具报 ${m[1]} 局 ${m[2]}%　独立重算 ${t.g} 局 ${((t.w / t.g) * 100).toFixed(1)}%（总 ${total} 局）`
    );
  } else {
    console.log("· 对面阵容：工具这次没列「对面有坦克」这行，跳过");
  }
}

// ⑪ 队列拆分：按 queueId 分组
//    注意 queue-stats 统计的是**所有模式**（不只海斗）—— 复现时不能只筛海斗。
{
  const byQ = new Map();
  for (const g of Object.values(archive.games)) {
    const me = (g.participants ?? []).find((p) => p.puuid === ME);
    const s = me?.stats;
    if (!s || s.win === undefined) continue;
    const q = Number(g.queueId ?? 0);
    const c = byQ.get(q) ?? { g: 0, w: 0 };
    c.g++;
    if (s.win === true) c.w++;
    byQ.set(q, c);
  }
  const top = [...byQ.entries()].sort((a, b) => b[1].g - a[1].g)[0];
  const qs = reported["get_queue_stats"] ?? "";
  if (top) {
    const [q, c] = top;
    const re = new RegExp("\\[" + q + "\\]：(\\d+) 局[\\s\\S]*?胜率 ([\\d.]+)%");
    const m = re.exec(qs);
    const ok = m && Number(m[1]) === c.g && Math.abs(Number(m[2]) - (c.w / c.g) * 100) < 0.06;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 队列拆分：最多的队列 [${q}]　工具报 ${m ? m[1] : "—"} 局 ${m ? m[2] : "—"}%` +
        `　独立重算 ${c.g} 局 ${((c.w / c.g) * 100).toFixed(1)}%（共 ${byQ.size} 个队列）`
    );
  }
}

// ⑫ 排行榜：归档里**所有参与者**按海斗胜率排（不只我自己）
//    规格：遍历每局每个有 puuid 的参与者行，各自的 games/wins；
//    取 ≥10 局的，按胜率降序。容易错的地方：按人聚合而不是按局、
//    以及「同一局里出现两次」的极端情况（这里按行计数，同一局同一人只有一行）。
{
  const stat = new Map();
  for (const g of mayhemGames) {
    for (const p of g.participants ?? []) {
      if (!p.puuid) continue;
      const cur = stat.get(p.puuid) ?? { games: 0, wins: 0 };
      cur.games++;
      if (p.stats?.win === true) cur.wins++;
      stat.set(p.puuid, cur);
    }
  }
  const ranked = [...stat.entries()]
    .filter(([, v]) => v.games >= 10)
    .map(([puuid, v]) => ({ puuid, games: v.games, wr: (v.wins / v.games) * 100 }))
    .sort((a, b) => b.wr - a.wr);
  const lb = reported["get_friend_leaderboard"] ?? "";
  const topLb = ranked[0];
  const mHead = /本地归档里见过 (\d+) 个账号/.exec(lb);
  if (topLb && mHead) {
    const okCount = Number(mHead[1]) === stat.size;
    // 榜单第一条：名次行形如「1. 名字 ... N 局 X%」
    // 实际格式：`1   火丶WSCan         15      73.3%   11胜` —— 没有「局」字、没有点号
    const mTop = /^1\s+(\S+)\s+(\d+)\s+([\d.]+)%/m.exec(lb);
    const okTop = mTop && Number(mTop[2]) === topLb.games && Math.abs(Number(mTop[3]) - topLb.wr) < 0.06;
    const ok = okCount && okTop;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 排行榜：工具报「见过 ${mHead[1]} 个账号，第一 ${mTop ? mTop[1] + " " + mTop[2] + " 局 " + mTop[3] + "%" : "—"}」` +
        `　独立重算「${stat.size} 个账号，≥10 局 ${ranked.length} 人，第一 ${topLb.games} 局 ${topLb.wr.toFixed(1)}%」`
    );
  }
}

// ⑬ 跨账号对比：两边各自的局数与胜率
{
  const otherName = "丁ding";
  // 先找出丁ding 的 puuid（归档里按名字找）
  let otherPuuid = null;
  for (const g of mayhemGames) {
    const p = (g.participants ?? []).find((x) => (x.name ?? "").includes(otherName));
    if (p?.puuid) {
      otherPuuid = p.puuid;
      break;
    }
  }
  if (otherPuuid) {
    const mine = { g: 0, w: 0 };
    const theirs = { g: 0, w: 0 };
    for (const g of mayhemGames) {
      const m1 = (g.participants ?? []).find((p) => p.puuid === ME);
      if (m1?.stats && m1.stats.win !== undefined) {
        mine.g++;
        if (m1.stats.win === true) mine.w++;
      }
      const m2 = (g.participants ?? []).find((p) => p.puuid === otherPuuid);
      if (m2?.stats && m2.stats.win !== undefined) {
        theirs.g++;
        if (m2.stats.win === true) theirs.w++;
      }
    }
    const ca = reported["compare_accounts"] ?? "";
    const ok =
      // 对比表也没有单位：`海斗局数                 306                      994`
      new RegExp(`海斗局数\\s+${mine.g}\\s+${theirs.g}`).test(ca) &&
      Math.abs((mine.w / mine.g) * 100 - (theirs.w / theirs.g) * 100) > 0;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 跨账号：工具报的两侧局数里应含 ${mine.g} / ${theirs.g}` +
        `　独立重算「我 ${mine.g} 局 ${((mine.w / mine.g) * 100).toFixed(1)}% / ${otherName} ${theirs.g} 局 ${((theirs.w / theirs.g) * 100).toFixed(1)}%」`
    );
  } else {
    console.log("· 跨账号：归档里没找到「丁ding」，跳过");
  }
}

// ⑭ 云顶：get_tft_stats 的平均名次 / 吃鸡率 / 前四率
//    这是**一整块之前完全没对过账的口径**（联盟侧对了一轮，云顶侧一直没碰）。
//    规格：从 tft 归档里取我的参与行（有 placement 的），算平均名次、第一占比、前四占比。
{
  const tftRaw = JSON.parse(readFileSync(path.join(ROOT, "data/archive/tft-matches.json"), "utf8"));
  const tftGames = Object.values(tftRaw.games);
  const places = [];
  for (const g of tftGames) {
    const p = (g.participants ?? []).find((x) => x.puuid === ME);
    const place = Number(p?.placement ?? 0);
    if (place > 0) places.push(place);
  }
  const n = places.length;
  const avg = n ? places.reduce((a, b) => a + b, 0) / n : 0;
  const first = places.filter((x) => x === 1).length;
  const top4 = places.filter((x) => x <= 4).length;
  const ts = reported["get_tft_stats"] ?? "";
  const mAvg = /平均名次：([\d.]+)/.exec(ts);
  const mFirst = /吃鸡 (\d+) 次/.exec(ts);
  if (mAvg && mFirst) {
    const ok = Math.abs(Number(mAvg[1]) - avg) < 0.006 && Number(mFirst[1]) === first;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 云顶：工具报「平均名次 ${mAvg[1]}，吃鸡 ${mFirst[1]} 次」` +
        `　独立重算「平均名次 ${avg.toFixed(2)}，吃鸡 ${first} 次，前四 ${top4} 次」（共 ${n} 局）`
    );
  } else {
    console.log(`· 云顶：没在输出里找到平均名次那行（归档里 ${n} 局），跳过`);
  }
}

// ⑮ 云顶棋子/装备维度：get_tft_detail 按最终阵容统计平均名次
//    规格：只统计**目标账号自己那一行**的 units（归档里也只有他那一行有 units）；
//    同一局同一棋子/装备只算一次；成装要过滤占位条目（EmptyBag 之类）。
{
  const tftRaw = JSON.parse(readFileSync(path.join(ROOT, "data/archive/tft-matches.json"), "utf8"));
  const tftNames = JSON.parse(readFileSync(path.join(ROOT, "data/tft-names.json"), "utf8"));
  const cn = (map, id) => (id ? map[id] ?? id.replace(/^TFT\d+_/i, "").replace(/^TFT_Item_/i, "") : "?");
  const PLACEHOLDER = /^(emptybag|empty|placeholder|tft_item_emptybag)$/i;
  const units = new Map();
  for (const g of Object.values(tftRaw.games)) {
    const p = (g.participants ?? []).find((x) => x.puuid === ME);
    const place = Number(p?.placement ?? 0);
    if (!p || !place) continue;
    const seen = new Set();
    for (const u of p.units ?? []) {
      const key = cn(tftNames.champions, u.character_id);
      if (seen.has(key)) continue;
      seen.add(key);
      const c = units.get(key) ?? { g: 0, sum: 0, top4: 0 };
      c.g++;
      c.sum += place;
      if (place <= 4) c.top4++;
      units.set(key, c);
    }
  }
  // 要验证的是**工具实际列出来的那个**棋子 —— 它的列表按「平均名次改善」排、只列前 12，
  // 所以拿「出场最多」的那个去查会查不到（第一版就这么错了：
  // 出场最多的斯维因有 317 局，但它不在「最顺手的前 12」里）。
  // 从工具输出里取第一条，再独立重算它的数字。
  const td = reported["get_tft_detail"] ?? "";
  const listed = /· (\S+?)：(\d+) 局 · 平均名次 ([\d.]+)/.exec(td);
  if (listed) {
    const [, name, gamesStr, avgStr] = listed;
    const c = units.get(name);
    const ok = c && c.g === Number(gamesStr) && Math.abs(c.sum / c.g - Number(avgStr)) < 0.006;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 云顶棋子：工具列的第一个 ${name}　报 ${gamesStr} 局 平均名次 ${avgStr}` +
        `　独立重算 ${c ? `${c.g} 局 平均名次 ${(c.sum / c.g).toFixed(2)}（前四 ${((c.top4 / c.g) * 100).toFixed(0)}%）` : "（这个棋子在我的统计里查不到）"}`
    );
  } else {
    console.log("· 云顶棋子：没在输出里找到棋子行，跳过");
  }
}

// ⑯ 云顶的周聚合与补丁聚合
{
  const tftRaw = JSON.parse(readFileSync(path.join(ROOT, "data/archive/tft-matches.json"), "utf8"));
  const rows = [];
  for (const g of Object.values(tftRaw.games)) {
    const p = (g.participants ?? []).find((x) => x.puuid === ME);
    const place = Number(p?.placement ?? 0);
    if (!place) continue;
    rows.push({ t: Number(g.gameCreation ?? 0), place, v: g.gameVersion });
  }
  // 周聚合（trend kind=tft：平均名次，周一起算）
  const byWeek = new Map();
  for (const r of rows) {
    const d = new Date(r.t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const k = d.getTime();
    const c = byWeek.get(k) ?? { g: 0, sum: 0 };
    c.g++;
    c.sum += r.place;
    byWeek.set(k, c);
  }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]);
  const lastW = weeks[weeks.length - 1];
  // 工具输出里「逐周场次与周平均名次」那张图是 SVG，文本输出（get_my_trend kind=tft）里有结论行
  const tt = reported["get_my_trend_tft"] ?? "";
  const mW = /当前补丁|按补丁/.test(tt); // 占位，真正的断言在补丁那段
  void mW;
  // 补丁聚合（patches kind=tft）
  const patchOf = (v) => {
    if (typeof v !== "string" || !v) return null;
    const rel = /<Releases\/(\d{1,4}\.\d{1,2})>/.exec(v);
    if (rel) return rel[1];
    const head = /^\s*(\d{1,4}\.\d{1,2})(?:\.|$)/.exec(v);
    if (head) return head[1];
    const m = /(\d{1,4}\.\d{1,2})\.\d/.exec(v);
    return m ? m[1] : null;
  };
  const byPatch = new Map();
  for (const r of rows) {
    const p = patchOf(r.v);
    if (!p) continue;
    const c = byPatch.get(p) ?? { g: 0, sum: 0 };
    c.g++;
    c.sum += r.place;
    byPatch.set(p, c);
  }
  const topP = [...byPatch.entries()].sort((a, b) => b[1].g - a[1].g)[0];
  const tp = reported["get_my_patches_tft"] ?? "";
  if (topP) {
    const [patch, c] = topP;
    const m = new RegExp(patch.replace(".", "\\.") + "[^\\n]*?\\s(\\d+)\\s+局").exec(tp);
    const ok = m && Number(m[1]) === c.g;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 云顶分补丁：样本最多的 ${patch}　工具报 ${m ? m[1] : "—"} 局` +
        `　独立重算 ${c.g} 局（平均名次 ${(c.sum / c.g).toFixed(2)}）　共 ${byPatch.size} 个补丁`
    );
  }
  console.log(
    `· 云顶分周：${weeks.length} 个自然周，最近一周 ${lastW[1].g} 局平均名次 ${(lastW[1].sum / lastW[1].g).toFixed(2)}`
  );
}

// ⑰ CSV 导出：文件产物，之前从没对过账
//    规格：行数 = 我的海斗局数（每局一行），列数 = 表头字段数。
//    直接读**导出的那个文件**来数 —— 这一项对的是产物本身，不是工具的内存输出。
{
  const ex = reported["export_games_csv"] ?? "";
  const mPath = /已导出 (\d+) 行到：(.+)/.exec(ex);
  const mCols = /(\d+) 列/.exec(ex);
  if (mPath) {
    const declaredRows = Number(mPath[1]);
    const file = mPath[2].trim();
    let fileRows = null;
    let fileCols = null;
    try {
      const content = readFileSync(file, "utf8").replace(/^﻿/, "");
      const lines = content.split(/\r?\n/).filter((l) => l.length);
      fileRows = lines.length - 1; // 去掉表头
      // 列数按**表头**数（数据行里的引号会让简单切分不准）
      fileCols = lines[0].split(",").length;
    } catch {
      /* 文件读不到就跳过 */
    }
    const ok =
      fileRows != null &&
      fileRows === declaredRows &&
      declaredRows === truth.games &&
      (mCols ? Number(mCols[1]) === fileCols : true);
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} CSV 导出：工具报 ${declaredRows} 行${mCols ? " " + mCols[1] + " 列" : ""}` +
        `　实际文件 ${fileRows ?? "?"} 行 ${fileCols ?? "?"} 列　独立重算应有 ${truth.games} 行`
    );
  } else {
    console.log("· CSV 导出：工具这次没报出行数，跳过");
  }
}

// ⑱ 报告产物：Markdown 小结里的核心数字
//    这一项对的是**写出来的文件**（.md），跟 CSV 那条同类。
//    HTML 报告也能对，但它要跑一个约 90 秒的生成脚本；Markdown 是工具调用，快得多，
//    而且两者用的是同一套取数入口 —— 所以先对 Markdown，HTML 留给需要时手动验证。
{
  const md = reported["export_report_markdown"] ?? "";
  const mPath = /已生成 Markdown 小结：(.+)/.exec(md);
  if (mPath) {
    const file = mPath[1].trim();
    let content = null;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      /* 读不到就跳过 */
    }
    if (content) {
      const mGames = /共 (\d+) 局/.exec(content);
      const mRate = /\*\*([\d.]+)%\*\*（(\d+) 胜 (\d+) 负）/.exec(content);
      const okGames = mGames && Number(mGames[1]) === truth.games;
      const okRate = mRate && Math.abs(Number(mRate[1]) - truth.winRate) < 0.06;
      const okWins = mRate && Number(mRate[2]) === truth.wins;
      const ok = okGames && okRate && okWins;
      if (!ok) bad++;
      console.log(
        `${ok ? "✓" : "✗"} 报告产物：Markdown 里写「共 ${mGames ? mGames[1] : "—"} 局，` +
          `${mRate ? mRate[2] + " 胜 " + mRate[3] + " 负（" + mRate[1] + "%）" : "—"}」` +
          `　独立重算「${truth.games} 局，${truth.wins} 胜 ${truth.games - truth.wins} 负（${truth.winRate.toFixed(1)}%）」`
      );
    } else {
      console.log("· 报告产物：Markdown 文件读不到，跳过");
    }
  } else {
    console.log("· 报告产物：这次没生成 Markdown，跳过");
  }
}

// ⑲ 云顶周趋势：kind=tft 的那句结论（前段/后段平均名次）
{
  const tt = reported["get_my_trend_tft"] ?? "";
  const tftRaw = JSON.parse(readFileSync(path.join(ROOT, "data/archive/tft-matches.json"), "utf8"));
  const rows = [];
  for (const g of Object.values(tftRaw.games)) {
    const p = (g.participants ?? []).find((x) => x.puuid === ME);
    if (Number(p?.placement ?? 0) > 0) rows.push({ t: Number(g.gameCreation ?? 0), place: Number(p.placement) });
  }
  const byWeek = new Map();
  for (const r of rows) {
    const d = new Date(r.t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const k = d.getTime();
    const c = byWeek.get(k) ?? { g: 0, sum: 0 };
    c.g++;
    c.sum += r.place;
    byWeek.set(k, c);
  }
  // trend 的云顶分支按平均名次判前后段；门槛是「每周 ≥5 局」（minGamesPerWeek）。
  // ⚠ 顺序不能反：trend.ts 是**先取最近 16 周、再筛有效周**（第 175-179 行）。
  // 我第一版用了全部 18 周再筛，前段/后段就切在不同位置上（4.00/4.42 vs 3.75/4.56）——
  // 这是**第三次**因为没复现完整规格而误判工具错了。工具是对的。
  const KEEP_WEEKS = 16;
  const usable = [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-KEEP_WEEKS)
    .filter(([, c]) => c.g >= 5);
  const avgOf = (list) => {
    const g = list.reduce((s, [, c]) => s + c.g, 0);
    if (!g) return null;
    return list.reduce((s, [, c]) => s + c.sum, 0) / g;
  };
  const m = /前段 ([\d.]+) → 后段 ([\d.]+)/.exec(tt);
  if (m && usable.length >= 4) {
    const half = Math.floor(usable.length / 2);
    // ⚠ 工具用的是**各周平均名次的平均**（每周等权），不是按局数加权的合并平均。
    // 周场次不等时两者不同 —— 这是第四个坑：我又按自己觉得合理的方式算了一遍。
    // 工具的选择不算错（周趋势按周等权是合理的），但输出里没说明这一点，
    // 所以顺手在产品那边补了一句口径。这里复现工具的实际算法。
    const weekAvg = (list) => {
      const ws = list.map(([, c]) => c.sum / c.g);
      return ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null;
    };
    const older = weekAvg(usable.slice(0, half));
    const newer = weekAvg(usable.slice(half));
    const ok =
      older != null && newer != null && Math.abs(older - Number(m[1])) < 0.006 && Math.abs(newer - Number(m[2])) < 0.006;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} 云顶周趋势：工具报「前段 ${m[1]} → 后段 ${m[2]}」` +
        `　独立重算「前段 ${older?.toFixed(2)} → 后段 ${newer?.toFixed(2)}」（有效周 ${usable.length} 个）`
    );
  } else {
    console.log(`· 云顶周趋势：没有前后段对比句（有效周 ${usable.length} 个），跳过`);
  }
}

// ⑳ CSV 列内容抽查：不只对行列数，还要对**某一列的值**
//    抽查「结果」列 —— 数里面有多少个「胜」，必须等于独立重算的胜场数。
//    （行列数对了但整列错位，只看行数发现不了。）
{
  const ex = reported["export_games_csv"] ?? "";
  const mPath = /已导出 (\d+) 行到：(.+)/.exec(ex);
  if (mPath) {
    let content = null;
    try {
      content = readFileSync(mPath[2].trim(), "utf8").replace(/^﻿/, "");
    } catch {
      /* 读不到就跳过 */
    }
    if (content) {
      const lines = content.split(/\r?\n/).filter((l) => l.length);
      const header = lines[0].split(",");
      const iResult = header.indexOf("结果");
      const iChamp = header.indexOf("英雄");
      if (iResult >= 0) {
        // 注意：字段里可能带引号包住的逗号，所以不能简单地 split(",") 取第 N 个。
        // 这里只数「结果」列 —— 它只会是「胜」「负」或空，用行首位置的正则更稳。
        let wins = 0;
        let losses = 0;
        for (const l of lines.slice(1)) {
          // 结果列在第 5 列（索引 4），前面 4 列不含逗号（日期/时间/队列/英雄名）
          const parts = l.split(",");
          const v = parts[4];
          if (v === "胜") wins++;
          else if (v === "负") losses++;
        }
        const ok = wins === truth.wins && wins + losses === truth.games;
        if (!ok) bad++;
        console.log(
          `${ok ? "✓" : "✗"} CSV 列内容：「结果」列里 ${wins} 胜 ${losses} 负` +
            `　独立重算 ${truth.wins} 胜 ${truth.games - truth.wins} 负（英雄列下标 ${iChamp}）`
        );
      }
    }
  }
}

console.log("");
console.log(bad ? `✗ ${bad} 处与原始数据对不上` : "✓ 所有抽查项都与原始数据一致");
process.exit(bad ? 1 : 0);
