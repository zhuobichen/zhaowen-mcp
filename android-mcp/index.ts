import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AndroidError,
  adb,
  adbBinary,
  dumpUiXml,
  foreground,
  listDevices,
  listAvds,
  resolveDevice,
  resolveAdb,
  startEmulator,
  stopEmulator,
} from "./lib/android.js";
import { parseUiXml, formatNodes, findByText, screenSignature, toJson, type UiNode } from "./lib/uiautomator.js";
import { checkForeground, checkGuardrails, guardMessage, guardrailsSummary } from "./lib/guardrails.js";
import { inputText as inputTextImpl } from "./lib/input.js";

// ---------------------------------------------------------------- 工具实现

const SERIAL_PROP = {
  type: "string",
  description: "可选：目标设备 serial（adb devices 里的值）。只有一台设备时可省略",
};

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

function ok(text: string | McpContent[]) {
  return { content: Array.isArray(text) ? text : [{ type: "text" as const, text }] };
}

function must(r: { code: number; stdout: string; stderr: string }, what: string): string {
  if (r.code !== 0) {
    throw new AndroidError(`${what} 失败(exit ${r.code}): ${r.stderr.trim() || r.stdout.trim() || "(无输出)"}`);
  }
  return r.stdout;
}

/** shell 命令统一入口：所有 shell 子命令都走这里，方便统一报错。 */
async function sh(serial: string, cmd: string[], timeoutMs = 20000) {
  return adb(["shell", ...cmd], serial, timeoutMs);
}

async function toolStatus(_args: any): Promise<string> {
  const lines: string[] = ["# Android 环境状态"];
  // 禁区配置也在这里露个脸：规矩是配置文件说了算，不是靠记性 —— 出问题先看这一节。
  const guardLines = ["", "## 禁区（guardrails）", ...guardrailsSummary()];
  let adbPath = "?";
  let adbVersion = "";
  try {
    adbPath = resolveAdb();
    const r = await adb(["version"]);
    adbVersion = (r.stdout.split(/\r?\n/)[0] ?? "").trim();
  } catch (e: any) {
    lines.push(`## ✗ adb 不可用`);
    lines.push(String(e?.message ?? e));
    lines.push("", "装好 SDK 后重启本 MCP 即可。Windows 建议同时设置 ANDROID_SDK_ROOT。");
    return lines.concat(guardLines).join("\n");
  }
  lines.push(`## ✓ adb`, `- 路径: ${adbPath}`, `- 版本: ${adbVersion}`);

  let devices;
  try {
    devices = await listDevices();
  } catch (e: any) {
    lines.push(`- 读取设备失败: ${e?.message ?? e}`);
    return lines.join("\n");
  }
  const online = devices.filter((d) => d.state === "device");
  lines.push(`## 设备 (${online.length} 在线 / 共 ${devices.length})`);
  if (!devices.length) lines.push("（无）— 用 android_start_emulator 起模拟器，或插真机开 USB 调试");
  for (const d of devices) {
    lines.push(`- ${d.serial}  state=${d.state}${d.model ? `  model=${d.model}` : ""}`);
  }

  try {
    const a = await listAvds();
    const avds = a.stdout.split(/\r?\n/).filter((s) => s.trim());
    lines.push(`## 模拟器 AVD (${avds.length})`);
    if (!avds.length) lines.push("（无）— 还没建 AVD");
    for (const name of avds) lines.push(`- ${name.trim()}`);
  } catch {
    lines.push("## 模拟器", "emulator 不可用（没装 SDK Emulator，或改用真机）");
  }
  return lines.concat(guardLines).join("\n");
}

async function toolDeviceInfo(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const props = [
    ["设备型号", "ro.product.model"],
    ["厂商", "ro.product.manufacturer"],
    ["Android 版本", "ro.build.version.release"],
    ["SDK", "ro.build.version.sdk"],
    ["ABI", "ro.product.cpu.abi"],
    ["分辨率", null],
    ["密度", null],
  ] as const;
  const out: string[] = [`# 设备信息（serial=${serial}）`];
  for (const [label, prop] of props) {
    if (prop) {
      const r = await sh(serial, ["getprop", prop]);
      out.push(`- ${label}: ${r.stdout.trim() || "(空)"}`);
    }
  }
  const size = await sh(serial, ["wm", "size"]);
  const density = await sh(serial, ["wm", "density"]);
  out.push(`- 分辨率: ${size.stdout.trim().replace(/\r?\n/g, " ") || "(未知)"}`);
  out.push(`- 密度: ${density.stdout.trim() || "(未知)"}`);
  const battery = await sh(serial, ["dumpsys", "battery"]);
  const level = battery.stdout.match(/level:\s*(\d+)/)?.[1];
  const ac = battery.stdout.match(/AC powered:\s*(\w+)/)?.[1];
  out.push(`- 电量: ${level !== undefined ? level + "%" : "(未知)"}${ac ? `  充电中=${ac}` : ""}`);
  return out.join("\n");
}

async function toolDumpUi(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const fg = await foreground(serial).catch(() => ({ raw: "" }) as { raw: string; packageName?: string; activity?: string });
  const blocked = checkForeground(fg.packageName, fg.activity);
  if (blocked) return guardMessage(blocked, "dump_ui");

  const nodes = parseUiXml(await dumpUiXml(serial));
  if (String(args.format ?? "text").toLowerCase() === "json") {
    return JSON.stringify({ foreground: fg.activity ?? null, count: nodes.length, nodes }, null, 2);
  }
  const head = `# 当前界面（${nodes.length} 个可见节点${fg.activity ? `，前台 ${fg.activity}` : ""}）\n`;
  const foot =
    "\n\n坐标可直接喂给 android_tap 的 x/y；也可直接用 android_tap 的 text 参数按文字点。" +
    "要机器可消费的形态就传 format=\"json\"。完整层级用 android_shell 跑 `uiautomator dump` 拿原始 XML。";
  return head + formatNodes(nodes, Number(args.max) || 150) + foot;
}

async function toolTap(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const blocked = await guard(serial, { action: "tap", nodeText: args.text ? String(args.text) : undefined });
  if (blocked) return blocked;
  let x = Number(args.x);
  let y = Number(args.y);
  let what = "";
  if (args.text) {
    const nodes = await currentNodes(serial);
    let hits = findByText(nodes, String(args.text), Boolean(args.exact));
    // 点不到时自动往上找可点的祖先：安卓里按钮文字常在不可点的 TextView 上，
    // 真正可点的是包着它的 Button。UI dump 里 clickable 节点是被保留的，直接找包含它的。
    if (!hits.some((n) => n.clickable) && hits.length) {
      hits = hits.map((n) => closestClickable(nodes, n)).filter((n): n is UiNode => Boolean(n));
    }
    if (!hits.length) {
      const visible = formatNodes(nodes, 60);
      return `界面上找不到文字「${args.text}」。当前界面节点：\n${visible}\n（可用 android_screenshot 看一眼，或用 android_shell dumpsys 排查）`;
    }
    if (hits.length > 1 && !args.first) {
      return `文字「${args.text}」命中 ${hits.length} 个节点，请指定更精确的 text 或传 first=true 点第一个：\n` +
        hits.slice(0, 10).map((n) => `#${n.index} "${n.text || n.desc}" @${n.x},${n.y}`).join("\n");
    }
    const hit = hits[0];
    x = hit.x;
    y = hit.y;
    what = `文字「${args.text}」→ `;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "错误：需要 x/y 坐标，或 text=要点的文字";
  must(await sh(serial, ["input", "tap", String(x), String(y)], 15000), "tap");
  return `${what}已点击 (${x},${y}) on ${serial}`;
}

async function toolSwipe(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const x1 = Number(args.x1), y1 = Number(args.y1), x2 = Number(args.x2), y2 = Number(args.y2);
  if ([x1, y1, x2, y2].some((v) => !Number.isFinite(v))) return "错误：需要 x1,y1,x2,y2";
  const ms = Number(args.duration_ms) || 300;
  must(await sh(serial, ["input", "swipe", String(x1), String(y1), String(x2), String(y2), String(ms)], 20000), "swipe");
  return `已滑动 (${x1},${y1}) → (${x2},${y2}) ${ms}ms`;
}

async function toolInputText(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const text = String(args.text ?? "");
  if (!text) return "错误：text 不能为空";
  // 在禁区页面里输入等于参与，所以这里也过一遍。
  const blocked = await guard(serial, { action: "input_text" });
  if (blocked) return blocked;

  const r = await inputTextImpl(serial, text, { clear: Boolean(args.clear) });
  const lines = [`已输入: ${text}`, `- 走法: ${r.note}`];
  if (r.readback !== undefined) lines.push(`- 输入框现在是: ${JSON.stringify(r.readback)}`);
  if (r.method === "ascii") lines.push(`- 校验: 纯 ASCII，走设备原生输入，未回读`);
  else lines.push(r.verified ? `- 校验: 通过（回读到这段文字）` : `- ⚠️ 校验: 没在输入框里看到这段文字 —— 用 android_dump_ui 确认一下`);
  return lines.join("\n");
}

const KEYS: Record<string, string> = {
  enter: "KEYCODE_ENTER",
  back: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  recent: "KEYCODE_APP_SWITCH",
  tab: "KEYCODE_TAB",
  delete: "KEYCODE_DEL",
  del: "KEYCODE_DEL",
  backspace: "KEYCODE_DEL",
  power: "KEYCODE_POWER",
  volume_up: "KEYCODE_VOLUME_UP",
  volume_down: "KEYCODE_VOLUME_DOWN",
  menu: "KEYCODE_MENU",
  search: "KEYCODE_SEARCH",
  lock: "KEYCODE_SLEEP",
  unlock: "KEYCODE_WAKEUP",
};

/**
 * 把 key 参数翻成 `input keyevent` 能吃的形式。
 *
 * 数字 keycode 要**原样透传**：老的写法是 `KEYCODE_${raw}`，传 "279" 会拼成
 * `KEYCODE_279`（无效），而工具描述里明明写着"或直接写数字 keycode" —— 实测踩过。
 */
function resolveKeycode(raw: string): string {
  const r = raw.trim();
  if (/^\d+$/.test(r)) return r;
  if (/^0x[0-9a-fA-F]+$/i.test(r)) return String(parseInt(r, 16));
  const lower = r.toLowerCase();
  if (KEYS[lower]) return KEYS[lower];
  if (/^KEYCODE_/i.test(r)) return r.toUpperCase();
  return `KEYCODE_${r.toUpperCase()}`;
}

async function toolPressKey(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const code = resolveKeycode(String(args.key ?? ""));
  must(await sh(serial, ["input", "keyevent", code], 15000), "keyevent");
  return `已按键 ${code}`;
}

async function toolWaitForText(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const fg0 = await foreground(serial).catch(() => ({ raw: "" }) as { raw: string; packageName?: string; activity?: string });
  const blocked0 = checkForeground(fg0.packageName, fg0.activity);
  if (blocked0) return guardMessage(blocked0, "wait_for_text");

  const target = String(args.text ?? "");
  const gone = Boolean(args.gone);
  const timeoutMs = Number(args.timeout_ms) || 15000;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const nodes = await currentNodes(serial);
    const hits = findByText(nodes, target, Boolean(args.exact));
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (gone ? hits.length === 0 : hits.length > 0) {
      if (gone) return `✓ ${elapsed}s 后「${target}」从界面上消失了（当前 ${nodes.length} 个节点）`;
      return (
        `✓ ${elapsed}s 后出现了「${target}」\n` +
        hits.slice(0, 5).map((n) => `#${n.index} "${n.text || n.desc}" @${n.x},${n.y} bounds=${n.bounds}`).join("\n") +
        (hits[0]?.clickable ? "\n（该节点可点击）" : "")
      );
    }
    last = formatNodes(nodes, 20);
    await new Promise((r) => setTimeout(r, Number(args.interval_ms) || 1000));
  }
  return gone
    ? `✗ ${timeoutMs}ms 内「${target}」一直在。最后一次看到的界面：\n${last}`
    : `✗ ${timeoutMs}ms 内没等到「${target}」。最后一次看到的界面：\n${last}`;
}

async function currentNodes(serial: string): Promise<UiNode[]> {
  return parseUiXml(await dumpUiXml(serial));
}

/**
 * 动作前的禁区检查。
 *
 * 为什么要先问一次"现在站在哪个 app"：有些规则只在特定 app 内成立
 * （例如 QQ / 微信里的「空间」入口）。拿不到前台**不会静默放行** ——
 * 那种情况下文字规则按保守处理拦下，见 lib/guardrails.ts。
 */
async function guard(
  serial: string,
  ctx: { action: string; targetPackage?: string; targetActivity?: string; nodeText?: string; command?: string }
): Promise<string | null> {
  let pkg: string | undefined;
  // 只有"按文字点"这种规则才需要知道当前前台，而 dumpsys 不便宜 —— 没文字就不去问。
  if (ctx.nodeText) {
    try {
      pkg = (await foreground(serial)).packageName;
    } catch {
      pkg = undefined; // 设备忙 / dumpsys 超时 —— 交给 guardrails 的保守分支处理
    }
  }
  const hit = checkGuardrails({ ...ctx, packageName: pkg });
  return hit ? guardMessage(hit, ctx.action) : null;
}

/** 找到包含 target 的最小可点击节点（"文字不可点、按钮可点"的兜底）。 */
function closestClickable(nodes: UiNode[], target: UiNode): UiNode | null {
  const t = parseBounds(target.bounds);
  if (!t) return null;
  const candidates = nodes.filter(
    (n) =>
      n.clickable &&
      n.bounds !== target.bounds &&
      (() => {
        const b = parseBounds(n.bounds);
        return b && b.x1 <= t.x1 && b.y1 <= t.y1 && b.x2 >= t.x2 && b.y2 >= t.y2;
      })()
  );
  if (!candidates.length) return null;
  // 面积最小的那个 = 最贴近文字的可点控件
  candidates.sort(
    (a, b) => parseBounds(a.bounds)!.w * parseBounds(a.bounds)!.h - parseBounds(b.bounds)!.w * parseBounds(b.bounds)!.h
  );
  return candidates[0];
}

function parseBounds(b: string): { x1: number; y1: number; x2: number; y2: number; w: number; h: number } | null {
  const m = String(b).match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!m) return null;
  const [, x1, y1, x2, y2] = m.map(Number);
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

async function toolScreenshot(args: any): Promise<string | McpContent[]> {
  const serial = await resolveDevice(args.serial);
  // 截图 = 看。禁区页面里连看都不该看，所以先问一句现在站在哪儿。
  const fg = await foreground(serial).catch(() => ({ raw: "" }) as { raw: string; packageName?: string; activity?: string });
  const blocked = checkForeground(fg.packageName, fg.activity);
  if (blocked) return guardMessage(blocked, "screenshot");

  const png = await adbBinary(["exec-out", "screencap", "-p"], serial, 30000);
  // PNG 魔数校验：拿到的不是 PNG 就说明命令没走 exec-out 或设备不支持。
  const isPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
  if (!isPng) {
    throw new AndroidError(
      `截图拿到的不是合法 PNG（前 8 字节: ${[...png.subarray(0, 8)].join(",")}）。` +
        "部分机型需要 `settings put global adb_screenshot ...` 或改用 scrcpy 投屏。"
    );
  }
  const dir = join(tmpdir(), "android-mcp-shots");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${serial}-${Date.now()}.png`);
  writeFileSync(file, png);

  const caption =
    `截图已保存：${file}\n（${png.length} 字节，${serial}${fg.activity ? `，前台 ${fg.activity}` : ""}）`;
  if (args.inline) {
    // 直接把图塞回给调用方，省掉"拿到路径再读一次"那一轮。
    return [
      { type: "text", text: caption },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ];
  }
  return `${caption}\n可直接用图片查看工具打开这个路径；要省一轮就传 inline=true。`;
}

async function toolInstall(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const apk = String(args.apk ?? "");
  if (!apk) return "错误：需要 apk 路径";
  if (!existsSync(apk)) return `错误：找不到 APK 文件 ${apk}`;
  // 默认 -r（覆盖安装保留数据）；-d 允许降级版本号调试。
  const flags = ["-r"];
  if (args.allow_downgrade) flags.push("-d");
  if (args.grant_permissions) flags.push("-g");
  const r = await adb(["install", ...flags, apk], serial, 300000);
  return must(r, "install").trim() || "安装完成";
}

async function toolLaunch(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const pkg = String(args.package ?? "");
  if (!pkg) return "错误：需要 package 名";
  const blocked = await guard(serial, {
    action: "launch_app",
    targetPackage: pkg,
    targetActivity: args.activity ? String(args.activity) : undefined,
  });
  if (blocked) return blocked;
  const cmd = args.activity
    ? ["shell", "am", "start", "-n", args.activity.includes("/") ? args.activity : `${pkg}/${args.activity}`]
    : ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"];
  const r = await adb(cmd, serial, 30000);
  if (r.code !== 0) throw new AndroidError(`启动失败: ${r.stderr || r.stdout}`);
  return `已启动 ${pkg}${args.activity ? ` (${args.activity})` : ""}\n${r.stdout.trim()}`;
}

async function toolForceStop(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const pkg = String(args.package ?? "");
  if (!pkg) return "错误：需要 package 名";
  must(await sh(serial, ["am", "force-stop", pkg]), "force-stop");
  return `已强制停止 ${pkg}`;
}

async function toolUninstall(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const pkg = String(args.package ?? "");
  if (!pkg) return "错误：需要 package 名";
  if (!args.confirm) {
    return `⚠️ 卸载是破坏性操作（会删掉该应用的全部数据）。确认要卸载 ${pkg} 就再调一次并传 confirm=true。`;
  }
  must(await adb(["uninstall", pkg], serial, 60000), "uninstall");
  return `已卸载 ${pkg}`;
}

async function toolListPackages(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const filter = String(args.filter ?? "").toLowerCase();
  const third = args.third_party !== false;
  const flag = third ? ["-3"] : [];
  const r = await adb(["shell", "pm", "list", "packages", ...flag], serial, 30000);
  const pkgs = r.stdout
    .split(/\r?\n/)
    .map((s) => s.replace(/^package:/, "").trim())
    .filter(Boolean)
    .filter((p) => !filter || p.toLowerCase().includes(filter));
  const head = `# 已安装包（${pkgs.length}${filter ? `，匹配 "${args.filter}"` : ""}）`;
  return [head, ...pkgs.slice(0, Number(args.max) || 200)].join("\n");
}

async function toolAppInfo(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const pkg = String(args.package ?? "");
  if (!pkg) return "错误：需要 package 名";
  const r = await sh(serial, ["dumpsys", "package", pkg], 30000);
  if (!r.stdout.includes("Package [")) return `没装 ${pkg}（或 dumpsys 无输出）`;
  const pick = (re: RegExp) => r.stdout.match(re)?.[1]?.trim() ?? "";
  return [
    `# ${pkg}`,
    `- versionName: ${pick(/versionName=(\S+)/)}`,
    `- versionCode: ${pick(/versionCode=(\d+)/)}`,
    `- firstInstall: ${pick(/firstInstallTime=(.+)/)}`,
    `- lastUpdate: ${pick(/lastUpdateTime=(.+)/)}`,
    `- targetSdk: ${pick(/targetSdk=(\d+)/)}`,
    `- 权限数: ${(r.stdout.match(/granted=true/g) ?? []).length} 已授予`,
  ].join("\n");
}

async function toolLogcat(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const filter: string[] = ["-d"]; // 立即返回缓冲区内容，不阻塞
  const lines = Number(args.lines) || 300;
  if (args.tag) filter.push(`${args.tag}:V`);
  if (args.min_level) {
    const m: Record<string, string> = { verbose: "V", debug: "D", info: "I", warn: "W", error: "E", fatal: "F" };
    filter.push(`*:${m[String(args.min_level).toLowerCase()] ?? "I"}`);
  } else if (!args.tag) {
    filter.push("*:I");
  }
  filter.push(`-t`, String(lines));
  const r = await adb(["logcat", ...filter], serial, 30000);
  const text = r.stdout.trim();
  if (!text) return "(logcat 缓冲区为空或被过滤条件全部过滤掉了)";
  return `# logcat (${text.split(/\r?\n/).length} 行)\n${text}`;
}

async function toolClearLogcat(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  must(await adb(["logcat", "-c"], serial, 15000), "logcat -c");
  return "logcat 缓冲区已清空";
}

async function toolShell(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const cmd = Array.isArray(args.command)
    ? args.command.map(String)
    : String(args.command ?? "").split(" ").filter(Boolean);
  if (!cmd.length) return "错误：需要 command";
  const blocked = await guard(serial, { action: "shell", command: cmd.join(" ") });
  if (blocked) return blocked;
  const r = await sh(serial, cmd, Number(args.timeout_ms) || 20000);
  const out = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n");
  return out || `(命令无输出，exit ${r.code})`;
}

async function toolBuild(args: any): Promise<string> {
  const dir = String(args.project_dir ?? "");
  if (!dir || !existsSync(dir)) return `错误：项目目录不存在 ${dir}`;
  const isWin = process.platform === "win32";
  const wrapper = existsSync(join(dir, "gradlew.bat")) ? "gradlew.bat" : existsSync(join(dir, "gradlew")) ? "./gradlew" : null;
  if (!wrapper) return `错误：${dir} 下没有 gradlew / gradlew.bat —— 这不像一个 Gradle 安卓项目`;
  const task = String(args.task ?? "assembleDebug");
  // Windows 上 .bat 必须走 cmd.exe；用 spawn 数组 + shell:false 仍需显式指定 cmd.exe。
  const cmd = isWin ? "cmd.exe" : wrapper;
  const cmdArgs = isWin ? ["/c", wrapper, task] : [task];
  const started = Date.now();
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(cmd, cmdArgs, { cwd: dir, encoding: "utf8", timeout: Number(args.timeout_ms) || 900000 });
  const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split(/\r?\n/).slice(-40).join("\n");
  if (r.status !== 0) {
    return `构建失败（${Math.round((Date.now() - started) / 1000)}s，exit ${r.status}）\n--- 末尾输出 ---\n${tail}`;
  }
  const apks = findApks(dir);
  return `构建成功（${Math.round((Date.now() - started) / 1000)}s，${task}）\n` +
    (apks.length ? `产物:\n${apks.map((a) => `- ${a}`).join("\n")}` : "（没找到 APK，用 android_list_apks 或自己翻 build/outputs）");
}

function findApks(dir: string, depth = 0): string[] {
  if (depth > 5) return [];
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && e.endsWith(".apk")) out.push(full);
    else if (st.isDirectory() && !e.startsWith(".") && e !== "node_modules") out.push(...findApks(full, depth + 1));
  }
  return out.slice(0, 20);
}

async function toolListApks(args: any): Promise<string> {
  const dir = String(args.project_dir ?? process.cwd());
  const apks = findApks(dir);
  return apks.length ? `# ${dir} 下的 APK\n${apks.join("\n")}` : `${dir} 下没找到 APK（先构建）`;
}

/** {x,y} 或 {text} → 屏幕坐标（按文字找 + 回溯可点祖先，和 android_tap 同一套）。 */
async function resolvePoint(serial: string, args: any): Promise<{ x: number; y: number; what: string }> {
  if (args.text) {
    const nodes = await currentNodes(serial);
    let hits = findByText(nodes, String(args.text), Boolean(args.exact));
    if (!hits.some((n) => n.clickable) && hits.length) {
      hits = hits.map((n) => closestClickable(nodes, n)).filter((n): n is UiNode => Boolean(n));
    }
    if (!hits.length) {
      throw new AndroidError(`界面上找不到文字「${args.text}」。当前界面节点：\n${formatNodes(nodes, 40)}`);
    }
    if (hits.length > 1 && !args.first) {
      throw new AndroidError(
        `文字「${args.text}」命中 ${hits.length} 个节点，请给更精确的 text 或传 first=true 用第一个：\n` +
          hits.slice(0, 10).map((n) => `#${n.index} "${n.text || n.desc}" @${n.x},${n.y}`).join("\n")
      );
    }
    return { x: hits[0].x, y: hits[0].y, what: `文字「${args.text}」→ ` };
  }
  const x = Number(args.x);
  const y = Number(args.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new AndroidError("需要 x/y 坐标，或 text=要操作的文字");
  }
  return { x, y, what: "" };
}

/**
 * 等界面稳定。
 *
 * 判据：**连续两次 dump 的节点指纹完全一致**。没有这个工具时只能 `sleep` 硬等 ——
 * 短了截到动画中间、长了白等，实测一轮操作要来回七八次 sleep + 截图。
 */
async function toolWaitIdle(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const fg = await foreground(serial).catch(() => ({ raw: "" }) as { raw: string; packageName?: string; activity?: string });
  const blocked = checkForeground(fg.packageName, fg.activity);
  if (blocked) return guardMessage(blocked, "wait_idle");

  const timeout = Number(args.timeout_ms) || 15000;
  const interval = Number(args.interval_ms) || 500;
  const started = Date.now();
  const deadline = started + timeout;
  let prev = "";
  let count = 0;
  while (Date.now() < deadline) {
    const nodes = await currentNodes(serial);
    const sig = screenSignature(nodes);
    count = nodes.length;
    if (sig && sig === prev) {
      return `✓ 界面已稳定（${((Date.now() - started) / 1000).toFixed(1)}s，${nodes.length} 个节点${fg.activity ? `，前台 ${fg.activity}` : ""}）`;
    }
    prev = sig;
    await new Promise((r) => setTimeout(r, interval));
  }
  const nodes = parseUiXml(await dumpUiXml(serial).catch(() => ""));
  return (
    `✗ ${timeout}ms 内界面没有稳定下来（一直在变，或者一直是空屏）。最后一次看到 ${count || nodes.length} 个节点：\n` +
    formatNodes(nodes, 20)
  );
}

async function toolLongPress(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const blocked = await guard(serial, { action: "long_press", nodeText: args.text ? String(args.text) : undefined });
  if (blocked) return blocked;
  const { x, y, what } = await resolvePoint(serial, args);
  // 同点长按 = 把 swipe 的起终点设成同一个地方。
  const ms = Number(args.duration_ms) || 800;
  must(await sh(serial, ["input", "swipe", String(x), String(y), String(x), String(y), String(ms)], 20000), "long press");
  return `${what}已长按 (${x},${y}) ${ms}ms on ${serial}`;
}

async function toolDoubleTap(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const blocked = await guard(serial, { action: "double_tap", nodeText: args.text ? String(args.text) : undefined });
  if (blocked) return blocked;
  const { x, y, what } = await resolvePoint(serial, args);
  // AOSP 的 `input` 没有 doubletap 子命令，只能连点两次；间隔给 90ms 左右。
  must(await sh(serial, ["input", "tap", String(x), String(y)], 15000), "tap");
  await new Promise((r) => setTimeout(r, Number(args.gap_ms) || 90));
  must(await sh(serial, ["input", "tap", String(x), String(y)], 15000), "tap");
  return `${what}已双击 (${x},${y}) on ${serial}`;
}

async function toolDrag(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const x1 = Number(args.x1), y1 = Number(args.y1), x2 = Number(args.x2), y2 = Number(args.y2);
  if ([x1, y1, x2, y2].some((v) => !Number.isFinite(v))) return "错误：需要 x1,y1,x2,y2";
  const ms = Number(args.duration_ms) || 800;
  // draganddrop 会先按住再移动，和 swipe 的"划过去"不是一回事。
  const r = await sh(serial, ["input", "draganddrop", String(x1), String(y1), String(x2), String(y2), String(ms)], 25000);
  if (r.code !== 0) {
    return `draganddrop 不可用（${(r.stderr || r.stdout).trim() || `exit ${r.code}`}）。可退用 android_swipe（起终点相同即为长按、不同即为滑动）。`;
  }
  return `已拖拽 (${x1},${y1}) → (${x2},${y2}) ${ms}ms`;
}

/**
 * 把设备调成适合自动化的状态。
 * 三个动效缩放是"时序不稳"的根源：界面在动画中时截图/取层级拿到的是中间态。
 */
async function toolPrepare(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const out: string[] = [`# 设备预备（${serial}）`];
  const off = args.animations !== false;
  for (const k of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) {
    const before = (await sh(serial, ["settings", "get", "global", k])).stdout.trim();
    await sh(serial, ["settings", "put", "global", k, off ? "0" : "1"]);
    const after = (await sh(serial, ["settings", "get", "global", k])).stdout.trim();
    out.push(`- ${k}: ${before || "(默认)"} → ${after}`);
  }
  // 亮屏（WAKEUP 对已亮屏无害），再上滑一次解锁无密码设备
  await sh(serial, ["input", "keyevent", "224"]);
  const sizeRaw = (await sh(serial, ["wm", "size"])).stdout;
  const m = sizeRaw.match(/(\d+)x(\d+)/);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    await sh(serial, ["input", "swipe", String(Math.round(w / 2)), String(Math.round(h * 0.8)), String(Math.round(w / 2)), String(Math.round(h * 0.2)), "200"]);
    out.push(`- 屏幕: ${w}x${h}`);
  }
  out.push("- 已尝试亮屏 + 上滑解锁（有密码/图案的机器请自己先解开）");
  return out.join("\n");
}

async function toolForeground(args: any): Promise<string> {
  const serial = await resolveDevice(args.serial);
  const fg = await foreground(serial);
  if (!fg.raw) return `没能识别当前前台（dumpsys 里既没有 mResumedActivity 也没有 mCurrentFocus）。serial=${serial}`;
  return [`# 当前前台（${serial}）`, `- 包名: ${fg.packageName ?? "(未识别)"}`, `- activity: ${fg.activity ?? "(未识别)"}`, `- 原始行: ${fg.raw}`].join("\n");
}

// ---------------------------------------------------------------- MCP 装配

const TOOLS = [
  {
    name: "android_status",
    description:
      "【先跑这个】Android 环境总状态：adb 是否可用、在线设备、可用 AVD。装完 SDK / 插完手机 / 起完模拟器，用它确认环境。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "android_device_info",
    description: "目标设备的型号、Android 版本、SDK、ABI、分辨率、密度、电量。",
    inputSchema: { type: "object", properties: { serial: SERIAL_PROP } },
  },
  {
    name: "android_start_emulator",
    description:
      "启动一个 AVD 模拟器并等待开机完成，返回 serial。之后所有工具都能直接用。第一个可选设备时不用手动传 serial。",
    inputSchema: {
      type: "object",
      properties: {
        avd: { type: "string", description: "AVD 名字。不填则用 list_avds 的第一个" },
        wait_boot: { type: "boolean", description: "是否等到开机完成（默认 true）" },
        boot_timeout_ms: { type: "number", description: "等待开机的上限毫秒（默认 180000）" },
        extra_args: { type: "array", items: { type: "string" }, description: "追加给 emulator 的参数，如 ['-no-snapshot-load']" },
      },
    },
  },
  {
    name: "android_stop_emulator",
    description: "关闭模拟器（adb emu kill）。",
    inputSchema: { type: "object", properties: { serial: SERIAL_PROP } },
  },
  {
    name: "android_screenshot",
    description:
      "截屏并保存成 PNG，返回绝对路径 —— 用图片查看工具打开这个路径就能「看见」屏幕。这是验证 UI 的第一手段。" +
      "传 inline=true 则把图直接作为图片内容返回，省掉「拿路径再读一次」那一轮。",
    inputSchema: {
      type: "object",
      properties: {
        serial: SERIAL_PROP,
        inline: { type: "boolean", description: "直接把 PNG 作为图片内容返回（默认 false，只给路径）" },
      },
    },
  },
  {
    name: "android_dump_ui",
    description:
      "dump 当前界面层级，返回紧凑节点列表（文字/控件类型/坐标/可点击标记）。要找按钮、要判断页面状态时用它，比截图更精确也更省 token。" +
      '要机器消费就传 format="json"（含前台 activity）。',
    inputSchema: {
      type: "object",
      properties: {
        serial: SERIAL_PROP,
        max: { type: "number", description: "最多返回多少节点（默认 150）" },
        format: { type: "string", description: 'text（默认，给人读）/ json（给程序读）' },
      },
    },
  },
  {
    name: "android_tap",
    description:
      "点击。传 x/y 点坐标，或传 text=按钮文字（自动定位并点它的中心，更稳）。文字命中多个时会列出让调用方消歧。",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "点击 X 坐标" },
        y: { type: "number", description: "点击 Y 坐标" },
        text: { type: "string", description: "要点的文字或 content-desc" },
        exact: { type: "boolean", description: "文字完全匹配（默认包含匹配）" },
        first: { type: "boolean", description: "命中多个时点第一个" },
        serial: SERIAL_PROP,
      },
    },
  },
  {
    name: "android_swipe",
    description:
      "滑动/翻页。从 (x1,y1) 滑到 (x2,y2)。上滑加载更多、下拉刷新、左右翻页都靠它；" +
      "duration_ms 调大可以模拟长按或惯性滚动。",
    inputSchema: {
      type: "object",
      properties: {
        x1: { type: "number" }, y1: { type: "number" },
        x2: { type: "number" }, y2: { type: "number" },
        duration_ms: { type: "number", description: "滑动时长，默认 300" },
        serial: SERIAL_PROP,
      },
      required: ["x1", "y1", "x2", "y2"],
    },
  },
  {
    name: "android_input_text",
    description:
      "往焦点输入框输入文字，**中文可用**。按内容自动分流：纯 ASCII 走设备原生 input text；含非 ASCII 走设备侧 ADBKeyboard 广播。" +
      "返回里会写明实际走了哪条路并回读校验。前提是输入框已有焦点 —— 拿不准就先 android_tap 点一下它。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        clear: { type: "boolean", description: "先清空输入框再输入（默认 false，即追加）" },
        serial: SERIAL_PROP,
      },
      required: ["text"],
    },
  },
  {
    name: "android_press_key",
    description:
      "按键。key 可用别名 enter/back/home/recent/tab/delete/power/volume_up/volume_down/menu/search/lock/unlock，或直接写 KEYCODE_XXX / 数字 keycode。",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, serial: SERIAL_PROP },
      required: ["key"],
    },
  },
  {
    name: "android_wait_for_text",
    description:
      "轮询等待某个文字出现（登录后跳转、加载完成、Toast 文案等异步场景）。比 sleep 后再截图更可靠。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "等待出现的文字" },
        gone: { type: "boolean", description: "true = 等它消失（默认等它出现）" },
        timeout_ms: { type: "number", description: "超时毫秒，默认 15000" },
        interval_ms: { type: "number", description: "轮询间隔，默认 1000" },
        exact: { type: "boolean" },
        serial: SERIAL_PROP,
      },
      required: ["text"],
    },
  },
  {
    name: "android_install",
    description: "安装 APK（默认 -r 覆盖并保留数据）。传构建产物的绝对路径。",
    inputSchema: {
      type: "object",
      properties: {
        apk: { type: "string" },
        allow_downgrade: { type: "boolean", description: "允许降级安装（-d）" },
        grant_permissions: { type: "boolean", description: "授予全部运行时权限（-g），测权限相关功能时很有用" },
        serial: SERIAL_PROP,
      },
      required: ["apk"],
    },
  },
  {
    name: "android_launch_app",
    description: "启动应用。传 package 名（走 launcher intent）或 package + activity 直接 am start 指定界面。",
    inputSchema: {
      type: "object",
      properties: {
        package: { type: "string" },
        activity: { type: "string", description: "可选，如 com.x/.MainActivity 或完整 com.x/com.x.MainActivity" },
        serial: SERIAL_PROP,
      },
      required: ["package"],
    },
  },
  {
    name: "android_force_stop",
    description: "强制停止某个应用（相当于「强行关闭」，不改数据）。",
    inputSchema: {
      type: "object",
      properties: { package: { type: "string" }, serial: SERIAL_PROP },
      required: ["package"],
    },
  },
  {
    name: "android_uninstall",
    description: "卸载应用（破坏性，会删数据）。必须传 confirm=true 才真删，否则只回一句确认提示。",
    inputSchema: {
      type: "object",
      properties: { package: { type: "string" }, confirm: { type: "boolean" }, serial: SERIAL_PROP },
      required: ["package"],
    },
  },
  {
    name: "android_list_packages",
    description: "列出已安装包。filter 做子串过滤（模糊搜包名/应用名时先看这里）。",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "包名子串过滤" },
        third_party: { type: "boolean", description: "只看第三方应用（默认 true）" },
        max: { type: "number" },
        serial: SERIAL_PROP,
      },
    },
  },
  {
    name: "android_app_info",
    description: "某个包的版本号、首次安装/最后更新时间、targetSdk、已授予权限数。",
    inputSchema: {
      type: "object",
      properties: { package: { type: "string" }, serial: SERIAL_PROP },
      required: ["package"],
    },
  },
  {
    name: "android_logcat",
    description:
      "读取 logcat 缓冲区最近日志（-d 非阻塞）。调试崩溃/异常必用。min_level 可设 verbose/debug/info/warn/error。",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "取末尾多少行，默认 300" },
        tag: { type: "string", description: "只看某个 tag" },
        min_level: { type: "string", description: "verbose/debug/info/warn/error/fatal" },
        serial: SERIAL_PROP,
      },
    },
  },
  {
    name: "android_clear_logcat",
    description: "清空 logcat 缓冲区。复现问题前先清一次，事后日志就干净。",
    inputSchema: { type: "object", properties: { serial: SERIAL_PROP } },
  },
  {
    name: "android_build",
    description:
      "用项目自带的 gradlew 构建（默认 assembleDebug），返回产物 APK 路径和末尾输出。适合「改完代码→装→跑」闭环。",
    inputSchema: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "含 gradlew 的项目目录" },
        task: { type: "string", description: "gradle task，默认 assembleDebug" },
        timeout_ms: { type: "number", description: "默认 900000（15 分钟）" },
      },
      required: ["project_dir"],
    },
  },
  {
    name: "android_list_apks",
    description: "列出项目目录下已构建出的 APK。",
    inputSchema: {
      type: "object",
      properties: { project_dir: { type: "string" } },
    },
  },
  {
    name: "android_shell",
    description:
      "直通 adb shell 逃生舱，传命令数组（或空格分隔字符串）。前面没有的工具用这个兜底。",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "如 \"dumpsys activity activities\"，或数组形式避免分词歧义" },
        timeout_ms: { type: "number" },
        serial: SERIAL_PROP,
      },
      required: ["command"],
    },
  },
  {
    name: "android_wait_idle",
    description:
      "等界面稳定下来再返回（连续两次 dump 的节点完全一致才算稳定）。**用它替掉 sleep** —— " +
      "跳转/加载/动画之后立刻截图或取层级，拿到的往往是中间态。",
    inputSchema: {
      type: "object",
      properties: {
        timeout_ms: { type: "number", description: "最多等多久（默认 15000）" },
        interval_ms: { type: "number", description: "多久查一次（默认 500）" },
        serial: SERIAL_PROP,
      },
    },
  },
  {
    name: "android_long_press",
    description: "长按。传 x/y 或 text=（与 android_tap 同一套定位）。",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" }, y: { type: "number" },
        text: { type: "string" }, exact: { type: "boolean" }, first: { type: "boolean" },
        duration_ms: { type: "number", description: "按下多久，默认 800" },
        serial: SERIAL_PROP,
      },
    },
  },
  {
    name: "android_double_tap",
    description: "双击（AOSP 没有 doubletap 子命令，实现是连点两次，间隔约 90ms）。",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" }, y: { type: "number" },
        text: { type: "string" }, exact: { type: "boolean" }, first: { type: "boolean" },
        gap_ms: { type: "number", description: "两次点击的间隔，默认 90" },
        serial: SERIAL_PROP,
      },
    },
  },
  {
    name: "android_drag",
    description: "拖拽（按住再移动，走 input draganddrop）。只是「划过去」的话 android_swipe 就够。",
    inputSchema: {
      type: "object",
      properties: {
        x1: { type: "number" }, y1: { type: "number" },
        x2: { type: "number" }, y2: { type: "number" },
        duration_ms: { type: "number", description: "整段拖拽时长，默认 800" },
        serial: SERIAL_PROP,
      },
      required: ["x1", "y1", "x2", "y2"],
    },
  },
  {
    name: "android_prepare",
    description:
      "把设备调成适合自动化的状态：关三个动效缩放（时序不稳的根源）、亮屏、上滑解锁。开工前跑一次能省掉后面一堆 sleep。",
    inputSchema: {
      type: "object",
      properties: {
        animations: { type: "boolean", description: "是否关动效（默认 true；传 false 则恢复成 1）" },
        serial: SERIAL_PROP,
      },
    },
  },
  {
    name: "android_foreground",
    description: "当前前台是哪个包、哪个 activity。「我现在到底在哪一页」用它，比 dump 更直接。",
    inputSchema: { type: "object", properties: { serial: SERIAL_PROP } },
  },
] as const;

async function main() {
  const server = new Server({ name: "android-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as unknown as any }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {
        case "android_status": return ok(await toolStatus(args));
        case "android_device_info": return ok(await toolDeviceInfo(args));
        case "android_foreground": return ok(await toolForeground(args));
        case "android_prepare": return ok(await toolPrepare(args));
        case "android_start_emulator": {
          let avd = args.avd ? String(args.avd) : undefined;
          if (!avd) {
            const a = await listAvds();
            const first = a.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
            if (!first) throw new AndroidError("没有可用 AVD。用 Android Studio 的 AVD Manager 建一个，或改用真机。");
            avd = first;
          }
          const extraArgs = Array.isArray(args.extra_args) ? args.extra_args.map(String) : undefined;
          const r = await startEmulator(avd, {
            waitBoot: args.wait_boot !== false,
            bootTimeoutMs: Number(args.boot_timeout_ms) || undefined,
            extraArgs,
          });
          return ok(r.message);
        }
        case "android_stop_emulator": {
          const serial = await resolveDevice(args.serial ? String(args.serial) : undefined);
          await stopEmulator(serial);
          return ok(`已关闭模拟器 ${serial}`);
        }
        case "android_screenshot": return ok(await toolScreenshot(args));
        case "android_dump_ui": return ok(await toolDumpUi(args));
        case "android_tap": return ok(await toolTap(args));
        case "android_swipe": return ok(await toolSwipe(args));
        case "android_long_press": return ok(await toolLongPress(args));
        case "android_double_tap": return ok(await toolDoubleTap(args));
        case "android_drag": return ok(await toolDrag(args));
        case "android_input_text": return ok(await toolInputText(args));
        case "android_press_key": return ok(await toolPressKey(args));
        case "android_wait_for_text": return ok(await toolWaitForText(args));
        case "android_wait_idle": return ok(await toolWaitIdle(args));
        case "android_install": return ok(await toolInstall(args));
        case "android_launch_app": return ok(await toolLaunch(args));
        case "android_force_stop": return ok(await toolForceStop(args));
        case "android_uninstall": return ok(await toolUninstall(args));
        case "android_list_packages": return ok(await toolListPackages(args));
        case "android_app_info": return ok(await toolAppInfo(args));
        case "android_logcat": return ok(await toolLogcat(args));
        case "android_clear_logcat": return ok(await toolClearLogcat(args));
        case "android_build": return ok(await toolBuild(args));
        case "android_list_apks": return ok(await toolListApks(args));
        case "android_shell": return ok(await toolShell(args));
        default: return ok(`未知工具: ${name}`);
      }
    } catch (e: any) {
      return ok(`错误: ${e?.message ?? e}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
