#!/usr/bin/env node
/**
 * 设备冒烟测试：**需要一台真的在线设备**，把工具面挨个真跑一遍。
 *
 * 和 selftest.mjs 的分工：selftest 不碰设备（纯逻辑 + 协议），跑 CI/新机器都行；
 * 这个脚本专门用来回答"改完之后在真机上到底还灵不灵"，包括中文输入这种只有真机能验的东西。
 *
 * 用法：
 *   node scripts/smoke-device.mjs                 # 用唯一在线设备
 *   node scripts/smoke-device.mjs --serial emulator-5554
 *
 * 退出码：任何一项致命失败 → 1。仅"提醒"类的不影响退出码。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TSX = join("node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(TSX)) {
  console.error(`缺少 ${TSX} —— 先在 android-mcp/ 下跑 npm install`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const serial = argv.includes("--serial") ? argv[argv.indexOf("--serial") + 1] : undefined;
const S = serial ? { serial } : {};

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
    const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 120000);
    pending.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
  });
};

const call = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: { ...S, ...args } });
  const blocks = r.result?.content ?? [];
  return blocks
    .map((b) => (b.type === "image" ? `<image ${b.mimeType} ${b.data.length} base64 字符>` : b.text))
    .join("\n");
};

let bad = 0;
const step = async (label, name, args, check) => {
  process.stdout.write(`\n── ${label}（${name}）\n`);
  try {
    const out = await call(name, args);
    console.log(out.length > 1200 ? out.slice(0, 1200) + "\n…(截断)" : out);
    if (check) {
      const verdict = check(out);
      console.log(verdict === true ? "   ✓ 符合预期" : `   ✗ ${verdict}`);
      if (verdict !== true) bad++;
    }
  } catch (e) {
    console.log(`   ✗ 调用失败：${e.message}`);
    bad++;
  }
};

try {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1.0.0" } });

  await step("环境总状态（含禁区一节）", "android_status", {}, (o) =>
    o.includes("禁区") && o.includes("qq-qzone") ? true : "android_status 里没看到禁区配置"
  );

  await step("当前前台", "android_foreground", {}, (o) => (/- 包名: \S/.test(o) ? true : "没识别出前台包名"));

  await step("设备预备（关动效）", "android_prepare", {}, (o) =>
    o.includes("window_animation_scale") && o.includes("→ 0") ? true : "动效没关掉"
  );

  // 打开设置页，作为后面手势/输入的中性靶子
  await step("启动设置", "android_launch_app", { package: "com.android.settings" }, (o) =>
    /已启动/.test(o) ? true : "启动没成功"
  );

  await step("等界面稳定", "android_wait_idle", { timeout_ms: 12000 }, (o) =>
    o.startsWith("✓") ? true : "界面一直没稳定"
  );

  await step("层级（json 形态）", "android_dump_ui", { format: "json", max: 12 }, (o) => {
    try {
      const j = JSON.parse(o);
      return Array.isArray(j.nodes) && j.nodes.length > 0 ? true : "json 里没有节点";
    } catch {
      return "format=json 的输出不是合法 JSON";
    }
  });

  // 中文输入：先确保有个聚焦的输入框，再输入（这是只有真机才能验的一项）。
  // 注意搜索页可能是**已经开着**的（上一次运行留下的），所以先看一眼再决定点不点 ——
  // 否则脚本会依赖上一次跑完的状态，表现成"产品坏了"。
  console.log("\n── 确认输入框已就绪");
  let hasField = false;
  try {
    const dump = JSON.parse(await call("android_dump_ui", { format: "json", max: 30 }));
    hasField = dump.nodes.some((n) => /EditText|AutoCompleteTextView/.test(n.cls) && n.clickable);
  } catch {}
  if (hasField) {
    console.log("   搜索框已经开着，跳过点击这一步");
  } else {
    await step("点开设置搜索框", "android_tap", { text: "Search Settings" }, (o) =>
      /已点击/.test(o) ? true : "没点到搜索框"
    );
  }
  await step("输入中文", "android_input_text", { text: "你好，我是AI", clear: true }, (o) =>
    o.includes("校验: 通过") ? true : `中文没验过：${o.split("\n").slice(0, 3).join(" / ")}`
  );

  await step("等文字消失（gone）", "android_wait_for_text", { text: "这个词不该存在zzz", gone: true, timeout_ms: 5000 }, (o) =>
    o.startsWith("✓") ? true : "gone 分支没按预期返回"
  );

  await step("长按（空白处）", "android_long_press", { x: 540, y: 1500, duration_ms: 600 }, (o) =>
    /已长按/.test(o) ? true : "长按没执行"
  );
  await step("双击（空白处）", "android_double_tap", { x: 540, y: 1700, gap_ms: 90 }, (o) =>
    /已双击/.test(o) ? true : "双击没执行"
  );
  await step("拖拽", "android_drag", { x1: 540, y1: 1800, x2: 540, y2: 1400, duration_ms: 600 }, (o) =>
    /已拖拽|不可用/.test(o) ? true : "拖拽既没成功也没给出可读原因"
  );

  await step("截图（存文件）", "android_screenshot", {}, (o) => (/截图已保存/.test(o) ? true : "截图没出文件"));

  // 禁区要 QQ / 微信在前台才生效（规则是限定 app 的），所以先切到 QQ。
  // 触发方式刻意选**失灵也不会造成伤害**的两种：
  //   · 点文字 "qzone" —— QQ 界面里不会有这个英文词，规则万一没生效只会"找不到文字"；
  //   · 起一个带 qzone 的**假**组件 —— 规则没生效时 am start 只会报组件不存在。
  // 不用"点「空间」"来验：那玩意儿一旦没拦住，就真的把空间点开了 —— 拿被测对象去赌被测对象，不合适。
  await step("切到 QQ（禁区规则要 QQ 在前台）", "android_launch_app", { package: "com.tencent.mobileqq" }, (o) =>
    /已启动/.test(o) ? true : "QQ 没启动"
  );
  await step("等 QQ 稳定", "android_wait_idle", { timeout_ms: 15000 });
  await step("禁区：QQ 在前台时，点含 qzone 的文字应被拦", "android_tap", { text: "qzone" }, (o) =>
    o.includes("已被禁区规则拦下") ? true : `没拦住（返回：${o.slice(0, 140)}）`
  );
  await step("禁区：带 QZone 地址的组件应被拦", "android_launch_app", {
    package: "com.tencent.mobileqq",
    activity: "com.tencent.mobileqq/.qzone.qq.com.NotARealActivity",
  }, (o) => (o.includes("已被禁区规则拦下") ? true : `没拦住（返回：${o.slice(0, 140)}）`));

  await step("数字 keycode（原来传数字会拼成 KEYCODE_279）", "android_press_key", { key: "279" }, (o) =>
    /已按键 279/.test(o) ? true : `数字 keycode 还是坏的：${o.slice(0, 120)}`
  );
} catch (e) {
  console.error(`\n✗ 冒烟测试中断：${e.message}`);
  if (stderr) console.error(stderr.slice(0, 800));
  bad++;
} finally {
  child.kill();
}

console.log("");
if (bad) {
  console.error(`✗ ${bad} 项不符合预期`);
  process.exit(1);
}
console.log("✓ 设备冒烟测试全部符合预期");
