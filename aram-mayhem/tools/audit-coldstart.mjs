// 冷启动审计：第一次装上、还没有归档的用户会看到什么？
//
// 做法：把 MAYHEM_ARCHIVE_DIR 指到一个空目录（archive.ts 支持这个环境变量），
// 再跑一遍所有工具，看每个返回的第一行 —— 是「别的都挺好，就是还没有你的数据，
// 去打开客户端跑一次就有了」这种能照着做的提示，还是「读取失败」「没有可用对局」
// 这种让人以为装坏了的干话。
//
// 这一层和之前几个审计一样是先量后改：先看现状，再挑真的差劲的修。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const EMPTY = mkdtempSync(path.join(tmpdir(), "mayhem-cold-"));
const HEALTHY = process.argv.includes("--healthy");

const ARGS = {
  search_augments: { limit: 20 },
  get_augment: { name: "坦克引擎" },
  analyze_synergy: { augments: ["坦克引擎", "珠光护手"] },
  get_champion_guide: { champion: "亚索" },
  get_friend_stats: { friend: "丁ding" },
  compare_accounts: { b: "丁ding" },
  export_compare_report: { b: "丁ding" },
  get_champ_select_teammates: {},
  send_champ_select_message: { text: "x", confirm: false },
};

const child = spawn(process.execPath, [TSX, path.join(ROOT, "index.ts")], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  // 关键：归档指到空目录 —— 模拟「刚装上，什么都没攒」
  // 两件事都要做：归档指到空目录 + 给一个死端口让客户端看起来离线。
  // 只清归档是不够的 —— 客户端在线时 loadLolGames 会直接从 SGP 拉，冷启动根本模拟不出来
  // （第一版就是这样，21 个工具全被误判成「没说清楚怎么办」）。
  // --healthy：正常数据下跑一遍，验证这条提示**不会**误触发。
  // 只测「该出现时出现」是不够的 —— 提示要是到处都出现，那比没有还糟（变成噪声）。
  env: HEALTHY ? { ...process.env } : { ...process.env, MAYHEM_ARCHIVE_DIR: EMPTY, MAYHEM_LCU_OFFLINE: "1" },
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
    } catch {
      /* 忽略 */
    }
  }
});
child.stderr.on("data", () => {});

function send(method, params, timeoutMs = 120000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("超时")), timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cold", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

const { result } = await send("tools/list", {});
const tools = result.tools.map((t) => t.name);

// 需要「我的数据」的工具清单**从源码里取**，不在审计里另抄一份。
// 抄一份的后果实测过：两边漂移，审计报「12 个工具没提示」，其中一半根本不需要提示。
// 解析失败就抛错 —— 宁可这个审计直接崩，也不要它拿空清单静默「全部通过」。
const gamesSrc = readFileSync(path.join(ROOT, "lib/games.ts"), "utf8");
const listLiteral = /export const TOOLS_NEEDING_MY_DATA = \[([\s\S]*?)\];/.exec(gamesSrc);
if (!listLiteral) {
  throw new Error("没在 lib/games.ts 里找到 TOOLS_NEEDING_MY_DATA —— 清单改名了？审计需要同步更新");
}
const NEEDS_DATA = new Set([...listLiteral[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
// 自带说明、不需要统一提示的那几个，也从源码取 —— 同一份事实只有一个来源
const ownLiteral = /export const TOOLS_WITH_OWN_EMPTY_MESSAGE = \[([\s\S]*?)\];/.exec(gamesSrc);
const OWN_MESSAGE = new Set(ownLiteral ? [...ownLiteral[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : []);
if (!NEEDS_DATA.size) throw new Error("TOOLS_NEEDING_MY_DATA 解析出来是空的");
console.log(`（清单来自 lib/games.ts：${NEEDS_DATA.size} 个工具依赖「我的数据」）\n`);

const rows = [];
for (const name of tools) {
  let text = "";
  try {
    const r = await send("tools/call", { name, arguments: ARGS[name] ?? {} });
    text = r.result?.content?.[0]?.text ?? "";
  } catch (e) {
    text = `（调用失败）${e.message}`;
  }
  const first = (text.split("\n")[0] ?? "").slice(0, 74);
  // 有没有告诉用户「怎么办」？出现这些词就算给了出路
  // 兜底提示加在**输出末尾**（前面是各分析自己的内容），所以必须查全文 ——
  // 第一版只看前 400 字符，于是明明加了提示的工具被判成「没说清楚」。
  // 判据要精确：要么输出里带统一提示，要么这个工具在白名单里（自带说明）。
  // 不用「出现某几个关键词」去猜 —— 那种判据已经错过三次了。
  const actionable = OWN_MESSAGE.has(name) || text.includes("还没有可分析的对局数据");
  rows.push({ name, needsData: NEEDS_DATA.has(name), first, actionable, text });
}

child.kill();

if (HEALTHY) {
  // 反向验证：有数据时谁都不该被补这条提示
  const wrong = rows.filter((r) => r.text.includes("还没有可分析的对局数据"));
  console.log(`健康模式（正常归档 + 客户端在线）：${rows.length} 个工具`);
  if (wrong.length) {
    console.log(`✗ ${wrong.length} 个工具在有数据时也被补了「没有数据」提示：${wrong.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }
  console.log("✓ 没有工具被误补「没有数据」提示");
  process.exit(0);
}

const cold = rows.filter((r) => r.needsData);
console.log(`冷启动（空归档）下，需要「我的数据」的工具共 ${cold.length} 个\n`);
console.log("工具".padEnd(32) + "给了出路?  首行");
console.log("-".repeat(110));
for (const r of cold) {
  console.log(r.name.padEnd(30) + (r.actionable ? "   ✓      " : "   ✗      ") + r.first);
}

const stuck = cold.filter((r) => !r.actionable);
console.log("");
if (stuck.length) {
  console.log(`✗ ${stuck.length} 个工具在冷启动时没说清楚怎么办：${stuck.map((r) => r.name).join(", ")}`);
} else {
  console.log("✓ 所有需要数据的工具在冷启动时都给了可照做的提示");
}
