/**
 * Codex 会话语义标注（仿 /insights 的 facets 层）
 *
 * 对每个主要 Codex 会话,调用 one-hub deepseek-v4-flash 判断:做了什么/目标类别/
 * 会话类型/满意度/摩擦点/成功点,产出去 reports/facets/<id>.json(落盘缓存)。
 * 数据源复用 insights.ts(硬统计+消息)。
 *
 * 用法: node <tsx> annotate.ts
 */
import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { buildInsightReport, InsightReport } from "./insights.js";
import { readMessages, listSessions, findSession } from "./sessions.js";

const MODEL = "deepseek-v4-flash";
const CONCURRENCY = 4;
const REPORTS_DIR = join(process.cwd(), "reports");

/** 从 argv 解析 --agent claude|codex,缺省 codex(向后兼容) */
function parseAgentArg(): "claude" | "codex" {
  const i = process.argv.indexOf("--agent");
  const v = i >= 0 ? process.argv[i + 1] : "codex";
  return v === "claude" ? "claude" : "codex";
}
function facetsDir(_agent: "claude" | "codex"): string {
  // 统一目录 reports/facets（与 gen_report.ts 的 FACETS_DIR 一致）
  return join(REPORTS_DIR, "facets");
}

interface ApiConfig {
  apiKey: string;
  apiUrl: string;
}

/** 从 ~/.claude.json 读 code-review env(避免硬编码 key);env 变量优先 */
function getApiConfig(): ApiConfig {
  const envKey = process.env.REVIEW_API_KEY;
  const envUrl = process.env.REVIEW_API_URL;
  if (envKey) return { apiKey: envKey, apiUrl: (envUrl || "https://one-hub.hycx-gd.cn/v1").replace(/\/$/, "") };
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf-8"));
    const e = cfg.mcpServers?.["code-review"]?.env || {};
    return {
      apiKey: e.REVIEW_API_KEY || e.VISION_API_KEY || "",
      apiUrl: (e.REVIEW_API_URL || e.VISION_API_URL || "https://one-hub.hycx-gd.cn/v1").replace(/\/$/, ""),
    };
  } catch {
    return { apiKey: "", apiUrl: "https://one-hub.hycx-gd.cn/v1" };
  }
}

const SYSTEM_PROMPT = `你是会话复盘分析师。分析用户提供的"智能体会话(Claude Code / Codex)"信息(标题/用户提问/硬统计),判断这次会话:目标、类型、结果、用户满意度、摩擦点。
严格只输出 JSON(不要 markdown 代码块),字段如下:
{
  "session_id": "完整会话id",
  "underlying_goal": "一句话:用户这次想达成什么",
  "goal_categories": {"类别名": 1},
  "outcome": "mostly_achieved | fully_achieved | partially_achieved | not_achieved",
  "session_type": "single_task | multi_task",
  "user_satisfaction_counts": {"likely_satisfied":1} | {"dissatisfied":1} | {"satisfied":1},
  "claude_helpfulness": "very_helpful | helpful | neutral | unhelpful",
  "friction_counts": {"buggy_code":1} 或 {"user_rejected_action":1} 或 {"scope_drift":1} 或 {} (无摩擦),
  "friction_detail": "如有摩擦,1-2句描述发生了什么;无则空串",
  "primary_success": "good_debugging | proactive_help | correct_code_edits | multi_file_changes | fast_search | none",
  "brief_summary": "3-4句中文:这次会话具体做了什么、进展、结果"
}`;

interface FacetInput {
  session_id: string;
  title: string;
  time: string;
  msgCount: number;
  totalTokens: number | null;
  firstUser: string[];
  lastUser: string[];
  commands: number;
  commandFails: number;
  filesChanged: number;
}

function esc(s: string): string {
  return String(s ?? "").slice(0, 600);
}

function buildUserPrompt(f: FacetInput): string {
  const head = [
    `会话ID: ${f.session_id}`,
    `时间: ${f.time}`,
    `标题: ${f.title.slice(0, 200)}`,
    `消息数: ${f.msgCount}`,
    `token: ${f.totalTokens ? f.totalTokens.toLocaleString() : "无记录"}`,
    `命令: ${f.commands} 次 (失败 ${f.commandFails})`,
    `文件改动: ${f.filesChanged} 次`,
  ].join("\n");
  const headOf = (arr: string[], n: number) => (arr.length ? arr.slice(0, n).join("\n\n").slice(0, 1200) : "(无)");
  return `【会话硬统计】\n${head}\n\n【会话开头用户的请求】\n${headOf(f.firstUser, 3)}\n\n【会话结尾用户的消息】\n${headOf(f.lastUser, 2)}\n\n请据此输出 JSON 标注。`;
}

/** 尝试解析模型 JSON,容忍被截断:截到最后一个完整 } */
function safeParse(raw: string): Record<string, any> {
  let cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // 截到最后一个 '}' 再试
    const last = cleaned.lastIndexOf("}");
    if (last > 0) {
      try {
        return JSON.parse(cleaned.slice(0, last + 1));
      } catch {
        // 再试:括号配平法——取 {..} 完整块
        const start = cleaned.indexOf("{");
        if (start >= 0) {
          const sub = cleaned.slice(start);
          let depth = 0;
          for (let i = 0; i < sub.length; i++) {
            if (sub[i] === "{") depth++;
            else if (sub[i] === "}") {
              depth--;
              if (depth === 0) {
                try {
                  return JSON.parse(sub.slice(0, i + 1));
                } catch {
                  break;
                }
              }
            }
          }
        }
      }
    }
    throw new Error("JSON 解析失败: " + raw.slice(0, 120));
  }
}

/** 调 one-hub 标注一个会话(失败重试 1 次) */
async function callAnnotate(f: FacetInput, cfg: ApiConfig): Promise<Record<string, any>> {
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(cfg.apiUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(f) },
        ],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`标注 API ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = (await resp.json()) as any;
    const content = (data?.choices?.[0]?.message?.content || "").trim();
    if (!content) {
      lastErr = new Error("空返回");
      continue;
    }
    try {
      return safeParse(content);
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("标注失败");
}

/** 挑出值得标注的主要会话（剔除纯测试/超短），按 token 降序取前 MAX 个 */
const MAX_ANNOTATE = 22;

function pickSessions(r: InsightReport) {
  const testTitles = new Set(["1", "echo hello", "你是？", "你好", "", "(无标题)"]);
  const isTest = (s: any) => {
    const t = String(s.title || "").trim();
    if (testTitles.has(t)) return true;
    // 超短且无 token 的占位会话
    if ((s.msgCount || 0) < 3 && (s.totalTokens || 0) < 300000) return true;
    return false;
  };
  const keep = r.sessions.filter((s: any) => !isTest(s));
  return keep.sort((a: any, b: any) => (b.totalTokens || 0) - (a.totalTokens || 0)).slice(0, MAX_ANNOTATE);
}

async function run() {
  const cfg = getApiConfig();
  if (!cfg.apiKey) throw new Error("未找到 one-hub key(需 code-review env 的 REVIEW_API_KEY 或环境变量)");
  mkdirSync(facetsDir("codex"), { recursive: true });

  const r = await buildInsightReport({ agent: "codex", days: 9999, limit: 400 });
  const all = await listSessions("codex");
  const picked = pickSessions(r);

  // 读每会话的首/尾用户消息（供标注 prompt）
  const withMsgs: FacetInput[] = [];
  for (const s of picked) {
    const f: FacetInput = {
      session_id: s.id,
      title: s.title,
      time: s.time,
      msgCount: s.msgCount,
      totalTokens: s.totalTokens,
      firstUser: [],
      lastUser: [],
      commands: 0,
      commandFails: 0,
      filesChanged: 0,
    };
    const rec = findSession(all, s.id, "codex");
    if (rec) {
      try {
        const msgs = await readMessages(rec, 60);
        const userMsgs = msgs
          .filter((m) => m.role === "user")
          .map((m) => m.text)
          .filter((t) => !/^\s*(# Files mentioned|继续\s*$|<image)/.test(t));
        f.firstUser = userMsgs.slice(0, 5);
        f.lastUser = userMsgs.slice(-4);
      } catch {
        // 读失败也标注（仅用统计）
      }
    }
    withMsgs.push(f);
  }

  console.log(`待标注会话: ${withMsgs.length} 个`);
  // 并发
  const todo = withMsgs.filter((f) => !existsSync(join(facetsDir("codex"), f.session_id + ".json")));
  console.log(`需新标注(未缓存): ${todo.length} 个`);
  let done = 0;
  let fail = 0;
  const runOne = async (f: FacetInput) => {
    const outPath = join(facetsDir("codex"), f.session_id + ".json");
    try {
      const facet = await callAnnotate(f, cfg);
      facet.session_id = f.session_id;
      writeFileSync(outPath, JSON.stringify(facet, null, 2), "utf-8");
      done += 1;
    } catch (e: any) {
      fail += 1;
      console.error(`✗ ${f.session_id.slice(0, 8)} 标注失败: ${e.message}`);
    }
  };
  // 简单并发池
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const f = queue.shift()!;
      await runOne(f);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(1, queue.length)) }, () => worker());
  await Promise.all(workers);
  console.log(`标注完成: 成功 ${done}, 失败 ${fail}, 缓存 ${withMsgs.length - todo.length}`);
}

run().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
