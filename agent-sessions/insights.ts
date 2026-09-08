/**
 * 会话洞察聚合（仿 Claude Code /insights 的数据层，供调用方模型生成总结建议）
 *
 * 思路：/insights 的实质 = 读会话日志 → 提取结构化特征 → 由 LLM 归纳成总结/建议。
 * 本模块负责前半段：把指定范围内每个会话压成一行结构化特征（项目/时间/时长/消息数/
 * 工具使用/token/标题），并给出聚合统计。真正的「总结+建议」由调用方的模型完成，
 * 因此对 Claude Code 与 Codex 会话都适用（/insights 只读 ~/.claude/projects，读不了 Codex）。
 */

import {
  AgentKind,
  AgentSession,
  listSessions,
  readMessages,
  readDetailed,
  tokenUsageStats,
} from "./sessions.js";

export interface InsightOptions {
  agent?: AgentKind | "all";
  project?: string; // cwd 子串过滤
  days?: number; // 只看最近 N 天（按 time 字符串，YYYY-MM-DD HH:MM）
  limit?: number; // 最多返回会话数
}

interface ToolCount {
  edit: number;
  write: number;
  bash: number;
  read: number;
  other: number;
}

export interface SessionInsight {
  agent: AgentKind;
  id: string;
  time: string;
  project: string;
  title: string;
  msgCount: number;
  tools: ToolCount;
  totalTokens: number | null; // null = 该会话无 token 记录
  // 活跃跨度估算：拿最早/最晚消息的 ts 差（仅当可解析）；null 表示不可用
  spanMin: number | null;
}

export interface InsightReport {
  range: string;
  agent: AgentKind | "all";
  count: number;
  dateStart: string;
  dateEnd: string;
  projects: Record<string, number>; // 项目名 -> 会话数
  toolTotals: ToolCount;
  msgTotal: number;
  tokenTotal: number;
  withTokenSessions: number;
  sessions: SessionInsight[];
}

function emptyTools(): ToolCount {
  return { edit: 0, write: 0, bash: 0, read: 0, other: 0 };
}

function addTools(a: ToolCount, b: ToolCount) {
  a.edit += b.edit;
  a.write += b.write;
  a.bash += b.bash;
  a.read += b.read;
  a.other += b.other;
}

/** "YYYY-MM-DD HH:MM" -> Date；失败 null */
function parseTime(s: string): Date | null {
  if (!s || s.length < 16) return null;
  const d = new Date(s.slice(0, 16).replace(" ", "T") + ":00");
  return isNaN(d.getTime()) ? null : d;
}

function spanMinutes(events: { ts: string }[]): number | null {
  const times = events.map((e) => parseTime(e.ts)).filter(Boolean) as Date[];
  if (times.length < 2) return null;
  times.sort((a, b) => a.getTime() - b.getTime());
  return Math.round((times[times.length - 1].getTime() - times[0].getTime()) / 60000);
}

/** 从 DetailItem 统计工具使用（TextItem 无工具） */
function toolsFromDetailed(items: { k: string; kind?: string }[]): ToolCount {
  const t = emptyTools();
  for (const it of items) {
    if (it.k !== "tool") continue;
    const kind = it.kind || "other";
    if (kind === "edit") t.edit += 1;
    else if (kind === "write") t.write += 1;
    else if (kind === "bash") t.bash += 1;
    else if (kind === "read") t.read += 1;
    else t.other += 1;
  }
  return t;
}

/**
 * 检测会话：用 readDetailed 读会话前部事件（cap 即止），得到消息数、前部工具使用与 span。
 * 只覆盖会话早期事件；长会话的后续部分不计入（避免全文件扫描），对排序/主题归纳足够。
 */
const INSPECT_CAP = 150;

async function inspectSession(
  sess: AgentSession,
  _withToken: boolean
): Promise<{ msgCount: number; tools: ToolCount; spanMin: number | null; totalTokens: number | null }> {
  let msgCount = 0;
  let tools = emptyTools();
  let spanMin: number | null = null;
  try {
    const items = await readDetailed(sess, INSPECT_CAP);
    for (const it of items) {
      if (it.k === "text") msgCount += 1;
    }
    tools = toolsFromDetailed(items);
    spanMin = spanMinutes(items as { ts: string }[]);
  } catch {
    // ignore
  }
  return { msgCount, tools, spanMin, totalTokens: null };
}

/** 生成洞察报告 */
export async function buildInsightReport(opts: InsightOptions = {}): Promise<InsightReport> {
  const agent = opts.agent || "all";
  const project = (opts.project || "").toLowerCase().trim();
  const days = opts.days && opts.days > 0 ? opts.days : 30;
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 30;
  const withToken = true; // token 统计现已在 sessions.ts 覆盖老会话

  const sessions = await listSessions(agent);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let filtered = sessions.filter((s) => {
    if (project && !(s.project || "").toLowerCase().includes(project)) return false;
    const d = parseTime(s.time);
    if (d && d < cutoff) return false;
    return true;
  });

  // 按时间倒序
  filtered.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

  // Codex 同一 session 可能跨多个 rollout 文件 → 按 id 合并（取最新时间、最长标题），token 在下方按 id 汇总
  const byId = new Map<string, AgentSession>();
  for (const s of filtered) {
    const prev = byId.get(s.id);
    if (!prev || s.time > prev.time) byId.set(s.id, s);
  }
  const dedup = Array.from(byId.values()).sort((a, b) =>
    a.time < b.time ? 1 : a.time > b.time ? -1 : 0
  );
  const selected = dedup.slice(0, limit);

  // token 全量统计（一次调用即可，供聚合）
  const tokenMap = new Map<string, number>();
  if (withToken) {
    try {
      const all = await tokenUsageStats(agent);
      for (const st of all) if (st.hasUsage) tokenMap.set(st.session.id, st.total_tokens);
    } catch {
      // ignore
    }
  }

  const sessionsInsight: SessionInsight[] = [];
  const toolTotals = emptyTools();
  let msgTotal = 0;
  let tokenTotal = 0;
  let withTokenSessions = 0;
  const projects: Record<string, number> = {};

  for (const s of selected) {
    const { msgCount, tools, spanMin, totalTokens } = await inspectSession(s, withToken);
    const tk = totalTokens !== null ? totalTokens : tokenMap.get(s.id) ?? null;
    if (tk !== null) {
      tokenTotal += tk;
      withTokenSessions += 1;
    }
    msgTotal += msgCount;
    addTools(toolTotals, tools);
    const proj = s.project || "(无项目)";
    projects[proj] = (projects[proj] || 0) + 1;
    sessionsInsight.push({
      agent: s.agent,
      id: s.id,
      time: s.time,
      project: proj,
      title: s.title,
      msgCount,
      tools,
      totalTokens: tk,
      spanMin,
    });
  }

  const dates = sessionsInsight.map((s) => parseTime(s.time)).filter(Boolean) as Date[];
  dates.sort((a, b) => a.getTime() - b.getTime());

  const rangeDesc =
    agent === "all" ? "Claude Code + Codex" : agent;
  return {
    range: rangeDesc + (project ? ` · 项目含 "${project}"` : "") + ` · 最近 ${days} 天 · 最多 ${limit} 会话`,
    agent,
    count: sessionsInsight.length,
    dateStart: dates.length ? dates[0].toISOString().slice(0, 10) : "",
    dateEnd: dates.length ? dates[dates.length - 1].toISOString().slice(0, 10) : "",
    projects,
    toolTotals,
    msgTotal,
    tokenTotal,
    withTokenSessions,
    sessions: sessionsInsight,
  };
}

/** 渲染成给模型的简洁文本（含概览 + 逐会话一行） */
export function renderInsightReport(r: InsightReport): string {
  const lines: string[] = [];
  lines.push(`# 会话洞察 · ${r.range}`);
  lines.push(`- 会话数: ${r.count} · 时间 ${r.dateStart || "?"} ~ ${r.dateEnd || "?"}`);
  lines.push(
    `- token 合计: ${r.tokenTotal.toLocaleString()} (${r.withTokenSessions}/${r.count} 会话有记录)` +
      ` · 消息合计: ${r.msgTotal}`
  );
  lines.push(`- 工具调用: ✏️${r.toolTotals.edit} 📝${r.toolTotals.write} $${r.toolTotals.bash} 📖${r.toolTotals.read} 其他${r.toolTotals.other}`);
  const projDesc = Object.entries(r.projects)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p}×${n}`)
    .join("、");
  lines.push(`- 项目分布: ${projDesc || "(无)"}`);
  lines.push("");

  // 逐会话
  const clamp = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");
  for (const s of r.sessions) {
    const src = s.agent === "claude" ? "C" : "X";
    const span = s.spanMin !== null ? ` ~${Math.max(1, Math.round(s.spanMin))}min` : "";
    const tok = s.totalTokens !== null ? ` · ${s.totalTokens.toLocaleString()}tok` : "";
    lines.push(
      `## [${src}] ${s.time} ${s.id.slice(0, 8)} · ${s.project}${span}${tok}`
    );
    if (s.title) lines.push(`标题: ${clamp(s.title.replace(/\n/g, " "), 150)}`);
    lines.push(
      `消息 ${s.msgCount} · 工具 ✏️${s.tools.edit} 📝${s.tools.write} $${s.tools.bash} 📖${s.tools.read} 其他${s.tools.other}`
    );
    lines.push("");
  }
  lines.push("—— 以上为结构化原始材料，请据此归纳工作主题、摩擦点并给出改进建议 ——");
  return lines.join("\n");
}
