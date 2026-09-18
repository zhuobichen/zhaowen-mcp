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

child.kill();

console.log("");
const bad = leaked + killed;
console.log(
  bad
    ? `✗ ${leaked} 种坏参数没被拦住、${killed} 个合法调用被误伤（共 ${CASES.length + GOOD.length} 条）`
    : `✓ ${rejected} 种坏参数全被明确拒绝，${GOOD.length} 个合法调用没被误伤`
);
process.exit(bad ? 1 : 0);
