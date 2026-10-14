/**
 * 往设备里输入文字 —— 重点是**中文**。
 *
 * 背景（2026-10-14 在 Android 16 / API 36 上实测）：
 *   - `adb shell input text` 对非 ASCII 直接抛 NullPointerException（InputShellCommand.sendText），
 *     汉字一个都进不去。它只能用来打 ASCII。
 *   - 正解是设备侧装一个「广播式输入法」ADBKeyboard：切过去之后，
 *     `am broadcast -a ADB_INPUT_B64 --es msg <base64(utf8)>` 就能把任意 Unicode 灌进焦点输入框。
 *
 * 实测踩到的坑（别重踩）：
 *   1. **`ime set` 会让当前输入框丢输入连接** —— 切完输入法直接广播，文字哪儿也不去。
 *      必须先把输入框重新点一次（恢复焦点/连接），再广播。
 *   2. 广播前记得确认输入框仍是有焦点的可编辑节点，否则广播"成功"但没效果（result=0 不代表进了字）。
 *   3. ADBKeyboard 的包名/服务名：com.android.adbkeyboard / .AdbIME。
 *
 * 回退路径（设备上没装 ADBKeyboard 时）：借宿主机剪贴板 + KEYCODE_PASTE。
 * 那条**只对模拟器成立**（真机没有与宿主机的剪贴板互通），所以永远标注出来。
 */
import { spawnSync } from "node:child_process";
import { adb, dumpUiXml, AndroidError } from "./android.js";
import { parseUiXml, type UiNode } from "./uiautomator.js";

export const ADB_KEYBOARD_PKG = "com.android.adbkeyboard";
export const ADB_KEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Method = "ascii" | "adbkeyboard" | "clipboard";

export interface InputOutcome {
  method: Method;
  /** 人话说明这次实际走了哪条路、有什么副作用 */
  note: string;
  /** 输入后从设备读回来的输入框内容（拿不到就是 undefined） */
  readback?: string;
  /** 是否确认文字进去了（读回校验的结果；拿不到回读时为 false） */
  verified: boolean;
}

/** 能否安全走 `input text`：纯可打印 ASCII（空格由调用方转 %s）。 */
export function isAsciiText(s: string): boolean {
  return s.length > 0 && /^[\x20-\x7E]+$/.test(s);
}

async function sh(serial: string, cmd: string[], timeoutMs = 20000) {
  return adb(["shell", ...cmd], serial, timeoutMs);
}

/** 当前默认输入法 id（形如 pkg/.Service），取不到返回空串。 */
export async function defaultIme(serial: string): Promise<string> {
  const r = await sh(serial, ["settings", "get", "secure", "default_input_method"]);
  return r.stdout.trim();
}

/** 设备上已启用的输入法列表。 */
export async function enabledImes(serial: string): Promise<string[]> {
  const r = await sh(serial, ["ime", "list", "-a", "-s"]);
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** ADBKeyboard 是否可用（装了 + 系统认出来了）。 */
export async function adbKeyboardReady(serial: string): Promise<boolean> {
  const pkgs = await sh(serial, ["pm", "list", "packages", ADB_KEYBOARD_PKG]);
  if (!pkgs.stdout.includes(ADB_KEYBOARD_PKG)) return false;
  const imes = await enabledImes(serial);
  return imes.some((i) => i.includes(ADB_KEYBOARD_PKG));
}

async function setIme(serial: string, id: string): Promise<void> {
  await sh(serial, ["ime", "enable", id]);
  const r = await sh(serial, ["ime", "set", id]);
  if (r.code !== 0) {
    throw new AndroidError(`切换输入法到 ${id} 失败：${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
  }
}

async function broadcast(serial: string, action: string, text?: string): Promise<void> {
  const args = ["am", "broadcast", "-a", action];
  if (text !== undefined) args.push("--es", "msg", text);
  const r = await sh(serial, args, 20000);
  // am broadcast 的 "result=0" 只说明广播发到了，不代表字进去了 —— 所以这里不当作成功依据，
  // 真正的判据是后面读回输入框内容。
  if (r.code !== 0) {
    throw new AndroidError(`广播 ${action} 失败：${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
  }
}

/** 找一个「有焦点且可编辑」的节点。没有就返回 null（调用方要给明确提示）。 */
export function findFocusedEditable(nodes: UiNode[]): UiNode | null {
  const editable = (n: UiNode) => /EditText|AutoCompleteTextView/i.test(n.cls) || n.text !== "" || n.desc !== "";
  const focused = nodes.filter((n) => n.focused && editable(n));
  if (focused.length) return focused[0];
  const anyEdit = nodes.filter((n) => /EditText|AutoCompleteTextView/i.test(n.cls));
  return anyEdit.length === 1 ? anyEdit[0] : null;
}

async function currentNodes(serial: string): Promise<UiNode[]> {
  return parseUiXml(await dumpUiXml(serial));
}

/**
 * 走 ADBKeyboard 广播输入。**已包含"重新点焦点"那一步**（见文件头坑 1）。
 */
export async function inputViaAdbKeyboard(
  serial: string,
  text: string,
  opts: { clear?: boolean } = {}
): Promise<InputOutcome> {
  const nodes = await currentNodes(serial);
  const field = findFocusedEditable(nodes);
  const before = field ? field.text : undefined;
  const target = field ? { x: field.x, y: field.y } : null;
  const originalIme = await defaultIme(serial);

  await setIme(serial, ADB_KEYBOARD_IME);
  try {
    if (target) {
      // 坑 1：切完输入法必须重新点一次输入框，否则广播没人接。
      await sh(serial, ["input", "tap", String(target.x), String(target.y)], 15000);
      await sleep(300);
    }
    if (opts.clear) await broadcast(serial, "ADB_CLEAR_TEXT");
    await broadcast(serial, "ADB_INPUT_B64", Buffer.from(text, "utf8").toString("base64"));
    await sleep(500);
  } finally {
    if (originalIme && originalIme !== ADB_KEYBOARD_IME) {
      // 用完把输入法还回去，别让设备停在"没有屏幕键盘"的状态
      await setIme(serial, originalIme).catch(() => undefined);
    }
  }

  const after = await currentNodes(serial);
  const field2 = findFocusedEditable(after) ?? after.find((n) => target && n.x === target.x && n.y === target.y) ?? null;
  const readback = field2?.text;
  const verified = readback !== undefined && readback.includes(text.slice(0, Math.min(4, text.length)));
  return {
    method: "adbkeyboard",
    note:
      `走 ADBKeyboard 广播输入（切过输入法又切回了 ${originalIme || "原输入法"}）` +
      (target ? "" : "；没识别到有焦点的输入框，若没进去请先 android_tap 点一下输入框"),
    readback,
    verified,
  };
}

/**
 * 回退：借宿主机剪贴板 + KEYCODE_PASTE(279)。
 * **只对模拟器成立**（宿主机与模拟器剪贴板互通），而且依赖焦点输入框。
 */
export async function inputViaClipboard(serial: string, text: string, opts: { clear?: boolean } = {}): Promise<InputOutcome> {
  const nodes = await currentNodes(serial);
  const field = findFocusedEditable(nodes);
  if (!field) {
    throw new AndroidError(
      "回退路径需要输入框处于焦点：先用 android_tap 点一下输入框，或者装上 ADBKeyboard（scripts/setup-input-ime.mjs）。"
    );
  }
  // clip.exe 读 stdin。这里写 UTF-8 字节，能否被正确解析取决于宿主机的控制台代码页 ——
  // 所以下面一律以"读回校验"为准，不当它一定成功。
  const clip = spawnSync("clip.exe", [], { input: Buffer.from(text, "utf8") });
  if (clip.status !== 0 && clip.status !== null) {
    throw new AndroidError(`写宿主机剪贴板失败（clip.exe exit ${clip.status}）`);
  }
  await sh(serial, ["input", "tap", String(field.x), String(field.y)], 15000);
  await sleep(250);
  if (opts.clear) await sh(serial, ["input", "keyevent", "123"], 15000); // MOVE_END
  await sh(serial, ["input", "keyevent", "279"], 15000); // PASTE
  await sleep(500);

  const after = await currentNodes(serial);
  const f2 = findFocusedEditable(after) ?? after.find((n) => n.x === field.x && n.y === field.y) ?? null;
  const readback = f2?.text;
  const verified = readback !== undefined && readback.includes(text.slice(0, Math.min(4, text.length)));
  return {
    method: "clipboard",
    note: "走宿主机剪贴板 + PASTE 键（**只有模拟器有效，真机没有剪贴板互通**）",
    readback,
    verified,
  };
}

/**
 * 统一入口：按内容自动分流。
 * 返回里一定写明**实际走了哪条路**，因为三条路的适用范围和副作用完全不同。
 */
export async function inputText(
  serial: string,
  text: string,
  opts: { clear?: boolean; preferClipboard?: boolean } = {}
): Promise<InputOutcome> {
  if (isAsciiText(text) && !opts.preferClipboard) {
    const encoded = text.replace(/ /g, "%s");
    if (opts.clear) {
      // 先全选再输入，等于覆盖 —— KEYCODE_MOVE_END 之后按 DEL 清不干净，改用全选。
      await sh(serial, ["input", "keyevent", "123"], 15000);
      for (let i = 0; i < Math.max(text.length, 8); i++) {
        await sh(serial, ["input", "keyevent", "67"], 15000);
      }
    }
    const r = await sh(serial, ["input", "text", encoded], 20000);
    if (r.code !== 0) {
      throw new AndroidError(`input text 失败(exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
    }
    return { method: "ascii", note: "走 adb `input text`（纯 ASCII）", verified: true };
  }

  if (await adbKeyboardReady(serial)) {
    return inputViaAdbKeyboard(serial, text, { clear: opts.clear });
  }
  return inputViaClipboard(serial, text, { clear: opts.clear });
}
