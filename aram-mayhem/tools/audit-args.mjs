// 参数校验审计：类型/枚举/未知参数/超出范围，服务端真的拦住了吗？
//
// 为什么值得单列一层：这个服务是**被模型调用的**，模型传参出错是常态。
// 加校验之前实测过一轮，问题的严重性排序不是我以为的那样 ——
//
//   ① 坏值漏进输出（看得出不对）：`get_game_detail({index:"第三把"})` → 「没有第 NaN 把」
//   ② 静默给出错的答案（看不出不对）：`search_augments({rarity:"传说"})` → 「共 0 条」
//
// ②危险得多：模型会拿「共 0 条」当事实回答用户，没有任何迹象表明是参数写错了。
// 所以这条审计的判据是：**每种坏参数都必须被明确拒绝**，不许出现「照常返回一个站得住的结果」。
//
// 注意区分「拒绝」和「本来就没有」：参数合法但查不到东西（`get_augment({name:"不存在的符文"})`）
// 返回「没找到」是**对的**，不在本审计范围内。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 每条：工具、参数、为什么该被拒绝
const CASES = [
  ["search_augments", { limit: "abc" }, "limit 该是数字，给了字符串"],
  ["search_augments", { limit: -5 }, "limit 是负数"],
  ["search_augments", { limit: 1e9 }, "limit 远超声明上限"],
  ["search_augments", { rarity: "传说" }, "rarity 不在词表里（不拦会静默回「共 0 条」）"],
  ["search_augments", { scope: "everything" }, "scope 不在词表里"],
  ["search_augments", { sort: "随便" }, "sort 不在词表里"],
  ["list_champions", { tier: "S++" }, "tier 不在数据里出现的档位中"],
  ["get_augment", { name: 123 }, "name 该是字符串，给了数字"],
  ["get_champion_guide", { champion: true }, "champion 给了布尔"],
  ["get_my_trend", { kind: "nonsense" }, "kind 是枚举，给了非法值"],
  ["get_my_trend", { minGamesPerWeek: "five" }, "数字参数给了英文单词"],
  ["get_my_trend", { min_games_per_week: "five" }, "写对了名字但类型错"],
  ["export_games_csv", { limit: "all" }, "limit 给了 'all'"],
  ["export_games_csv", { kind: "csv" }, "kind 不在词表里"],
  ["get_game_detail", { index: "第三把" }, "index 给了中文（不拦会把 NaN 打进正文）"],
  ["compare_accounts", { b: 42 }, "b 该是字符串，给了数字"],
  ["get_empirical_augments", { min_games: "很多" }, "min_games 给了中文（不拦会输出「≥NaN 次」）"],
  ["get_my_matchups", { minGames: {} }, "参数名写成了驼峰，实际是 min_games"],
  ["send_champ_select_message", { text: 123, confirm: "true" }, "confirm 给了字符串 'true'（写操作，必须严格拦）"],
  ["send_champ_select_message", { text: 123 }, "text 给了数字（写操作）"],
];

const child = spawn(process.execPath, [TSX, path.join(ROOT, "index.ts")], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  // 审计进程一律不许写盘（闸设在 lib/refresh.ts 的写盘处）
  env: { ...process.env, MAYHEM_NO_WRITES: "1" },
});

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
    } catch {}
  }
});
child.stderr.on("data", () => {});
const send = (method, params, timeoutMs = 60000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error("超时")), timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "args", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

// 「被拒绝了」的判据：出现参数校验的文案，或工具自己的明确报错。
// 刻意不用「回复里有没有某个关键词」去猜 —— 那种判据在本仓库已经错过三次。
const REJECTED = /参数不对，这次调用没有执行|请提供|必须是|需要显式确认|没有发送|无法|无效|不支持|不存在|不认识参数/;

let rejected = 0;
let leaked = 0;
for (const [tool, args, why] of CASES) {
  const r = await send("tools/call", { name: tool, arguments: args });
  const text = r.error ? JSON.stringify(r.error) : (r.result?.content?.[0]?.text ?? "");
  const ok = REJECTED.test(text.slice(0, 300));
  if (ok) {
    rejected++;
    console.log(`  ✓ ${tool}(${JSON.stringify(args)}) —— ${why}`);
  } else {
    leaked++;
    console.log(`  ✗ ${tool}(${JSON.stringify(args)}) **没拦住** —— ${why}`);
    console.log(`      → ${text.split("\n").slice(0, 2).join(" / ").slice(0, 150)}`);
  }
}

// 合法调用不能被误伤 —— 只测「拦得住」是不够的，拦过头会让所有调用都失败
const GOOD = [
  ["search_augments", { query: "坦克", limit: 2 }, "正常查询"],
  ["search_augments", { rarity: "金色", limit: 3 }, "中文品质别名（lib/tools.ts 明确支持）"],
  ["list_champions", { tier: "s+", limit: 2 }, "小写档位（handler 是大小写不敏感比对）"],
  ["get_augment", { name: "坦克引擎" }, "正常取名"],
];
let killed = 0;
for (const [tool, args, why] of GOOD) {
  const r = await send("tools/call", { name: tool, arguments: args });
  const text = r.result?.content?.[0]?.text ?? "";
  const ok = !/参数不对，这次调用没有执行/.test(text.slice(0, 200)) && text.trim().length > 0;
  if (ok) console.log(`  ✓ 没误伤：${tool}(${JSON.stringify(args)}) —— ${why}`);
  else {
    killed++;
    console.log(`  ✗ 误伤了合法调用：${tool}(${JSON.stringify(args)}) —— ${why}`);
    console.log(`      → ${text.split("\n")[0].slice(0, 120)}`);
  }
}

// ---- 数值参数必须真的被采纳：拿 **0 vs 完全不传** 比
//
// 起因：handler 里原本一律写 `args.X ? Number(args.X) : undefined` —— JS 的真值判断，
// `min_games: 0`（不设样本门槛，是合理请求）会被当成「没传」而静默换成默认值。
//
// 判据为什么是「0 vs 不传」而不是「0 vs 500」：后者两种写法都会不同，
// **抓不到这个 bug**（第一版就是这么写的，等于没测）。只有把 0 和不传放在一起比，
// 才能验出「0 是不是被吞了」—— 被吞掉的话两者输出会一模一样。
const DIFF = [
  ["get_empirical_augments", { min_games: 0 }, "min_games"],
  ["get_my_trend", { min_games_per_week: 0 }, "min_games_per_week"],
];
let notHonored = 0;
for (const [tool, args, param] of DIFF) {
  const withZero = (await send("tools/call", { name: tool, arguments: args })).result?.content?.[0]?.text ?? "";
  const without = (await send("tools/call", { name: tool, arguments: {} })).result?.content?.[0]?.text ?? "";
  if (withZero === without) {
    notHonored++;
    console.log(`  ✗ ${tool}：${param}=0 与不传这个参数输出完全相同 —— 0 被当成「没传」吞掉了`);
    console.log(`      两者都是 ${withZero.length} 字符`);
  } else {
    console.log(`  ✓ ${tool}：${param}=0 与不传结果不同（${withZero.length} vs ${without.length} 字符），0 没被吞`);
  }
}

// ---- 改一个参数不该悄悄改另一个
//
// 起因：`get_my_matchups` 的 perPair 原先读的是 `opts.minGames` —— 跟整体视角共用输入、
// 默认值却不同（12 vs 5）。用户传 `min_games: 5` 会把整体视角的门槛也从 12 降到 5，
// 而 index.ts 的描述只说它管「对面英雄至少出现多少次」。
// 更隐蔽的是内部调用：checkup.ts / report.ts 固定传 `minGames: 12`，
// 于是同一个分析从工具直接调和从报告里调**结果不一样**。已拆成独立选项。
//
// 判据：只动 A 参数，B 参数生效的值不许变。
const INDEPENDENCE = [
  {
    tool: "get_my_matchups",
    only: "min_games",
    values: [5, 30],
    // 只受 min_champion_games 控制的那个值
    probe: (t) => t.match(/单个对位\s*≥\s*(\d+)\s*次/)?.[1],
    label: "单个对位门槛",
  },
];
let coupled = 0;
for (const c of INDEPENDENCE) {
  const seen = new Set();
  for (const v of c.values) {
    const t = (await send("tools/call", { name: c.tool, arguments: { [c.only]: v } })).result?.content?.[0]?.text ?? "";
    seen.add(c.probe(t));
  }
  if (seen.size !== 1 || seen.has(undefined)) {
    coupled++;
    console.log(`  ✗ ${c.tool}：只改 ${c.only}，${c.label}却跟着变了（${[...seen].join(" → ")}）—— 两个参数串了`);
  } else {
    console.log(`  ✓ ${c.tool}：只改 ${c.only} 时 ${c.label} 不动（恒为 ${[...seen][0]}）`);
  }
}

// ---- 静态兜底：数字参数不许再用真值判断
const idxSrc = readFileSync(path.join(ROOT, "index.ts"), "utf8").replace(/\r\n/g, "\n");
const falsyNumeric = [...idxSrc.matchAll(/args\.(\w+) \? Number\(args\.\1\)/g)].map((m) => m[1]);
if (falsyNumeric.length) {
  notHonored += falsyNumeric.length;
  console.log(`  ✗ 还有 ${falsyNumeric.length} 处数字参数在用真值判断（0 会被当成没传）：${[...new Set(falsyNumeric)].join(", ")}`);
} else {
  console.log(`  ✓ 数字参数都改成了显式判 undefined，没有 ` + "`args.X ? Number(args.X)` 的写法");
}

child.kill();

console.log("");
const bad = leaked + killed + notHonored + coupled;
console.log(
  bad
    ? `✗ ${leaked} 种坏参数没被拦住、${killed} 个合法调用被误伤、${notHonored} 处数值参数没被采纳、${coupled} 处参数互相串（共 ${CASES.length + GOOD.length + DIFF.length + INDEPENDENCE.length} 条）`
    : `✓ ${rejected} 种坏参数全被明确拒绝，${GOOD.length} 个合法调用没被误伤，${DIFF.length} 个数值参数确认被采纳，${INDEPENDENCE.length} 组参数确认互不串`
);
process.exit(bad ? 1 : 0);
