/**
 * 会话语义标注（仿 /insights 的 facets 层）
 *
 * 对每个主要会话,调用 one-hub deepseek-v4-flash 判断:做了什么/目标类别/
 * 会话类型/满意度/摩擦点/成功点,落盘 reports/facets/<agent>/<id>.json(缓存)。
 * 数据源复用 insights.ts(硬统计+消息)。
 *
 * 两种用法：
 *   - CLI   : node <tsx> annotate.ts [--agent claude|codex] [--limit N] [--force] [--dry-run]
 *   - 模块  : import { annotate, renderAnnotateResult } from "./annotate.js"（MCP 工具用）
 *
 * 注意：agent 维度已贯穿；facets 按 agent 分目录（reports/facets/<agent>/），
 * 两个 agent 的标注不会互相污染。
 */
import { fileURLToPath } from "node:url";
import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { buildInsightReport, InsightReport } from "./insights.js";
import { readMessages, listSessions, findSession } from "./sessions.js";

export type AgentKind = "claude" | "codex";

const MODEL = "deepseek-v4-flash";
const CONCURRENCY = 4;
const MAX_ANNOTATE = 22;

/** 输出根目录钉在模块所在目录（不随 cwd 变），与 aram-mayhem 的 lib/report-md.ts 同款做法 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const REPORTS_DIR = join(ROOT, "reports");

/** facets 目录按 agent 分：reports/facets/<agent>/ */
function facetsDir(agent: AgentKind): string {
  return join(REPORTS_DIR, "facets", agent);
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
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const last = cleaned.lastIndexOf("}");
    if (last > 0) {
      try {
        return JSON.parse(cleaned.slice(0, last + 1));
      } catch {
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

/**
 * 挑出值得标注的主要会话（剔除纯测试/超短），按 token 降序取前 MAX 个。
 *
 * ⚠ 这套启发式是按 Codex 的口味调的；对 Claude 会话「仍可用但会漏」：
 *   - testTitles 是 Codex 场景观察来的，Claude 的测试会话可能叫别的问候语；
 *   - `msgCount<3 且 token<30万` 里那个 30 万是 Codex 的量级，Claude 常含大量缓存 token，
 *     所以可能少剔掉几个占位会话（代价是多标注几个，几分钱）。
 * 有意保持现状：为这点精度加复杂度不划算。
 */
function pickSessions(r: InsightReport) {
  const testTitles = new Set(["1", "echo hello", "你是？", "你好", "", "(无标题)"]);
  const isTest = (s: any) => {
    const t = String(s.title || "").trim();
    if (testTitles.has(t)) return true;
    if ((s.msgCount || 0) < 3 && (s.totalTokens || 0) < 300000) return true;
    return false;
  };
  const keep = r.sessions.filter((s: any) => !isTest(s));
  return keep.sort((a: any, b: any) => (b.totalTokens || 0) - (a.totalTokens || 0)).slice(0, MAX_ANNOTATE);
}

export interface AnnotateOptions {
  /** 缺省 codex（向后兼容） */
  agent?: AgentKind;
  /** 本次最多标注几个会话，缺省 22 */
  limit?: number;
  /** true = 忽略缓存重新标注（默认增量跳过已有 facets） */
  force?: boolean;
  /** true = 只盘点不调 LLM，不花钱 */
  dryRun?: boolean;
  concurrency?: number;
  /** 日志去向；缺省写 stderr（MCP 场景下 stdout 是 JSON-RPC，绝不能写） */
  onLog?: (line: string) => void;
}

export interface AnnotateResult {
  agent: AgentKind;
  picked: number;
  pending: number;
  annotated: number;
  failed: number;
  cached: number;
  dryRun: boolean;
  facetsDir: string;
  errors: { id: string; message: string }[];
}

/** 给主要会话做 LLM 语义标注。增量：已存在的 facets 默认跳过。 */
export async function annotate(opts: AnnotateOptions = {}): Promise<AnnotateResult> {
  const agent: AgentKind = opts.agent === "claude" ? "claude" : "codex";
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : MAX_ANNOTATE;
  const concurrency = opts.concurrency && opts.concurrency > 0 ? Math.floor(opts.concurrency) : CONCURRENCY;
  const log = opts.onLog || ((line: string) => process.stderr.write(line + "\n"));
  const dir = facetsDir(agent);

  const cfg = getApiConfig();
  if (!cfg.apiKey) throw new Error("未找到 one-hub key（需 code-review env 的 REVIEW_API_KEY 或环境变量）");

  const r = await buildInsightReport({ agent, days: 9999, limit: 400 });
  const all = await listSessions(agent);
  const picked = pickSessions(r).slice(0, limit);

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
    const rec = findSession(all, s.id, agent);
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

  const isCached = (f: FacetInput) => !opts.force && existsSync(join(dir, f.session_id + ".json"));
  const todo = withMsgs.filter((f) => !isCached(f));
  const cached = withMsgs.length - todo.length;
  log(`[${agent}] 待标注会话: ${withMsgs.length} 个，需新标注: ${todo.length} 个（缓存 ${cached}）`);

  const result: AnnotateResult = {
    agent,
    picked: withMsgs.length,
    pending: todo.length,
    annotated: 0,
    failed: 0,
    cached,
    dryRun: !!opts.dryRun,
    facetsDir: dir,
    errors: [],
  };
  if (opts.dryRun) return result;

  mkdirSync(dir, { recursive: true });
  const runOne = async (f: FacetInput) => {
    try {
      const facet = await callAnnotate(f, cfg);
      facet.session_id = f.session_id;
      writeFileSync(join(dir, f.session_id + ".json"), JSON.stringify(facet, null, 2), "utf-8");
      result.annotated += 1;
    } catch (e: any) {
      result.failed += 1;
      result.errors.push({ id: f.session_id, message: e.message });
      log(`✗ ${f.session_id.slice(0, 8)} 标注失败: ${e.message}`);
    }
  };
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const f = queue.shift()!;
      await runOne(f);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, () => worker());
  await Promise.all(workers);
  log(`[${agent}] 标注完成: 成功 ${result.annotated}, 失败 ${result.failed}, 缓存 ${cached}`);
  return result;
}

/** 把结果渲染成给模型/人看的中文摘要（MCP 工具返回用） */
export function renderAnnotateResult(r: AnnotateResult): string {
  const head = `会话语义标注（agent=${r.agent}）`;
  const line = `候选 ${r.picked} 个 ｜ 本次标注 ${r.annotated} ｜ 失败 ${r.failed} ｜ 命中缓存 ${r.cached}`;
  const dir = `facets 目录: ${r.facetsDir}`;
  if (r.dryRun) {
    return `${head}\n${line}\n${dir}\n（dry_run=true：只盘点，未调用任何模型，未花钱）`;
  }
  const errs = r.errors.length
    ? "\n失败明细:\n" + r.errors.slice(0, 10).map((e) => `  · ${e.id.slice(0, 8)}: ${e.message}`).join("\n")
    : "";
  return `${head}\n${line}\n${dir}\n（增量：已标注过的会话自动跳过。要重新标注用 force=true）${errs}`;
}

// ---------------------------------------------------------------------------
// CLI 入口：只有「直接运行本文件」时才执行（被 import 时不执行）
// ---------------------------------------------------------------------------
const invokedDirectly =
  process.argv[1] && /annotate\.(ts|js|mjs)$/.test(process.argv[1].replace(/\\/g, "/"));

if (invokedDirectly) {
  const has = (f: string) => process.argv.includes(f);
  const val = (f: string) => {
    const i = process.argv.indexOf(f);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const agentArg = val("--agent") === "claude" ? "claude" : "codex";
  const limitArg = val("--limit") ? Number(val("--limit")) : undefined;
  annotate({
    agent: agentArg,
    limit: limitArg,
    force: has("--force"),
    dryRun: has("--dry-run"),
    onLog: (l) => console.log(l),
  })
    .then((r) => console.log(renderAnnotateResult(r)))
    .catch((e) => {
      console.error("ERR", e.message);
      process.exit(1);
    });
}
