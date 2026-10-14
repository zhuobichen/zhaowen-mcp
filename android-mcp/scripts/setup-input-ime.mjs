#!/usr/bin/env node
/**
 * 一次性准备：往设备上装 ADBKeyboard，让 android_input_text 能输入中文。
 *
 * 为什么需要它：`adb shell input text` 在 Android 16 上对非 ASCII 直接抛 NPE，汉字一个都进不去。
 * 装一个"广播式输入法"是业界通行解法；本 MCP 用的是 senzhk/ADBKeyBoard。
 *
 * 两个必须记住的事实：
 *   1. **必须用 v2.5-dev**。v2.4-dev 在 Android 16(API 36) 上不可用 —— v2.5-dev 那个 pre-release
 *      的标题就是 "fix keyboard unusable on android-36"。
 *   2. 它的许可是 **GPL-2.0**，所以这个 APK **不放进仓库**（那会牵扯 GPL 的分发义务），
 *      由本脚本按需下载到本地缓存目录，并校验 sha256 钉死版本。
 *
 * 用法：
 *   node scripts/setup-input-ime.mjs                # 下载(带重试) + 安装到默认设备
 *   node scripts/setup-input-ime.mjs --serial emulator-5554
 *   node scripts/setup-input-ime.mjs --apk D:\path\to\keyboardservice-debug.apk   # 用本地已有的包
 *   node scripts/setup-input-ime.mjs --force        # 忽略缓存重新下载
 *
 * 注意：本机实测 GitHub 主域约一半请求会超时，所以这里默认重试 5 次、每次间隔递增。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const URL_V25 =
  "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.5-dev/keyboardservice-debug.apk";
/** 实测下载到的 v2.5-dev 产物校验值（2026-10-14）。对不上就说明上游换了东西，别装。 */
const SHA256_V25 = "41a8a0996d7397a2390d1ca16a75cb66c4a7bdaa89cf4e63600a4d3fb346fbbb";
const PKG = "com.android.adbkeyboard";
const IME = "com.android.adbkeyboard/.AdbIME";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** adb 定位顺序与 MCP 本体保持一致：ADB_PATH → PATH → ANDROID_SDK_ROOT / ANDROID_HOME。 */
function resolveAdb() {
  if (process.env.ADB_PATH && existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["adb"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return "adb";
  for (const root of [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME].filter(Boolean)) {
    for (const name of ["adb.exe", "adb"]) {
      const p = join(root, "platform-tools", name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** 缓存目录：跟着 SDK 走（本机 = D:\Android\adb-mcp-cache），避免落到用户目录。 */
function cacheDir() {
  if (process.env.ANDROID_MCP_CACHE) return process.env.ANDROID_MCP_CACHE;
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (sdk) return join(sdk, "..", "adb-mcp-cache");
  return join(tmpdir(), "adb-mcp-cache");
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function download(url, dest, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      process.stdout.write(`下载（第 ${i}/${attempts} 次）… `);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`只有 ${buf.length} 字节，不像个 APK`);
      writeFileSync(dest, buf);
      console.log(`成功（${buf.length} 字节）`);
      return buf;
    } catch (e) {
      console.log(`失败：${e.message}`);
      if (i === attempts) throw e;
      // 本机 GitHub 不稳，退避重试比一次就放弃务实得多
      const wait = 1500 * i;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function adbRun(adb, args) {
  const r = spawnSync(adb, args, { encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

async function main() {
  const adb = resolveAdb();
  if (!adb) {
    console.error("✗ 找不到 adb。先装 Android SDK Platform-Tools，或设置 ADB_PATH / ANDROID_SDK_ROOT。");
    process.exit(1);
  }
  const serialArgs = opt("--serial") ? ["-s", opt("--serial")] : [];

  let apk = opt("--apk");
  if (!apk) {
    const dir = cacheDir();
    mkdirSync(dir, { recursive: true });
    apk = join(dir, "ADBKeyboard-v2.5-dev.apk");

    let buf = null;
    if (existsSync(apk) && !flag("--force")) {
      buf = readFileSync(apk);
      const got = sha256(buf);
      if (got !== SHA256_V25) {
        console.log(`缓存里的包校验不符（${got}），重新下载。`);
        buf = null;
      } else {
        console.log(`用缓存：${apk}`);
      }
    }
    if (!buf) {
      buf = await download(URL_V25, apk);
    }
    const got = sha256(buf);
    if (got !== SHA256_V25) {
      console.error(
        `✗ 校验值对不上！\n  期望 ${SHA256_V25}\n  实际 ${got}\n` +
          `文件留在 ${apk} 供你核对。上游换过产物的话，先确认再改本脚本里的常数。`
      );
      process.exit(1);
    }
    console.log(`✓ 校验通过（sha256 ${got.slice(0, 16)}…）`);
  } else if (!existsSync(apk)) {
    console.error(`✗ --apk 指定的文件不存在：${apk}`);
    process.exit(1);
  }

  console.log(`安装到设备…`);
  let r = adbRun(adb, [...serialArgs, "install", "-r", apk]);
  if (/TEST_ONLY/i.test(r.out)) {
    // 它是 debug 构建，某些环境上会要求 -t
    console.log("提示说是 testOnly 包，带 -t 重试。");
    r = adbRun(adb, [...serialArgs, "install", "-r", "-t", apk]);
  }
  console.log(r.out.split("\n").slice(-3).join("\n"));
  if (!/Success/i.test(r.out)) {
    console.error("✗ 安装没成功，看上面的输出。");
    process.exit(1);
  }

  const imes = adbRun(adb, [...serialArgs, "shell", "ime", "list", "-a", "-s"]).out;
  const ok = imes.includes(PKG);
  console.log(ok ? `✓ 输入法已注册：${IME}` : `✗ 装上了但系统没列出这个输入法，android_input_text 会退回剪贴板路径。`);
  console.log(
    ok
      ? `\n完成。android_input_text 现在能输入中文了（用的时候它会自己切过去再切回来）。`
      : `\n可用的输入法：\n${imes}`
  );
}

main().catch((e) => {
  console.error(`✗ 出错：${e?.message ?? e}`);
  process.exit(1);
});
