/**
 * 本机智能体会话只读解析模块（Claude Code + Codex）
 *
 * 数据源：
 *   claude : ~/.claude/projects/<编码项目目录>/<uuid>.jsonl   (文件名 = 会话ID)
 *   codex  : ~/.codex/sessions 下 rollout-*.jsonl 与 archived_sessions
 *
 * 行为对齐 agent-dialog_management/scripts/agent_dialog.py 的
 * scan_claude / decode_claude_project / scan_codex / first_user_text_codex /
 * _load_claude_messages / _load_codex_messages。
 */

import { homedir } from "os";
import { join } from "path";
import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { createInterface } from "readline";

export type AgentKind = "claude" | "codex";

export interface AgentSession {
  agent: AgentKind;
  id: string;
  title: string;
  cwd: string;
  project: string; // 展示用项目路径（cwd 或解码目录名）
  time: string; // YYYY-MM-DD HH:MM
  archived: boolean;
  file: string;
}

export interface SessionMessage {
  ts: string;
  role: "user" | "assistant";
  text: string;
  line: number;
}

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude", "projects");
const CODEX_DIR = join(HOME, ".codex", "sessions");
const ARCHIVE_DIR = join(HOME, ".codex", "archived_sessions");

// ---------------------------------------------------------------------------
// 文件收集
// ---------------------------------------------------------------------------

function collectFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) collectFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(full);
  }
}

/** Codex: sessions + archived 下的全部 rollout jsonl */
function codexFiles(): { file: string; archived: boolean }[] {
  const files: { file: string; archived: boolean }[] = [];
  const live: string[] = [];
  const arch: string[] = [];
  collectFiles(CODEX_DIR, live);
  collectFiles(ARCHIVE_DIR, arch);
  for (const f of live) files.push({ file: f, archived: false });
  for (const f of arch) files.push({ file: f, archived: true });
  return files;
}

/** Claude: 每个项目目录下的顶层 <uuid>.jsonl（递归采集，文件名符合 uuid 才纳入） */
function claudeFiles(): string[] {
  const out: string[] = [];
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const all: string[] = [];
  if (existsSync(CLAUDE_DIR)) {
    for (const proj of readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue;
      collectFiles(join(CLAUDE_DIR, proj.name), all);
    }
  }
  for (const f of all) {
    const base = f.slice(f.lastIndexOf("\\") + 1);
    const stem = base.replace(/\.jsonl$/, "");
    if (uuidRe.test(stem)) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 文本提取 / 上下文过滤 / 时间
// ---------------------------------------------------------------------------

function textFromBlocks(content: any): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      const bt = (b as any).type;
      if (bt === "text" || bt === "input_text" || bt === "output_text") {
        const t = (b as any).text;
        if (typeof t === "string" && t) parts.push(t);
      }
    }
    return parts.join("\n").trim();
  }
  return "";
}

/** Codex 开发者注入 / 系统上下文 */
function isSystemContext(text: string): boolean {
  if (!text) return true;
  const low = text.replace(/^\s+/, "");
  if (
    low.startsWith("<app-context>") ||
    low.startsWith("<permissions") ||
    low.startsWith("<collaboration_mode>") ||
    low.startsWith("<environment_context>") ||
    low.startsWith("<skills_instructions>") ||
    low.startsWith("<tool_instructions>") ||
    low.startsWith("<approval_policy>") ||
    low.startsWith("# AGENTS.md")
  ) {
    return true;
  }
  if (text.slice(0, 200).includes("AGENTS.md instructions")) return true;
  return false;
}

function parseLine(line: string): Record<string, any> | null {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function fmtIso(ts: string): string {
  if (!ts) return "";
  return ts.slice(0, 16).replace("T", " ");
}

function mtimeStr(file: string): string {
  try {
    const d = statSync(file).mtime;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return "";
  }
}

/** 解码 Claude 项目目录名（- 同时代表 \ 和 _，尽力还原，仅在 cwd 缺失时兜底） */
export function decodeClaudeProject(dirname: string): string {
  const m = /^([A-Za-z])--(.*)$/.exec(dirname);
  if (m) return m[1] + ":\\" + m[2].replace(/-/g, "\\");
  return dirname;
}

// ---------------------------------------------------------------------------
// Claude 扫描（单文件）
// ---------------------------------------------------------------------------

interface ClaudeScan {
  id: string;
  aiTitle: string;
  customTitle: string;
  cwd: string;
  ts: string;
  firstUserText: string;
}

function scanClaudeFile(file: string): Promise<ClaudeScan> {
  const base = file.slice(file.lastIndexOf("\\") + 1);
  const id = base.replace(/\.jsonl$/, "");
  const scan: ClaudeScan = {
    id,
    aiTitle: "",
    customTitle: "",
    cwd: "",
    ts: "",
    firstUserText: "",
  };
  return new Promise((resolve) => {
    // 标题/cwd/首条 user 均位于文件前部（实测 ≤1531 行）；读满上限即返回，避免全量读大文件
    const CAP = 2500;
    let count = 0;
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    const tryFinish = () => {
      const hasTitle = !!(scan.customTitle || scan.aiTitle || scan.firstUserText);
      if ((scan.cwd && hasTitle) || count >= CAP) {
        rl.close();
      }
    };
    rl.on("line", (line) => {
      count += 1;
      const d = parseLine(line);
      if (d) {
        const t = d.type;
        if (t === "ai-title" && !scan.aiTitle) {
          scan.aiTitle = d.aiTitle || "";
        } else if (t === "custom-title") {
          scan.customTitle = d.title || scan.customTitle;
        } else if (t === "user") {
          if (!scan.cwd) scan.cwd = d.cwd || "";
          if (!scan.ts) scan.ts = d.timestamp || "";
          if (!scan.firstUserText) {
            const m = d.message;
            if (m && typeof m === "object") {
              scan.firstUserText = textFromBlocks((m as any).content);
            }
          }
        }
      }
      tryFinish();
    });
    rl.on("error", () => resolve(scan));
    rl.on("close", () => resolve(scan));
  });
}

// ---------------------------------------------------------------------------
// Codex 扫描（单文件）
// ---------------------------------------------------------------------------

interface CodexScan {
  meta: Record<string, any> | null;
  title: string;
}

function scanCodexFile(file: string): Promise<CodexScan> {
  return new Promise((resolve) => {
    const out: CodexScan = { meta: null, title: "" };
    let count = 0;
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    const finish = () => {
      rl.close();
      resolve(out);
    };
    rl.on("line", (line) => {
      count += 1;
      const d = parseLine(line);
      if (!d) return;
      if (d.type === "session_meta" && !out.meta) {
        out.meta = d.payload || {};
        if (out.title) finish();
        return;
      }
      if (d.type === "response_item") {
        if (!out.meta) {
          finish();
          return;
        }
        const p = d.payload || {};
        if (p.type === "message" && p.role === "user" && !out.title) {
          const text = textFromBlocks(p.content);
          if (text && !isSystemContext(text) && text.length <= 1500) {
            out.title = text;
            finish();
            return;
          }
        }
      }
      if (count > 3000) finish();
    });
    rl.on("error", () => finish());
    rl.on("close", () => resolve(out));
  });
}

// ---------------------------------------------------------------------------
// 汇总 list
// ---------------------------------------------------------------------------

/** 列出会话。agent 可选过滤 claude/codex；缺省或 "all" 列全部。 */
export async function listSessions(agent?: AgentKind | "all"): Promise<AgentSession[]> {
  const out: AgentSession[] = [];
  const wantClaude = !agent || agent === "all" || agent === "claude";
  const wantCodex = !agent || agent === "all" || agent === "codex";

  if (wantClaude) {
    for (const file of claudeFiles()) {
      const s = await scanClaudeFile(file);
      if (!s) continue;
      // 仅首行等异常时也可能有内容，保留非空文件
      const project = s.cwd || decodeClaudeProject(file.split("\\").slice(-2)[0]);
      out.push({
        agent: "claude",
        id: s.id,
        title: s.customTitle || s.aiTitle || s.firstUserText || "(无标题)",
        cwd: s.cwd,
        project,
        time: fmtIso(s.ts) || mtimeStr(file),
        archived: false,
        file,
      });
    }
  }

  if (wantCodex) {
    for (const { file, archived } of codexFiles()) {
      const { meta, title } = await scanCodexFile(file);
      if (!meta) continue;
      const id: string =
        meta.id || meta.session_id || file.slice(file.lastIndexOf("-") + 1, file.lastIndexOf(".jsonl"));
      out.push({
        agent: "codex",
        id,
        title: title || "(无标题)",
        cwd: meta.cwd || "",
        project: meta.cwd || "",
        time: fmtIso(meta.timestamp) || mtimeStr(file),
        archived,
        file,
      });
    }
  }

  out.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// 读取消息
// ---------------------------------------------------------------------------

export async function readMessages(sess: AgentSession, limit?: number): Promise<SessionMessage[]> {
  if (sess.agent === "claude") return readClaudeMessages(sess.file, limit);
  return readCodexMessages(sess.file, limit);
}

function readClaudeMessages(file: string, limit?: number): Promise<SessionMessage[]> {
  return new Promise((resolve) => {
    const msgs: SessionMessage[] = [];
    let lineNo = 0;
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      lineNo += 1;
      const d = parseLine(line);
      if (!d) return;
      const t = d.type;
      if (t !== "user" && t !== "assistant") return;
      const m = d.message;
      const role = m && typeof m === "object" ? (m as any).role : t;
      if (role !== "user" && role !== "assistant") return;
      const text = textFromBlocks(m && typeof m === "object" ? (m as any).content : "");
      if (!text && role === "assistant") {
        // 保留工具调用的空文本会污染阅读，统一跳过
        return;
      }
      msgs.push({ ts: d.timestamp || "", role, text, line: lineNo });
      if (limit && msgs.length >= limit) rl.close();
    });
    rl.on("error", () => resolve(msgs));
    rl.on("close", () => resolve(msgs));
  });
}

function readCodexMessages(file: string, limit?: number): Promise<SessionMessage[]> {
  return new Promise((resolve) => {
    const msgs: SessionMessage[] = [];
    let lineNo = 0;
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      lineNo += 1;
      const d = parseLine(line);
      if (!d) return;
      if (d.type !== "response_item") return;
      const p = d.payload || {};
      if (p.type !== "message") return;
      const role = p.role;
      if (role !== "user" && role !== "assistant") return;
      const text = textFromBlocks(p.content);
      if (role === "user" && isSystemContext(text)) return;
      if (!text) return;
      msgs.push({ ts: d.timestamp || "", role, text, line: lineNo });
      if (limit && msgs.length >= limit) rl.close();
    });
    rl.on("error", () => resolve(msgs));
    rl.on("close", () => resolve(msgs));
  });
}

// ---------------------------------------------------------------------------
// 定位
// ---------------------------------------------------------------------------

/** 在会话列表中按 id / 前缀匹配（短 ID 前缀匹配），可限定 agent。 */
export function findSession(
  sessions: AgentSession[],
  idOrPrefix: string,
  agent?: AgentKind | "all"
): AgentSession | null {
  const key = idOrPrefix.trim();
  if (!key) return null;
  let pool = sessions;
  if (agent && agent !== "all") pool = sessions.filter((s) => s.agent === agent);
  for (const s of pool) if (s.id === key) return s;
  for (const s of pool) if (s.id.startsWith(key)) return s;
  return null;
}

// ---------------------------------------------------------------------------
// 详细事件读取（文本 + 工具调用摘要），detail 视图用
// ---------------------------------------------------------------------------

export type ToolKind = "edit" | "write" | "bash" | "read" | "search" | "other";

/** 工具动作：output 用 callId 回填（工具行先占位，后续 tool_result/output 到达时填充） */
export interface ToolItem {
  k: "tool";
  ts: string;
  kind: ToolKind;
  name: string; // Edit / apply_patch / exec_command …
  target: string; // 文件名或命令，供摘要显示
  hasOutput: boolean;
  output: string; // 截断后输出片段
  isError: boolean;
  /** 挂接回调，用于渲染阶段被 output 回填（内部字段，渲染勿用） */
  __fill?: (out: string, isError: boolean) => void;
}

export interface TextItem {
  k: "text";
  ts: string;
  role: "user" | "assistant";
  text: string;
}

export type DetailItem = ToolItem | TextItem;

/** 从文件名提取相对可读的末两段（路径很长时缩略） */
function shortPath(p: string): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("\\");
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function jsonBrief(v: any, n = 120): string {
  let s = "";
  try {
    s = typeof v === "string" ? v : JSON.stringify(v, null, 0);
  } catch {
    s = String(v);
  }
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** 追加一个可被 output 回填的工具行 */
function pushTool(
  items: DetailItem[],
  ts: string,
  kind: ToolKind,
  name: string,
  target: string
): { item: ToolItem; fill: (out: string, isErr: boolean) => void } {
  const item: ToolItem = { k: "tool", ts, kind, name, target, hasOutput: false, output: "", isError: false };
  const fill = (out: string, isErr: boolean) => {
    item.hasOutput = !!out;
    item.output = out.length > 400 ? out.slice(0, 399) + "…" : out;
    item.isError = isErr;
  };
  item.__fill = fill;
  items.push(item);
  return { item, fill };
}

function endAllTools(items: DetailItem[]): void {
  // 无额外动作；fill 均在 item 对象上
  void items;
}

// --- Claude：content block 拆事件 ---

function handleClaudeContentBlock(
  block: any,
  role: string,
  ts: string,
  items: DetailItem[],
  pending: Map<string, (out: string, isErr: boolean) => void>
): void {
  const bt = block?.type;
  if (bt === "tool_use") {
    const name = String(block.name || "tool");
    const input = block.input || {};
    const fp = String(input.file_path || input.path || "");
    const cmd = String(input.command || "");
    let kind: ToolKind = "other";
    let target = "";
    if (name === "Edit" || name === "Write") {
      kind = name === "Edit" ? "edit" : "write";
      target = shortPath(fp);
    } else if (name === "Bash") {
      kind = "bash";
      target = cmd.split("\n")[0].slice(0, 140);
    } else if (name === "Read") {
      kind = "read";
      target = shortPath(fp);
    } else if (name === "Glob" || name === "Grep") {
      kind = "search";
      target = (fp ? shortPath(fp) : "") + (cmd ? cmd.slice(0, 80) : "");
    } else {
      kind = "other";
      target = name + " " + jsonBrief(input);
    }
    const { fill } = pushTool(items, ts, kind, name, target);
    if (block.id) pending.set(String(block.id), fill);
  } else if (bt === "tool_result") {
    const tid = String(block.tool_use_id || "");
    const fill = pending.get(tid);
    if (fill) {
      const out = block.content;
      const text = typeof out === "string" ? out : textFromBlocks(out);
      fill(text || "", !!block.is_error);
      pending.delete(tid);
    }
  }
}

// --- Codex：response_item.payload 拆事件 ---

function handleCodexPayload(
  p: Record<string, any>,
  ts: string,
  items: DetailItem[],
  pending: Map<string, (out: string, isErr: boolean) => void>,
  byCallId: Map<string, (out: string, isErr: boolean) => void>
): void {
  const pt = p.type;
  if (pt === "function_call" || pt === "custom_tool_call") {
    const name = String(p.name || "");
    // exec_command → bash；apply_patch → edit 集合；其余 other
    let kind: ToolKind = "other";
    let target = "";
    if (pt === "function_call") {
      // arguments 可能是字符串 JSON
      let args: any = p.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = { raw: args };
        }
      }
      const cmd = String((args && (args.cmd || args.command)) || "");
      if (name === "exec_command" || cmd) {
        kind = "bash";
        target = (cmd || name).split("\n")[0].slice(0, 140);
      } else {
        kind = "other";
        target = name + " " + jsonBrief(args);
      }
    } else {
      // custom_tool_call：apply_patch 从 patch 提取文件
      const input = p.input;
      let inpText = "";
      if (typeof input === "string") inpText = input;
      else if (input && typeof input === "object") inpText = jsonBrief(input, 4000);
      const files: string[] = [];
      const re = /^\*{3}\s+(Add|Update|Delete)\s+File:\s*(.+)$/gm;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(inpText))) files.push(mm[2].trim());
      if (name === "apply_patch" || files.length) {
        kind = "edit";
        target = files.map((f) => shortPath(f)).join("、") || "apply_patch";
      } else {
        kind = "other";
        target = name + " " + (inpText ? inpText.slice(0, 140) : "");
      }
    }
    const { fill } = pushTool(items, ts, kind, name, target);
    const callId = String(p.call_id || p.id || "");
    if (callId) byCallId.set(callId, fill);
  } else if (pt === "function_call_output" || pt === "custom_tool_call_output") {
    const callId = String(p.call_id || p.id || "");
    const fill = byCallId.get(callId);
    if (fill) {
      const out = String(p.output || "");
      // 命令退出码解析错误
      const m = /(?:Exit code|Process exited with code)\s*[:=]?\s*(-?\d+)/i.exec(out);
      fill(out, m ? m[1] !== "0" : false);
      byCallId.delete(callId);
    }
  }
}

function isCodexSystemDeveloperPayload(p: Record<string, any>): boolean {
  // reasoning 跳过；message developer 跳过
  if (p.type === "reasoning") return true;
  if (p.type === "message" && (p.role === "developer" || p.role === "system")) return true;
  return false;
}

/** 详细事件读取：Claude + Codex 统一为按行顺序的 DetailItem[] */
export async function readDetailed(sess: AgentSession, limitMsgs?: number): Promise<DetailItem[]> {
  const items: DetailItem[] = [];
  let textCount = 0;
  const pending = new Map<string, (o: string, e: boolean) => void>(); // claude tool_use_id
  const byCallId = new Map<string, (o: string, e: boolean) => void>(); // codex call_id

  const lineIter = createInterface({
    input: createReadStream(sess.file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  const done = new Promise<void>((res) => {
    lineIter.on("line", (line) => {
      const d = parseLine(line);
      if (!d) return;
      const ts = String(d.timestamp || d.t || "");
      if (sess.agent === "claude") {
        const t = d.type;
        if (t !== "user" && t !== "assistant") return;
        const m = d.message;
        const role = m && typeof m === "object" ? (m as any).role : t;
        if (role !== "user" && role !== "assistant") return;
        const content = m && typeof m === "object" ? (m as any).content : [];
        const c = Array.isArray(content) ? content : [content];
        for (const block of c) {
          if (!block || typeof block !== "object") continue;
          const bt = block.type;
          if (bt === "thinking") continue; // thinking 不展示
          if (bt === "text" || bt === "input_text" || bt === "output_text") {
            const txt = String(block.text || "").trim();
            if (!txt) continue;
            if (role === "user" && isSystemContext(txt)) continue;
            items.push({ k: "text", ts, role, text: txt });
            textCount += 1;
          } else if (bt === "tool_use" || bt === "tool_result") {
            handleClaudeContentBlock(block, role, ts, items, pending);
          } // image 等忽略
        }
      } else {
        if (d.type !== "response_item") return;
        const p = (d.payload || {}) as Record<string, any>;
        if (isCodexSystemDeveloperPayload(p)) return;
        if (p.type === "message") {
          const role = p.role;
          if (role !== "user" && role !== "assistant") return;
          const c = Array.isArray(p.content) ? p.content : [];
          for (const block of c) {
            if (!block || typeof block !== "object") continue;
            const bt = block.type;
            if (bt === "input_text" || bt === "output_text") {
              const txt = String(block.text || "").trim();
              if (!txt) continue;
              if (role === "user" && isSystemContext(txt)) continue;
              items.push({ k: "text", ts, role, text: txt });
              textCount += 1;
            }
          }
        } else if (p.type === "function_call" || p.type === "function_call_output" ||
                   p.type === "custom_tool_call" || p.type === "custom_tool_call_output") {
          handleCodexPayload(p, ts, items, pending, byCallId);
        }
      }
      if (limitMsgs && textCount >= limitMsgs) lineIter.close();
    });
    lineIter.on("error", () => res());
    lineIter.on("close", () => res());
  });
  await done;
  endAllTools(items);
  return items;
}

/** 渲染 detail 文本：文本行 + 缩进工具摘要行（Codex / Claude 通用） */
export function formatDetailed(items: DetailItem[], maxMsgLen: number): string {
  const lines: string[] = [];
  for (const it of items) {
    if (it.k === "text") {
      const who = it.role === "user" ? "👤 用户" : "🤖 助手";
      const stamp = (it.ts || "").slice(11, 19);
      lines.push(`\n--- ${who} ${stamp} ---`);
      lines.push(truncateSafe(it.text, maxMsgLen));
    } else {
      const icon =
        it.kind === "edit" ? "✏️ 编辑" :
        it.kind === "write" ? "📝 写入" :
        it.kind === "bash" ? "$ 执行" :
        it.kind === "read" ? "📖 读取" :
        it.kind === "search" ? "🔍 检索" : "🛠 工具";
      lines.push(`   ${icon} ${it.name} ${it.target}`.trimEnd());
      if (it.hasOutput) {
        const flag = it.isError ? " ⚠️错误" : "";
        const out1 = it.output.split("\n")[0];
        const brief = out1.length > 180 ? out1.slice(0, 179) + "…" : out1;
        lines.push(`      ↳ ${brief}${flag}`);
      }
    }
  }
  return lines.join("\n");
}

function truncateSafe(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
