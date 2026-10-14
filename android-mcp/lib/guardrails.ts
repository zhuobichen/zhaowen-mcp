/**
 * 禁区（guardrails）：把"哪些地方不许碰"做成配置，工具在执行前就拒掉。
 *
 * 为什么要有这一层：AI 操作手机时，最危险的不是点错一个按钮，而是**进入了不该进的地方**
 * 之后的一系列动作 —— 那之后每一步看起来都"正常"，没人会再拦。
 * 靠 prompt 里写规矩是不可靠的（换会话就没了），所以做成配置 + 在执行点强制检查。
 *
 * 两份配置叠加，后者追加：
 *   1. 随服务走的 `guardrails.json`（可提交，放通用规则）
 *   2. 用户级 `~/.claude/android-guardrails.json`（放不想上库的规则）
 *
 * 不想让某条规则生效，在任一份里写 `disabled: ["规则id"]`。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export interface GuardRule {
  /** 规则 id，命中时会报给调用方，便于定位与临时禁用 */
  id: string;
  /** 这条规则存在的理由，会一起回给调用方 */
  note?: string;
  /** 禁止操作的目标包名（精确或前缀匹配） */
  denyPackages?: string[];
  /** 禁止打开的目标 activity（子串匹配） */
  denyActivities?: string[];
  /** 命令/地址里出现这些子串就拒（用于 shell、URL scheme、activity 字符串） */
  denyUrlPatterns?: string[];
  /** 要点的节点文本**等于**这些词就拒（归一化后精确匹配，避免误伤「存储空间」这类复合词） */
  denyTapText?: string[];
  /** 要点的节点文本**包含**这些子串就拒（比上面宽，谨慎用） */
  denyTapTextContains?: string[];
  /** 上面两条文字规则只在当前前台是这些包时才生效（留空 = 不限前台） */
  denyTapTextInPackages?: string[];
  /** shell 命令里出现这些子串就拒 */
  denyShellPatterns?: string[];
  /** 当前前台包名/activity 命中这些子串就拒（给 dump_ui / screenshot 这类「看」的动作用） */
  denyForegroundPatterns?: string[];
}

interface GuardFile {
  version?: number;
  rules?: GuardRule[];
  disabled?: string[];
}

export interface GuardContext {
  /** 动作名，仅用于报错文案：tap / launch / shell / input */
  action: string;
  /** 当前前台包名（能拿到就带上，判定 denyTapTextInPackages 要用） */
  packageName?: string;
  /** 目标包名（launch 时用） */
  targetPackage?: string;
  /** 目标 activity（launch 时用） */
  targetActivity?: string;
  /** 要点的节点文本（tap 时用） */
  nodeText?: string;
  /** shell 命令原文（shell 时用） */
  command?: string;
}

export interface GuardHit {
  blocked: true;
  ruleId: string;
  note?: string;
  reason: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLED = join(here, "..", "guardrails.json");
const USER_FILE = join(homedir(), ".claude", "android-guardrails.json");

function readGuardFile(path: string): GuardFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as GuardFile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // 配置坏了就当作没有这条 —— 但别静默：调用方能在 status 里看到
    return null;
  }
}

let cached: { rules: GuardRule[]; disabled: Set<string> } | null = null;

/** 读配置（带缓存）。改完配置要重开 MCP 才生效。 */
export function loadGuardrails(force = false): { rules: GuardRule[]; disabled: Set<string> } {
  if (cached && !force) return cached;
  const files = [readGuardFile(BUNDLED), readGuardFile(USER_FILE)];
  const rules: GuardRule[] = [];
  const disabled = new Set<string>();
  for (const f of files) {
    if (!f) continue;
    for (const r of f.rules ?? []) if (r && typeof r.id === "string") rules.push(r);
    for (const d of f.disabled ?? []) disabled.add(String(d));
  }
  cached = { rules, disabled };
  return cached;
}

/** 供 android_status 自检用：配置文件在哪、读到了几条、有没有坏文件。 */
export function guardrailsSummary(): string[] {
  const { rules, disabled } = loadGuardrails(true);
  const lines: string[] = [];
  lines.push(`- 随服务: ${existsSync(BUNDLED) ? BUNDLED : "(缺失)"}`);
  lines.push(`- 用户级: ${existsSync(USER_FILE) ? USER_FILE : "(没有，可建)"}`);
  lines.push(`- 生效规则 ${rules.length - rules.filter((r) => disabled.has(r.id)).length} 条 / 共 ${rules.length} 条`);
  for (const r of rules) {
    lines.push(`  · ${r.id}${disabled.has(r.id) ? " [已禁用]" : ""}${r.note ? ` — ${r.note}` : ""}`);
  }
  return lines;
}

const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function exactHit(haystack: string | undefined, needles: string[] | undefined): string | null {
  if (!haystack || !needles?.length) return null;
  const h = normalize(haystack);
  for (const n of needles) {
    if (n && normalize(n) === h) return n;
  }
  return null;
}

function has(haystack: string | undefined, needles: string[] | undefined): string | null {
  if (!haystack || !needles?.length) return null;
  const h = haystack.toLowerCase();
  for (const n of needles) {
    if (n && h.includes(n.toLowerCase())) return n;
  }
  return null;
}

function pkgMatches(pkg: string | undefined, list: string[] | undefined): string | null {
  if (!pkg || !list?.length) return null;
  const p = pkg.toLowerCase();
  for (const n of list) {
    const t = (n ?? "").toLowerCase();
    if (!t) continue;
    if (p === t || p.startsWith(t + ".") || p.includes(t)) return n;
  }
  return null;
}

/**
 * 判定这次动作能不能做。命中即返回 blocked，调用方**不许再执行**，
 * 并把 ruleId / reason 原样回给使用方（别吞掉、别只说"被禁止了"）。
 */
export function checkGuardrails(ctx: GuardContext): GuardHit | null {
  const { rules, disabled } = loadGuardrails();
  for (const r of rules) {
    if (disabled.has(r.id)) continue;

    const pkgHit = pkgMatches(ctx.targetPackage ?? undefined, r.denyPackages);
    if (pkgHit) {
      return { blocked: true, ruleId: r.id, note: r.note, reason: `目标包 ${ctx.targetPackage} 命中禁止包名「${pkgHit}」` };
    }

    const actHit = has(ctx.targetActivity, r.denyActivities);
    if (actHit) {
      return { blocked: true, ruleId: r.id, note: r.note, reason: `目标 activity 命中禁止项「${actHit}」` };
    }

    // shell：命令原文里出现禁制子串
    const cmdHit = has(ctx.command, r.denyShellPatterns) ?? has(ctx.command, r.denyUrlPatterns);
    if (cmdHit) {
      return { blocked: true, ruleId: r.id, note: r.note, reason: `命令里出现禁止子串「${cmdHit}」` };
    }

    // launch：地址/组件串里出现禁制子串（URL scheme、域名等）
    const tgt = [ctx.targetActivity, ctx.targetPackage].filter(Boolean).join(" ");
    const tgtHit = has(tgt, r.denyUrlPatterns);
    if (tgtHit) {
      return { blocked: true, ruleId: r.id, note: r.note, reason: `目标里出现禁止地址「${tgtHit}」` };
    }

    // tap：要点的文字命中（精确优先，其次包含），且（若规则限定了前台包）当前前台在名单里
    const textHit = exactHit(ctx.nodeText, r.denyTapText) ?? has(ctx.nodeText, r.denyTapTextContains);
    if (textHit) {
      const scope = r.denyTapTextInPackages;
      // 前台识别不出来时**按保守处理**（当作在禁区内）：
      // 这是隐私边界，宁可多拦一次让人来解释，也别因为"不知道自己在哪"就放行。
      const unknownWhere = !ctx.packageName;
      const inScope = !scope?.length || unknownWhere || pkgMatches(ctx.packageName, scope) !== null;
      if (inScope) {
        return {
          blocked: true,
          ruleId: r.id,
          note: r.note,
          reason:
            `要点的东西文字命中禁止词「${textHit}」` +
            (scope?.length
              ? unknownWhere
                ? "（前台识别不出来，按保守处理拦下）"
                : `（且当前前台是 ${ctx.packageName}）`
              : ""),
        };
      }
    }
  }
  return null;
}

/**
 * 给「看」的动作（dump_ui / screenshot）用的前台检查。
 *
 * 为什么还需要这一条：只拦「点进去」是不够的 —— 如果人已经手工点进了某个页面，
 * 或者上一步侥幸进去了，那之后每一次 dump 都在把不该看的内容读出来。
 * 所以看之前也要问一次「现在站在哪儿」。
 *
 * 诚实说明：QZone 在 QQ 里常是 WebView 页面，activity 名不一定带 qzone，
 * 这条是尽力而为，不是铁保证 —— 真正的保证是"从不点进去"。
 */
export function checkForeground(pkg: string | undefined, activity: string | undefined): GuardHit | null {
  const { rules, disabled } = loadGuardrails();
  const probe = [pkg, activity].filter(Boolean).join(" ");
  if (!probe) return null;
  for (const r of rules) {
    if (disabled.has(r.id)) continue;
    const hit = has(probe, r.denyForegroundPatterns);
    if (hit) {
      return {
        blocked: true,
        ruleId: r.id,
        note: r.note,
        reason: `当前前台（${probe}）命中禁止项「${hit}」`,
      };
    }
  }
  return null;
}

/** 命中禁区时统一的回话文案 —— 要能让人一眼看懂是哪条规矩、怎么继续。 */
export function guardMessage(hit: GuardHit, action: string): string {
  return [
    `⛔ 已被禁区规则拦下（${action}）`,
    `- 规则: ${hit.ruleId}${hit.note ? ` — ${hit.note}` : ""}`,
    `- 原因: ${hit.reason}`,
    `- 这条规则写在 guardrails 配置里，工具层直接拒执行，不是猜的。`,
    `- 如果你确实要做这件事，请先跟我确认，再由你决定改配置还是手工操作；我不会自行绕过。`,
  ].join("\n");
}
