// 输出长度审计：每个工具实际返回多长？
//
// 为什么要量：用户（和模型）看到的第一屏就那么多，太长的输出等于把重点埋起来。
// 但「太长」不能靠感觉说 —— 先量出来，再挑真正长的改。
//
// 做法：真的把服务起起来，按每个工具的必填参数填一组合理值，调一遍，数字符与行数。
// 需要客户端在线的工具也一样调（客户端没开时它们会返回「读不到」那类短文本，
// 那种长度不算数 —— 脚本会把这类标出来，避免把「没读到」误当成「输出短」）。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 每个工具给一组合理的调用参数；值为 null 表示「需要客户端在线，先用这个试」
const ARGS = {
  search_augments: { limit: 20 },
  get_augment: { name: "坦克引擎" },
  list_synergy_sets: {},
  analyze_synergy: { augments: ["坦克引擎", "珠光护手", "心之钢"] },
  list_champions: { limit: 25 },
  get_champion_guide: { champion: "亚索" },
  compare_patches: {},
  get_help: {},
  get_data_info: {},
  get_my_account_status: { pin: false },
  get_my_recent_games: {},
  analyze_my_augments: {},
  list_my_friends: {},
  get_friend_stats: { friend: "丁ding" },
  get_tft_stats: {},
  analyze_my_playstyle: {},
  get_my_ranked: {},
  get_my_teammates: {},
  get_friend_leaderboard: {},
  compare_accounts: { b: "丁ding" },
  get_my_builds: {},
  get_my_matchups: {},
  export_games_csv: {},
  get_empirical_augments: {},
  get_augment_pairs: {},
  check_synergy_sets: {},
  get_champ_select_teammates: {},
  send_champ_select_message: { text: "test", confirm: false },
  get_archive_info: {},
  refresh_data: { dry_run: true },
  get_my_trend: {},
  get_queue_stats: {},
  get_my_patches: {},
  get_tft_detail: {},
  get_enemy_comps: {},
  get_my_checkup: {},
  get_my_tilt: {},
  get_my_contribution: {},
  get_counter_items: {},
  export_report_markdown: {},
  export_compare_report: { b: "丁ding" },
  export_self_compare_report: {},
  get_combat_profile: {},
  get_game_detail: {},
};

const child = spawn(process.execPath, [TSX, path.join(ROOT, "index.ts")], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
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
      /* 忽略非 JSON */
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

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "len", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

const { result } = await send("tools/list", {});
const tools = result.tools.map((t) => t.name);

const rows = [];
for (const name of tools) {
  const args = ARGS[name] ?? {};
  let text = "";
  try {
    const r = await send("tools/call", { name, arguments: args });
    text = r.result?.content?.[0]?.text ?? "";
    if (r.error) text = `（协议错误）${JSON.stringify(r.error)}`;
  } catch (e) {
    text = `（调用失败）${e.message}`;
  }
  const lines = text ? text.split("\n").length : 0;
  // 「读不到」那类短文本不算数：它们没反映真实输出长度
  const unreadable = /读取失败|客户端没开|没找到|请提供|未知工具|失败：/.test(text.slice(0, 60));
  rows.push({ name, chars: text.length, lines, unreadable, sample: text.split("\n")[0]?.slice(0, 46) ?? "" });
}

child.kill();

rows.sort((a, b) => b.lines - a.lines);
const real = rows.filter((r) => !r.unreadable);
console.log(`工具 ${rows.length} 个；其中 ${real.length} 个返回了真实内容\n`);
console.log("行数  字符   工具");
console.log("-".repeat(66));
for (const r of real) {
  const flag = r.lines >= 60 ? "  ← 偏长" : r.lines >= 40 ? "  ← 略长" : "";
  console.log(String(r.lines).padStart(4) + "  " + String(r.chars).padStart(6) + "   " + r.name.padEnd(30) + flag);
}
const skipped = rows.filter((r) => r.unreadable);
if (skipped.length) {
  console.log(`\n以下 ${skipped.length} 个这次没拿到真实内容（客户端没开或需要在线），长度未计入：`);
  console.log("  " + skipped.map((r) => r.name).join(", "));
}
// 阈值检查：超过 120 行就有问题（一屏放不下、模型也难抓重点）。
// 120 不是拍脑袋 —— 实测 44 个工具最长 75 行（get_counter_items），中位约 30 行，
// 离 120 还有很大余量，所以这个阈值只在「某个工具以后长胖了」时才响。
const LIMIT = 120;
// get_help 是参考文档，本来就该长，豁免
const EXEMPT = new Set(["get_help"]);
const over = real.filter((r) => r.lines >= LIMIT && !EXEMPT.has(r.name));

const sorted = real.map((r) => r.lines).sort((a, b) => a - b);
console.log(
  `\n分布：最短 ${sorted[0]} 行 · 中位 ${sorted[Math.floor(sorted.length / 2)]} 行 · 最长 ${sorted[sorted.length - 1]} 行`
);
if (over.length) {
  console.log(`\n✗ 超过 ${LIMIT} 行的工具（该考虑精简模式或减少默认条目）：`);
  for (const r of over) console.log(`  · ${r.name} —— ${r.lines} 行 / ${r.chars} 字符`);
  process.exit(1);
}
console.log(`✓ 没有工具超过 ${LIMIT} 行（豁免：${[...EXEMPT].join(", ") || "无"}）`);
