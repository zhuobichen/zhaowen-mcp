/**
 * Codex 会话深层统计（仿 /insights 图表数据源）
 *
 * 对 rollout 文件单趟流式扫描，提取 /insights 同款的"硬统计"特征：
 *   - 命令执行：次数 / 失败次数（exit code 非 0）/ 命令名分布
 *   - 文件改动：apply_patch 的 Add/Update/Delete 次数、改动文件、语言分布（扩展名）
 *   - 工具分布：custom_tool_call / function_call 归类
 *   - 活跃时长：首末时间戳跨度
 *
 * 只对 Codex 生效（Claude jsonl 无 apply_patch/exec_command 结构，已由既有 detail 覆盖）。
 */
import { createReadStream } from "fs";
import { createInterface } from "readline";
import {
  AgentKind,
  AgentSession,
  listSessions,
} from "./sessions.js";

export interface DeepStat {
  id: string;
  time: string;
  commands: number;
  commandFails: number;
  filesChanged: number; // apply_patch 里的文件操作数
  fileOps: { add: number; update: number; del: number };
  languages: Record<string, number>; // 扩展名 -> 文件数
  tools: Record<string, number>; // 工具名 -> 次数
  spanMin: number | null;
}

const LANG_MAP: Record<string, string> = {
  py: "Python", ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  md: "Markdown", json: "JSON", html: "HTML", css: "CSS", csharp: "C#", cs: "C#",
  xlsx: "Excel", docx: "Word", pptx: "PPT", yml: "YAML", yaml: "YAML", sql: "SQL",
  sh: "Shell", bash: "Shell", txt: "Text", xml: "XML", csv: "CSV",
};

function parseLine(line: string): Record<string, any> | null {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function emptyStat(id: string, time: string): DeepStat {
  return {
    id, time,
    commands: 0, commandFails: 0, filesChanged: 0,
    fileOps: { add: 0, update: 0, del: 0 },
    languages: {},
    tools: {},
    spanMin: null,
  };
}

function extLang(filePath: string): string | null {
  // 去掉 query/hash 与引号
  const f = filePath.trim().replace(/^['"]|['"]$/g, "").split(/[?#]/)[0];
  const i = f.lastIndexOf(".");
  if (i < 0) return null;
  const ext = f.slice(i + 1).toLowerCase();
  if (!/^[a-z0-9]+$/.test(ext) || ext.length > 6) return null;
  return LANG_MAP[ext] || (ext === "ipynb" ? "Notebook" : ext.toUpperCase());
}

function scanOne(sess: AgentSession): Promise<DeepStat> {
  const st = emptyStat(sess.id, sess.time);
  let t0: number | null = null;
  let t1: number | null = null;
  const tsOf = (ts?: string) => {
    if (!ts) return null;
    const t = Date.parse(ts);
    return isNaN(t) ? null : t;
  };

  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(sess.file, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      const d = parseLine(line);
      if (!d) return;
      const ts = tsOf(d.timestamp);
      if (ts !== null) {
        if (t0 === null || ts < t0) t0 = ts;
        if (t1 === null || ts > t1) t1 = ts;
      }
      if (d.type !== "response_item") return;
      const p = d.payload || {};
      const pt = p.type;
      if (pt === "custom_tool_call") {
        const name = String(p.name || "custom");
        st.tools[name] = (st.tools[name] || 0) + 1;
        if (name === "apply_patch") {
          // 从 patch 文本提取文件操作
          const input = p.input;
          const txt = typeof input === "string" ? input : "";
          const re = /^\*{3}\s+(Add|Update|Delete)\s+File:\s*(.+)$/gm;
          let m: RegExpExecArray | null;
          while ((m = re.exec(txt))) {
            const op = m[1];
            const path = m[2].trim();
            if (op === "Add") st.fileOps.add += 1;
            else if (op === "Update") st.fileOps.update += 1;
            else if (op === "Delete") st.fileOps.del += 1;
            st.filesChanged += 1;
            const lang = extLang(path);
            if (lang) st.languages[lang] = (st.languages[lang] || 0) + 1;
          }
        }
      } else if (pt === "function_call") {
        const name = String(p.name || "fn");
        if (name === "exec_command") {
          st.commands += 1;
        } else {
          st.tools[name] = (st.tools[name] || 0) + 1;
        }
      } else if (pt === "function_call_output") {
        // exit code 判断命令失败
        const out = String(p.output || "");
        const m = /Process exited with code\s*(-?\d+)/.exec(out);
        if (m && m[1] !== "0") st.commandFails += 1;
      }
    });
    rl.on("error", () => resolve(st));
    rl.on("close", () => {
      if (t0 !== null && t1 !== null) {
        st.spanMin = Math.max(0, Math.round((t1 - t0) / 60000));
      }
      resolve(st);
    });
  });
}

export async function deepStats(agent?: AgentKind | "all"): Promise<DeepStat[]> {
  const wantCodex = !agent || agent === "all" || agent === "codex";
  const sessions = await listSessions(wantCodex ? "codex" : agent);
  const out: DeepStat[] = [];
  for (const s of sessions) {
    try {
      out.push(await scanOne(s));
    } catch {
      // 单会话失败跳过
    }
  }
  out.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return out;
}

/** 聚合：语言分布 / 命令统计 / 文件操作 */
export function aggregateDeep(stats: DeepStat[]) {
  let commands = 0;
  let commandFails = 0;
  let filesChanged = 0;
  const fileOps = { add: 0, update: 0, del: 0 };
  const tools: Record<string, number> = {};
  for (const s of stats) {
    commands += s.commands;
    commandFails += s.commandFails;
    filesChanged += s.filesChanged;
    fileOps.add += s.fileOps.add;
    fileOps.update += s.fileOps.update;
    fileOps.del += s.fileOps.del;
    for (const [k, v] of Object.entries(s.tools)) tools[k] = (tools[k] || 0) + v;
  }
  return { commands, commandFails, filesChanged, fileOps, tools };
}
