// 协议层审计：MCP 服务真的起得来、握手对、**服务出去的工具列表**是完整的吗？
//
// 和 mcp-smoke.mjs 的区别：冒烟是「人工跑一下确认没坏」，这个是「每次审计都查、
// 坏了就红」。原先只有前者，而它不在 `npm run audit` 链里 —— 等于「服务能不能真的
// 起来、工具列表是不是完整」这件事没有回归保护。
//
// 查什么（这些其它审计都查不到 —— 它们查的是 index.ts 的**源码**，不是运行时的响应）：
//   1. initialize 返回 serverInfo（名称/版本）
//   2. tools/list 的每个工具：name 非空、description 像句话、inputSchema 是 object
//   3. 工具名不重复；数量与源码里声明的对得上
//   4. 未知工具走「未知工具」分支，而不是崩掉或抛协议错误
//   5. 连调一圈之后服务还活着（还能再答 tools/list）—— 崩溃/内存泄漏的粗筛
//
// 不重复别处的活：全量调 44 个工具量输出长度是 audit:length 的事，
// 归档为空时的表现是 audit:coldstart 的事。这里只挑不依赖客户端和网络的几个工具。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// ---------------------------------------------------------------- 判据本体（可自测）

/**
 * 校验服务出去的**单个**工具描述符。纯函数，便于自测。
 * 返回问题清单（空数组 = 没问题）。
 */
export function checkToolDescriptor(t) {
  const problems = [];
  if (typeof t?.name !== "string" || !t.name.trim()) problems.push("name 为空");
  else if (!/^[a-z][a-z0-9_]*$/.test(t.name)) problems.push(`name 不是小写下划线式：${t.name}`);
  // 描述门槛按「有没有实质内容」判，**不按字符数** —— 中文一句话 5 个字（「按周看走势」）
  // 信息量足够，按 8 字符卡会把它判成缺失（第一版就是这么误报的）。
  // 这里只挡空、纯空白、以及一两个字的占位。
  const desc = typeof t?.description === "string" ? t.description.trim() : "";
  if (desc.length < 4) {
    problems.push(`description 太短或缺失：「${desc.slice(0, 20)}」`);
  } else if (desc === (t?.name ?? "")) {
    // 描述直接抄工具名，等于没写 —— 模型看不出它跟同名工具的区别
    problems.push(`description 就是工具名本身，等于没写`);
  }
  const s = t?.inputSchema;
  if (!s || typeof s !== "object") problems.push("没有 inputSchema");
  else {
    if (s.type !== "object") problems.push(`inputSchema.type 不是 object：${String(s.type)}`);
    if (s.properties == null || typeof s.properties !== "object") problems.push("inputSchema 缺 properties");
    // required 里写的键必须在 properties 里存在 —— 否则参数校验会自相矛盾
    if (s.required != null) {
      if (!Array.isArray(s.required)) problems.push("inputSchema.required 不是数组");
      else {
        const missing = s.required.filter((k) => !(s.properties ?? {})[k]);
        if (missing.length) problems.push(`required 里有 properties 没有的键：${missing.join("、")}`);
      }
    }
  }
  return problems;
}

if (process.argv.includes("--selftest")) {
  // 合成几个坏描述符，确认判据抓得到；再来几个好的，确认不误报
  const ok1 = { name: "get_my_trend", description: "按周看走势", inputSchema: { type: "object", properties: {} } };
  const ok2 = {
    name: "compare_accounts",
    description: "跨账号并排对比",
    inputSchema: { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
  };
  const cases = [
    [ok1, 0],
    [ok2, 0],
    [{ ...ok1, name: "" }, 1],
    [{ ...ok1, name: "GetMyTrend" }, 1],
    [{ ...ok1, description: "短" }, 1],
    [{ ...ok1, description: "   " }, 1],
    [{ ...ok1, description: undefined }, 1],
    // 描述抄工具名 —— 等于没写
    [{ ...ok1, description: "get_my_trend" }, 1],
    [{ ...ok1, inputSchema: undefined }, 1],
    [{ ...ok1, inputSchema: { type: "string", properties: {} } }, 1],
    [{ ...ok1, inputSchema: { type: "object" } }, 1],
    [{ ...ok1, inputSchema: { type: "object", properties: {}, required: ["a"] } }, 1],
    [{ ...ok1, inputSchema: { type: "object", properties: {}, required: "a" } }, 1],
  ];
  let bad = 0;
  for (const [t, wantAtLeast] of cases) {
    const got = checkToolDescriptor(t).length;
    const ok = wantAtLeast === 0 ? got === 0 : got >= wantAtLeast;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} 期望${wantAtLeast === 0 ? "无问题" : "至少 1 个问题"}，得到 ${got} 个：${t.name || "(空名)"}`);
    if (got) console.log(`      → ${checkToolDescriptor(t)[0]}`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过` : `✓ 自测通过（${cases.length} 条）`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- 起服务实测

const child = spawn(process.execPath, [TSX, path.join(ROOT, "index.ts")], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  // 审计进程一律不许写盘（闸设在 lib/refresh.ts 的写盘处）
  env: { ...process.env, MAYHEM_NO_WRITES: "1" },
});

let buf = "";
const pending = new Map();
let nextId = 1;
let strayOutput = 0;

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
      // stdio 协议下 stdout 只能是 JSON —— 混进别的字就是污染协议，要报出来
      strayOutput++;
      console.log(`  ⚠ stdout 出现非 JSON 输出：${line.slice(0, 100)}`);
    }
  }
});
child.stderr.on("data", () => {});

function send(method, params, timeoutMs = 60000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${method} 超时`)), timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const problems = [];
const note = (m) => problems.push(m);

try {
  // 1. 握手
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "proto-audit", version: "1" },
  });
  const si = init.result?.serverInfo;
  if (!si?.name || !si?.version) note("initialize 没有返回完整的 serverInfo（name/version）");
  else console.log(`  ✓ 握手成功：${si.name} ${si.version}`);
  if (!init.result?.capabilities?.tools) note("initialize 没有声明 tools 能力");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

  // 2. 工具列表的每个描述符
  const list = await send("tools/list", {});
  const tools = list.result?.tools ?? [];
  if (!tools.length) note("tools/list 返回了空列表");

  const seen = new Set();
  let badCount = 0;
  for (const t of tools) {
    if (seen.has(t.name)) note(`工具名重复：${t.name}`);
    seen.add(t.name);
    const p = checkToolDescriptor(t);
    if (p.length) {
      badCount++;
      note(`${t.name}：${p.join("；")}`);
    }
  }
  console.log(`  ✓ 工具列表 ${tools.length} 个，描述符有问题的 ${badCount} 个`);

  // 描述重复 = 有一个工具的描述是复制粘贴过来的、没改干净。
  // 对模型来说两个工具长得一样，选错是必然的 —— 单看某个描述符查不出来，要整表比。
  const byDesc = new Map();
  for (const t of tools) {
    const d = (t.description ?? "").trim();
    byDesc.set(d, [...(byDesc.get(d) ?? []), t.name]);
  }
  const dupDesc = [...byDesc.entries()].filter(([, names]) => names.length > 1);
  if (dupDesc.length) {
    for (const [d, names] of dupDesc) note(`描述完全相同：${names.join(" / ")} —— 「${d.slice(0, 40)}」`);
  } else {
    console.log(`  ✓ ${tools.length} 个描述互不重复`);
  }

  // 3. 与源码里声明的数量对齐（列表是运行时真值，源码是声明 —— 两者不符说明有工具没被登记）
  const srcCount = [...readFileSync(path.join(ROOT, "index.ts"), "utf8").matchAll(/^        name: "([a-z_]+)",/gm)].length;
  if (srcCount !== tools.length) note(`源码声明 ${srcCount} 个工具，服务出去 ${tools.length} 个`);

  // 4. 未知工具走预期分支，且不崩
  const badTool = await send("tools/call", { name: "definitely_not_a_tool", arguments: {} });
  const badText = badTool.result?.content?.[0]?.text ?? "";
  if (badTool.error) note(`未知工具返回了协议错误（应该回文本）：${JSON.stringify(badTool.error)}`);
  else if (!/未知工具/.test(badText)) note(`未知工具的回复里没有「未知工具」：${badText.slice(0, 80)}`);
  else console.log("  ✓ 未知工具被正确拒绝");

  // 5. 连调几个不依赖客户端/网络的工具，之后服务还活着
  const OFFLINE = ["get_data_info", "search_augments", "get_augment", "list_champions", "analyze_synergy"];
  const ARGS = {
    search_augments: { query: "坦克", limit: 2 },
    get_augment: { name: "坦克引擎" },
    analyze_synergy: { augments: ["坦克引擎", "珠光护手"] },
  };
  for (const name of OFFLINE) {
    const r = await send("tools/call", { name, arguments: ARGS[name] ?? {} });
    const text = r.result?.content?.[0]?.text ?? "";
    if (r.error) note(`${name} 返回协议错误：${JSON.stringify(r.error)}`);
    else if (!text.trim()) note(`${name} 返回了空文本`);
  }
  console.log(`  ✓ 连调 ${OFFLINE.length} 个离线工具，都返回了非空文本`);

  const again = await send("tools/list", {});
  if ((again.result?.tools ?? []).length !== tools.length) note("连调一圈之后 tools/list 的结果变了（服务状态被污染？）");
  else console.log("  ✓ 连调之后服务仍正常响应");

  if (strayOutput) note(`stdout 混进了 ${strayOutput} 行非 JSON 输出（会污染 stdio 协议）`);
} catch (e) {
  note(`实测过程抛错：${e?.message ?? e}`);
}

child.kill();

console.log("");
for (const p of problems) console.log(`  ✗ ${p}`);
// 收尾结论行：健康报告按这一行的前缀分档（✓ 通过 / ⚠ 注意 / ✗ 失败）
console.log(
  problems.length
    ? `✗ 协议层有 ${problems.length} 处问题`
    : "✓ 服务起得来、握手正常、工具列表描述符完整、错误路径可用"
);
process.exit(problems.length ? 1 : 0);
