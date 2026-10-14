/**
 * 两段自测，都不需要真机/模拟器：
 *   1) selftest-logic.ts —— uiautomator 解析等纯逻辑
 *   2) 真走 stdio JSON-RPC —— 服务能起来、工具清单齐、缺 adb 时 android_status
 *      给的是可读报错而不是崩溃（这是最容易翻车的地方：不少 MCP 启动即抛，
 *      用户只看到一句 "server failed to start"，完全不知道缺的是 adb）。
 *
 * 用法: node selftest.mjs   （需要先 npm install）
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const TSX = "node_modules/tsx/dist/cli.mjs";

if (!existsSync(TSX)) {
  console.error("缺少 node_modules —— 先在 android-mcp/ 下跑 npm install");
  process.exit(1);
}

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log("  ✓", name);
  else {
    console.error("  ✗", name, detail);
    failed++;
  }
};

// ---------------------------------------------------------- 1) 纯逻辑
console.log("纯逻辑自测");
const logic = await runNode([TSX, "selftest-logic.ts"]);
console.log(logic.out.trim());
if (logic.err.trim()) console.log(logic.err.trim());
check("selftest-logic 退出码为 0", logic.code === 0, `exit ${logic.code}`);

// ---------------------------------------------------------- 2) 协议
console.log("");
console.log("stdio 协议自测");
const child = spawn(process.execPath, [TSX, "index.ts"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
let stderr = "";
const pending = new Map();
let id = 1;
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  }
});
child.stderr.on("data", (d) => (stderr += d.toString("utf8")));

const rpc = (method, params) => {
  const i = id++;
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout " + method)), 60000);
    pending.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
  });
};

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "selftest", version: "1.0.0" },
  });
  check("initialize 握手成功", !!init.result?.serverInfo, JSON.stringify(init).slice(0, 200));

  const list = await rpc("tools/list", {});
  const tools = list.result?.tools ?? [];
  const names = new Set(tools.map((t) => t.name));
  // 逐项比对，而不是「至少 20 个」那种松断言 —— 松断言的特点是：工具面变了它也不响。
  const EXPECTED = [
    "android_status", "android_device_info", "android_foreground", "android_prepare",
    "android_start_emulator", "android_stop_emulator",
    "android_screenshot", "android_dump_ui",
    "android_tap", "android_swipe", "android_long_press", "android_double_tap", "android_drag",
    "android_input_text", "android_press_key", "android_wait_for_text", "android_wait_idle",
    "android_install", "android_launch_app", "android_force_stop", "android_uninstall",
    "android_list_packages", "android_app_info", "android_logcat", "android_clear_logcat",
    "android_build", "android_list_apks", "android_shell",
  ];
  const missing = EXPECTED.filter((n) => !names.has(n));
  const extra = [...names].filter((n) => !EXPECTED.includes(n));
  check(
    `工具清单与预期完全一致（${EXPECTED.length} 个）`,
    missing.length === 0 && extra.length === 0,
    `缺: ${missing.join(", ") || "无"}｜多: ${extra.join(", ") || "无"}`
  );
  check("每个工具都有 description", tools.every((t) => (t.description ?? "").length > 10));
  check("每个工具都有 object inputSchema", tools.every((t) => t.inputSchema?.type === "object"));

  // 没 adb 的机器上，status 必须优雅返回错误文案，而不是让整个 server 挂掉
  const st = await rpc("tools/call", { name: "android_status", arguments: {} });
  const text = st.result?.content?.[0]?.text ?? "";
  check("无 adb 时 android_status 仍返回可读结果", text.length > 0, JSON.stringify(st).slice(0, 200));
  check("结果含 adb/设备 相关指引", /adb|设备/.test(text), text.slice(0, 120));
  // 禁区是配置驱动的，status 里必须能看见它真的被读进来了（否则"配了但没生效"没人会发现）
  check("android_status 里能看到禁区配置已加载", text.includes("禁区") && text.includes("qq-qzone"), text.slice(-260));
} catch (e) {
  check("协议自测执行完成", false, String(e));
  if (stderr) console.error("stderr:", stderr.slice(0, 600));
} finally {
  child.kill();
}

console.log("");
if (failed) {
  console.error(`✗ ${failed} 项失败`);
  process.exit(1);
}
console.log("✓ 全部通过");
