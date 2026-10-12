/**
 * android-mcp 的底层：adb / emulator 可执行文件定位、命令执行、设备/模拟器管理。
 *
 * 设计取舍（都踩过坑才这么定）：
 *
 * 1. **不 shell 拼接**。全部用 spawn + 参数数组执行，`package` / `text` 这类
 *    用户/模型可控的输入作为独立参数传，绝不拼成 `adb shell input text "a;b"`。
 *    拼接 = 命令注入，且 `;` `&` `|` 在设备 shell 里全部有效。
 *
 * 2. **二进制输出单独走 exec-out**。`adb exec-out screencap -p` 是唯一能拿到
 *    干净 PNG 的路子（`adb shell screencap` 会被换行符污染）。所以截图不经过
 *    文本 decode，直接拿 Buffer。
 *
 * 3. **选设备的歧义要显式报错**。多设备时猜一个 = 测到别的手机上，属于危险
 *    的静默失败，宁可抛错让调用方指定 serial。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class AndroidError extends Error {}

const ADB_MISSING =
  "找不到 adb。请安装 Android SDK Platform-Tools 并把 platform-tools 加入 PATH，" +
  "或设置环境变量 ADB_PATH / ANDROID_SDK_ROOT 后重开 MCP。";

const EMULATOR_MISSING =
  "找不到 emulator 可执行文件。请安装 Android SDK Emulator，或用真机 USB 调试代替模拟器。";

/** adb 的候选位置：显式 ADB_PATH → PATH → 常见 SDK 安装目录。 */
function adbCandidates(): string[] {
  const list: string[] = [];
  if (process.env.ADB_PATH) list.push(process.env.ADB_PATH);
  list.push("adb"); // 交给系统 PATH 解析
  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
    process.env.HOME ? join(process.env.HOME, "Android", "Sdk") : null,
  ].filter(Boolean) as string[];
  for (const root of roots) {
    list.push(join(root, "platform-tools", "adb.exe"));
    list.push(join(root, "platform-tools", "adb"));
  }
  return list;
}

function inPath(cmd: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSyncText(probe, [cmd]);
  return r.code === 0 && r.stdout.trim().length > 0;
}

function spawnSyncText(cmd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  // 这里只用于同步探测命令是否存在（where/which），不用完整 spawn 封装。
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

let cachedAdb: string | null = null;

export function resolveAdb(): string {
  if (cachedAdb) return cachedAdb;
  for (const cand of adbCandidates()) {
    if (cand === "adb") {
      if (inPath("adb")) {
        cachedAdb = "adb";
        return cachedAdb;
      }
      continue;
    }
    if (existsSync(cand)) {
      cachedAdb = cand;
      return cachedAdb;
    }
  }
  throw new AndroidError(ADB_MISSING);
}

function emulatorCandidates(): string[] {
  const list: string[] = [];
  if (process.env.EMULATOR_PATH) list.push(process.env.EMULATOR_PATH);
  list.push("emulator");
  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
    process.env.HOME ? join(process.env.HOME, "Android", "Sdk") : null,
  ].filter(Boolean) as string[];
  for (const root of roots) {
    list.push(join(root, "emulator", "emulator.exe"));
    list.push(join(root, "emulator", "emulator"));
  }
  return list;
}

export function resolveEmulator(): string {
  for (const cand of emulatorCandidates()) {
    if (cand === "emulator") {
      if (inPath("emulator")) return "emulator";
      continue;
    }
    if (existsSync(cand)) return cand;
  }
  throw new AndroidError(EMULATOR_MISSING);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runProcess(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; encoding?: "utf8" | "buffer" } = {}
): Promise<{ code: number; stdout: any; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: false, // 安全：参数不经过 shell
      windowsHide: true,
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new AndroidError(`命令超时（${timeoutMs}ms）: ${cmd} ${args.join(" ")}`));
      }
    }, timeoutMs);

    child.stdout.on("data", (c: Buffer) => outChunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const out = Buffer.concat(outChunks);
        const err = Buffer.concat(errChunks).toString("utf8");
        resolve({
          code: code ?? 0,
          stdout: opts.encoding === "buffer" ? out : out.toString("utf8"),
          stderr: err,
        });
      }
    });
  });
}

/** 跑 adb <args...>，自动按需加 -s <serial>。 */
export async function adb(args: string[], serial?: string, timeoutMs?: number): Promise<RunResult> {
  const bin = resolveAdb();
  const full = serial ? ["-s", serial, ...args] : args;
  const r = await runProcess(bin, full, { timeoutMs: timeoutMs ?? 20000, encoding: "utf8" });
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
}

/** 拿二进制输出（截图等）。必须用 exec-out，否则被 shell 换行污染。 */
export async function adbBinary(args: string[], serial?: string, timeoutMs?: number): Promise<Buffer> {
  const bin = resolveAdb();
  const full = serial ? ["-s", serial, ...args] : args;
  const r = await runProcess(bin, full, { timeoutMs: timeoutMs ?? 30000, encoding: "buffer" });
  return r.stdout as Buffer;
}

export interface DeviceInfo {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
}

/** `adb devices -l` → 结构化列表。 */
export async function listDevices(): Promise<DeviceInfo[]> {
  const r = await adb(["devices", "-l"]);
  const lines = r.stdout.split(/\r?\n/).slice(1); // 跳过 "List of devices attached"
  const out: DeviceInfo[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const [serial, state, ...rest] = t.split(/\s+/);
    if (!serial || !state) continue;
    const kv: Record<string, string> = {};
    for (const item of rest) {
      const m = item.match(/^([a-zA-Z_]+):(.*)$/);
      if (m) kv[m[1]] = m[2];
    }
    out.push({
      serial,
      state,
      model: kv.model,
      product: kv.product,
      device: kv.device,
      transportId: kv.transport_id,
    });
  }
  return out;
}

/**
 * 解析目标设备 serial：
 * - 显式传入 → 直接用
 * - 恰好 1 台在线设备 → 用它
 * - 0 台 → 抛错（提示开模拟器/插真机）
 * - 多台 → 抛错并列出，**不猜**（猜错 = 测到别的机器上）
 */
export async function resolveDevice(explicit?: string): Promise<string> {
  const devices = await listDevices();
  const online = devices.filter((d) => d.state === "device");

  if (explicit) {
    const hit = online.find((d) => d.serial === explicit);
    if (!hit) {
      throw new AndroidError(
        `找不到在线设备 serial="${explicit}"。当前在线：` +
          (online.length ? online.map((d) => d.serial).join(", ") : "(无)")
      );
    }
    return hit.serial;
  }
  if (online.length === 0) {
    const seen = devices.map((d) => `${d.serial}(${d.state})`).join(", ") || "(无)";
    throw new AndroidError(
      `当前没有在线设备（adb devices: ${seen}）。` +
        "请先用 android_start_emulator 启动模拟器，或连接真机并开启 USB 调试。"
    );
  }
  if (online.length === 1) return online[0].serial;
  throw new AndroidError(
    `检测到多台在线设备：${online.map((d) => d.serial).join(", ")}。` +
      "请在工具参数里显式指定 serial，避免操作到错误的设备。"
  );
}

export function listAvds(): Promise<RunResult> {
  const bin = resolveEmulator();
  return runProcess(bin, ["-list-avds"], { timeoutMs: 15000, encoding: "utf8" }).then((r) => ({
    code: r.code,
    stdout: r.stdout as string,
    stderr: r.stderr,
  }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动一个 AVD 并等到 boot 完成。
 * 用 spawn + detached + unref，让模拟器脱离本进程常驻（不能用 runProcess 等它退出，
 * 模拟器是长驻前台程序，永远不 close）。
 */
export async function startEmulator(
  avd: string,
  opts: { waitBoot?: boolean; bootTimeoutMs?: number; extraArgs?: string[] } = {}
): Promise<{ serial?: string; booted: boolean; message: string }> {
  const bin = resolveEmulator();
  const args = ["-avd", avd, "-no-boot-anim", ...(opts.extraArgs ?? [])];
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: false, // 模拟器有 GUI，让它正常显示
  });
  child.unref();

  if (opts.waitBoot === false) {
    return { booted: false, message: `已启动模拟器 ${avd}（未等待 boot 完成）` };
  }

  const deadline = Date.now() + (opts.bootTimeoutMs ?? 180000);
  // 先等设备上线
  let serial: string | undefined;
  while (Date.now() < deadline) {
    const online = (await listDevices()).filter((d) => d.state === "device");
    if (online.length === 1) {
      serial = online[0].serial;
      break;
    }
    await sleep(2000);
  }
  if (!serial) {
    return { booted: false, message: `模拟器 ${avd} 已在后台启动，但 ${Math.round((opts.bootTimeoutMs ?? 180000) / 1000)}s 内设备未上线` };
  }
  // 再等 sys.boot_completed=1
  while (Date.now() < deadline) {
    const r = await adb(["shell", "getprop", "sys.boot_completed"], serial, 10000);
    if (r.stdout.trim() === "1") {
      return { serial, booted: true, message: `模拟器 ${avd} 已启动并完成开机（serial=${serial}）` };
    }
    await sleep(2000);
  }
  return { serial, booted: false, message: `模拟器 ${avd} 已上线（serial=${serial}）但等待 boot 完成超时` };
}

/** 关机：`adb emu kill` 是模拟器唯一可靠的优雅关闭方式。 */
export async function stopEmulator(serial: string): Promise<RunResult> {
  return adb(["emu", "kill"], serial, 10000);
}
