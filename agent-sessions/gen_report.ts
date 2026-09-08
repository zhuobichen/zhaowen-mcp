/**
 * 生成 Codex 会话洞察中文 HTML 报告 —— 版式复刻 Claude Code /insights 官方报告
 *
 * 数据层 = insights.ts（真实 Codex 会话/token/工具统计）；叙事文案基于真实会话归纳。
 * 用法: node <tsx> gen_report.ts [输出路径]
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildInsightReport } from "./insights.js";
import { deepStats } from "./deep_insights.js";

const outPath = process.argv[2] || join(process.cwd(), "reports", "codex_report.html");
const FACETS_DIR = join(process.cwd(), "reports", "facets");

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, " ");

/* 官方 /insights CSS（浅色主题） */
const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #334155; line-height: 1.65; padding: 48px 24px; }
.container { max-width: 800px; margin: 0 auto; }
h1 { font-size: 32px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
h2 { font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 48px; margin-bottom: 16px; }
.subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
.nav-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 32px 0; padding: 16px; background: white; border-radius: 8px; border: 1px solid #e2e8f0; }
.nav-toc a { font-size: 12px; color: #64748b; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: #f1f5f9; transition: all 0.15s; }
.nav-toc a:hover { background: #e2e8f0; color: #334155; }
.stats-row { display: flex; gap: 24px; margin-bottom: 40px; padding: 20px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
.stat { text-align: center; }
.stat-value { font-size: 24px; font-weight: 700; color: #0f172a; }
.stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
.at-a-glance { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
.glance-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 16px; }
.glance-sections { display: flex; flex-direction: column; gap: 12px; }
.glance-section { font-size: 14px; color: #78350f; line-height: 1.6; }
.glance-section strong { color: #92400e; }
.see-more { color: #b45309; text-decoration: none; font-size: 13px; white-space: nowrap; }
.see-more:hover { text-decoration: underline; }
.narrative { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
.narrative p { margin-bottom: 12px; font-size: 14px; color: #475569; line-height: 1.7; }
.key-insight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin-top: 12px; font-size: 14px; color: #166534; }
.section-intro { font-size: 14px; color: #64748b; margin-bottom: 16px; }
.big-wins { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.big-win { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; }
.big-win-title { font-weight: 600; font-size: 15px; color: #166534; margin-bottom: 8px; }
.big-win-desc { font-size: 14px; color: #15803d; line-height: 1.5; }
.project-areas { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.project-area { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
.area-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.area-name { font-weight: 600; font-size: 15px; color: #0f172a; }
.area-count { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; }
.area-desc { font-size: 14px; color: #475569; line-height: 1.5; }
.friction-categories { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
.friction-category { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; }
.friction-title { font-weight: 600; font-size: 15px; color: #991b1b; margin-bottom: 6px; }
.friction-desc { font-size: 13px; color: #7f1d1d; margin-bottom: 10px; }
.friction-examples { margin: 0 0 0 20px; font-size: 13px; color: #334155; }
.friction-examples li { margin-bottom: 4px; }
.horizon-section { display: flex; flex-direction: column; gap: 16px; }
.horizon-card { background: linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%); border: 1px solid #c4b5fd; border-radius: 8px; padding: 16px; }
.example-code { background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 12px; border: 1px solid #e2e8f0; font-family: Consolas, monospace; font-size: 12px; color: #334155; white-space: pre-wrap; word-break: break-word; line-height: 1.5; user-select: all; }
.horizon-title { font-weight: 600; font-size: 15px; color: #5b21b6; margin-bottom: 8px; }
.horizon-possible { font-size: 14px; color: #334155; margin-bottom: 10px; line-height: 1.5; }
.charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
.chart-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
.chart-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
.bar-row { display: flex; align-items: center; margin-bottom: 6px; }
.bar-label { width: 120px; font-size: 11px; color: #475569; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; margin: 0 8px; }
.bar-fill { height: 100%; border-radius: 3px; }
.bar-value { width: 60px; font-size: 11px; font-weight: 500; color: #64748b; text-align: right; }
.fun-ending { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #fbbf24; border-radius: 12px; padding: 24px; margin-top: 40px; text-align: center; }
.fun-headline { font-size: 18px; font-weight: 600; color: #78350f; margin-bottom: 8px; }
.fun-detail { font-size: 14px; color: #92400e; }
.footer-note { color: #94a3b8; font-size: 12px; text-align: center; margin-top: 40px; }
@media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } .stats-row { justify-content: center; } }
`;

// —— facets（LLM 逐会话语义标注）读取与聚合 ——
interface Facet {
  session_id: string;
  underlying_goal: string;
  goal_categories: Record<string, number>;
  outcome: string;
  session_type: string;
  user_satisfaction_counts: Record<string, number>;
  claude_helpfulness: string;
  friction_counts: Record<string, number>;
  friction_detail: string;
  primary_success: string;
  brief_summary: string;
}

/** 读取 reports/facets/*.json */
function loadFacets(): Facet[] {
  if (!existsSync(FACETS_DIR)) return [];
  const out: Facet[] = [];
  for (const f of readdirSync(FACETS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(FACETS_DIR, f), "utf-8")));
    } catch {
      // skip
    }
  }
  return out;
}

interface FacetAgg {
  sessionType: [string, number][];
  satisfaction: [string, number][];
  outcome: [string, number][];
  friction: [string, number][];
  wins: Facet[]; // 可作亮点的会话
  frictionExamples: { title: string; desc: string; examples: string[] }[];
}

/** 聚合 facets 为报告数据 */
function aggregateFacets(facets: Facet[]): FacetAgg {
  const cnt = (f: (x: Facet) => Record<string, number>, agg: Record<string, number>) =>
    facets.forEach((x) => {
      const m = f(x) || {};
      Object.entries(m).forEach(([k, v]) => (agg[k] = (agg[k] || 0) + v));
    });
  const st: Record<string, number> = {};
  const sat: Record<string, number> = {};
  const out: Record<string, number> = {};
  const fr: Record<string, number> = {};
  cnt((x) => ({ [x.session_type]: 1 }), st);
  cnt((x) => x.user_satisfaction_counts, sat);
  cnt((x) => ({ [x.outcome]: 1 }), out);
  cnt((x) => x.friction_counts, fr);
  const toArr = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]);

  // 亮点:primary_success 有值或 outcome 好的会话
  const wins = facets
    .filter((x) => x.primary_success && x.primary_success !== "none" && x.brief_summary)
    .concat(facets.filter((x) => (x.outcome === "mostly_achieved" || x.outcome === "fully_achieved") && !(x.primary_success && x.primary_success !== "none")))
    .slice(0, 3);

  // 摩擦分组:取每条 friction_detail 有内容、friction_counts 非空
  const frictionExamples = Object.entries(fr)
    .map(([k]) => {
      const hits = facets.filter((x) => (x.friction_counts || {})[k] && x.friction_detail);
      return {
        title: k,
        desc: hits.length ? `共 ${hits.length} 个会话出现「${k}」。` : "",
        examples: hits.slice(0, 2).map((x) => x.friction_detail),
      };
    })
    .filter((x) => x.examples.length);

  return {
    sessionType: toArr(st),
    satisfaction: toArr(sat),
    outcome: toArr(out),
    friction: toArr(fr),
    wins,
    frictionExamples,
  };
}

function bars(data: [string, number][], color: string): string {
  const max = Math.max(1, ...data.map(([, v]) => v));
  return data
    .map(
      ([label, v]) =>
        `<div class="bar-row"><div class="bar-label">${esc(label)}</div>` +
        `<div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%;background:${color}"></div></div>` +
        `<div class="bar-value">${v}</div></div>`
    )
    .join("");
}

interface R {
  count: number;
  tokenTotal: number;
  msgTotal: number;
  dateStart: string;
  dateEnd: string;
  toolTotals: { edit: number; write: number; bash: number; read: number; other: number };
  projects: Record<string, number>;
  sessions: {
    id: string; time: string; project: string; title: string;
    msgCount: number; totalTokens: number | null;
  }[];
}

function workLines(r: R) {
  const label = (p: string) => {
    const pl = (p || "").toLowerCase();
    if (pl.includes("datafusion")) return "📄 DataFusion 论文";
    if (pl.includes("frontendbackend") || pl.includes("abacas-cloud")) return "🖥 ABaCaS 平台(费效)";
    if (pl.includes("其余工程")) return "📝 期刊审稿回复";
    if (pl.includes("abacas") || pl.toLowerCase().includes("codex\\2026") || pl.includes("wei")) return "🗓 ABaCaS 会务";
    return "🧰 其他/杂项";
  };
  const map = new Map<string, { n: number; tok: number; msg: number; t0: string; t1: string }>();
  for (const s of r.sessions) {
    const b = label(s.project);
    const e = map.get(b) || { n: 0, tok: 0, msg: 0, t0: s.time, t1: s.time };
    e.n += 1; e.tok += s.totalTokens || 0; e.msg += s.msgCount;
    if (s.time < e.t0) e.t0 = s.time;
    if (s.time > e.t1) e.t1 = s.time;
    map.set(b, e);
  }
  return [...map.entries()].sort((a, b) => b[1].tok - a[1].tok);
}

async function main() {
  const rr = await buildInsightReport({ agent: "codex", days: 9999, limit: 300 });
  const r: R = rr as R;
  const deep = await deepStats("codex");
  const deepBy = new Map(deep.map((d) => [d.id, d]));
  // 聚合语言分布
  const langAgg: Record<string, number> = {};
  for (const d of deep)
    for (const [k, v] of Object.entries(d.languages)) langAgg[k] = (langAgg[k] || 0) + v;
  const langTop = Object.entries(langAgg).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const deepAgg = deep.reduce(
    (a, d) => {
      a.commands += d.commands;
      a.fails += d.commandFails;
      a.files += d.filesChanged;
      a.add += d.fileOps.add;
      a.upd += d.fileOps.update;
      a.del += d.fileOps.del;
      return a;
    },
    { commands: 0, fails: 0, files: 0, add: 0, upd: 0, del: 0 }
  );
  const fmt = (n: number) => (n || 0).toLocaleString("en-US");

  // —— facets 语义层 ——
  const facets = loadFacets();
  const fa = aggregateFacets(facets);
  const hasFacets = facets.length > 0;

  // 亮点卡片(取自 brief_summary)
  const winsHtml = fa.wins.length
    ? fa.wins
        .map(
          (w, i) =>
            `<div class="big-win"><div class="big-win-title">${esc(w.brief_summary.split(/[。；;]/)[0].slice(0, 40) || "亮点 " + (i + 1))}</div>` +
            `<div class="big-win-desc">${esc(w.brief_summary)}</div></div>`
        )
        .join("")
    : '<div class="empty">（无 facets 数据）</div>';

  // 摩擦卡片
  const frictionHtml = fa.frictionExamples.length
    ? fa.frictionExamples
        .map(
          (f) => `<div class="friction-category">
            <div class="friction-title">${esc(f.title)}</div>
            <div class="friction-desc">${esc(f.desc)}</div>
            <ul class="friction-examples">${f.examples.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
          </div>`
        )
        .join("")
    : '<div class="empty">（无明显摩擦）</div>';

  // Fun ending:挑一个最有人情味的 brief_summary
  const funFacet =
    facets.find((x) => /焦虑|担心|不好意思|有趣|感慨/.test(x.brief_summary || "")) ||
    facets.find((x) => x.outcome === "fully_achieved") ||
    facets[0];
  const funHtml = funFacet
    ? `<div class="fun-ending"><div class="fun-headline">${esc((funFacet.underlying_goal || "").slice(0, 60))}</div>
       <div class="fun-detail">${esc((funFacet.brief_summary || "").slice(0, 160))}</div></div>`
    : "";

  // 会话类型/满意度/结果/摩擦 分布图
  const typeChartsHtml = hasFacets
    ? `<div class="charts-row">
        <div class="chart-card"><div class="chart-title">Session Types</div>${bars(fa.sessionType, "#8b5cf6")}</div>
        <div class="chart-card"><div class="chart-title">Outcome · 结果</div>${bars(fa.outcome, "#4da3ff")}</div>
      </div>
      <div class="charts-row">
        <div class="chart-card"><div class="chart-title">User Satisfaction · 满意度</div>${bars(fa.satisfaction, "#eab308")}</div>
        <div class="chart-card"><div class="chart-title">Friction · 摩擦类型</div>${bars(fa.friction, "#dc2626")}</div>
      </div>`
    : "";

  // 可复制的建议片段(基于摩擦/高 token 会话)
  const suggestion = (title: string, why: string, code: string) =>
    `<div class="horizon-card"><div class="horizon-title">${esc(title)}</div>
     <div class="horizon-possible">${esc(why)}</div>
     <div class="example-code">${esc(code)}</div></div>`;
  const hasScopeDrift = facets.some((x) => (x.friction_counts || {}).scope_drift);
  const hasBug = facets.some((x) => (x.friction_counts || {}).buggy_code);
  const topSessions = r.sessions.sort((a: any, b: any) => (b.totalTokens || 0) - (a.totalTokens || 0)).slice(0, 3);
  const suggestionHtml = `<div class="horizon-section">
    ${suggestion(
      "给超长会话设边界 · 控制 token 黑洞",
      hasScopeDrift ? "多个会话被标注出现 scope_drift（目标漂移），且 token 以亿计的会话多为跨周续写。改为『一个目标一个新会话』。" : "token 最大的会话多为跨周续写，重读历史占大量消耗。",
      "# 在 Codex 会话开始时给明确边界\n> 只做：<单个具体目标>\n> 完成标准：<可验证结果>\n> 完成后：停止并总结，勿自行扩范围"
    )}
    ${suggestion(
      "把反复出现的排查经验沉淀成文档",
      "配置/MCP 排查类会话（hooks、codegraph 启动失败）多次出现且消耗巨大，属于『已解决却未沉淀』。",
      "mkdir -p docs/codex_notes && cat >> docs/codex_notes/known_issues.md <<'EOF'\n## 已排障问题\n- hooks 冲突 → 统一到单一 config\n- MCP 启动失败 → 检查手写握手超时\nEOF"
    )}
    ${hasBug ? suggestion("验证脚本强制 UTF-8,避免编码返工", "工具脚本反复踩 GBK/UTF-8,中文路径/输出乱码。", "export PYTHONUTF8=1\n# Windows PowerShell\n$env:PYTHONUTF8=\"1\"") : ""}
  </div>`;
  const topSessionsNote = topSessions.length
    ? `重点关注会话：${topSessions.map((s: any) => s.id.slice(0, 8)).join("、")}（token 最高，建议复盘是否产出匹配消耗）`
    : "";

  // —— At a Glance 自动文案 ——
  const biggestWinGoal = fa.wins[0]?.underlying_goal || "少数大主线(论文/费效)投入了长会话";
  const topFrictionLabel = fa.friction[0]?.[0] || "";
  const topFrictionNum = fa.friction[0]?.[1] || 0;
  const dissatisfiedNum = (fa.satisfaction.find(([k]) => k === "dissatisfied") || [])[1] || 0;
  const glanceHtml = hasFacets
    ? `<div class="glance-section"><strong>做得好：</strong>${esc(biggestWinGoal)} 这类目标被模型标为值得肯定；跨会话沉淀成可复用产物（MCP 工具、报告生成器）是你的强项。<a href="#section-wins" class="see-more">亮点工作 →</a></div>
       <div class="glance-section"><strong>阻碍点：</strong>${topFrictionLabel ? `最高频摩擦是「${esc(topFrictionLabel)}」（${topFrictionNum} 会话）` : "摩擦总体较少"}${dissatisfiedNum ? `；${dissatisfiedNum} 个会话被标为不满意。` : "。"}超长续写使单会话 token 以亿计，算力大量耗于重读历史。<a href="#section-friction" class="see-more">问题分析 →</a></div>
       <div class="glance-section"><strong>可尝试：</strong>给长会话设明确「完成即止」边界；把反复出现的 Codex 排查经验沉淀成文档/Skill，而非每次重查。<a href="#section-horizon" class="see-more">可试建议 →</a></div>`
    : `<div class="glance-section"><strong>做得好：</strong>你的 Codex 工作集中在少数深水区并投入了超长会话。<a href="#section-wins" class="see-more">亮点工作 →</a></div>
       <div class="glance-section"><strong>阻碍点：</strong>超长会话带来 token 黑洞与主题漂移。<a href="#section-friction" class="see-more">问题分析 →</a></div>
       <div class="glance-section"><strong>可尝试：</strong>给长会话设边界并沉淀排查经验。<a href="#section-horizon" class="see-more">可试建议 →</a></div>`;

  const lines = workLines(r);
  const tokMax = Math.max(1, ...lines.map(([, e]) => e.tok));
  const msgMax = Math.max(1, ...lines.map(([, e]) => e.msg));
  const projMax = Math.max(1, ...Object.entries(r.projects).map(([, n]) => n));

  // —— 工作区卡 ——
  const areaDesc: Record<string, string> = {
    "📄 DataFusion 论文": "论文《美国地表臭氧长期变化及其不确定性：多融合数据集综合评估》推进——RQ1-3 研究问题与证据链梳理、中期检查 PPT/答辩材料与图表核对、论文思路迭代与文献核验(Zotero/查重)、交接文档处理。token 占全部 Codex 用量的九成。",
    "🖥 ABaCaS 平台(费效)": "abacas-cloud 后端与 rsm.webui 前端的费效评估开发——成本曲线/Control Case 生成的接口模式、AVNA/WVNA 空间插值算法差异排查、全链条费效评估 v2 的 n8n 流程联调。",
    "📝 期刊审稿回复": "APR-D-26-00567 期刊审稿意见处理——读审稿意见 docx、逐条起草回复，跨多个会话迭代。",
    "🗓 ABaCaS 会务": "ABaCaS 2026 会议筹备——会议摘要信息表/用户信息表核对整理(桌面/微信素材)。",
  };
  const areasHtml = lines
    .map(([name, e]) => {
      const desc =
        areaDesc[name] ||
        "零散任务与早期测试会话（含 echo hello / 1 等占位输入）。";
      return `<div class="project-area">
        <div class="area-header"><div class="area-name">${esc(name)}</div><div class="area-count">${e.n} 会话 · ${fmt(e.tok)} tok</div></div>
        <div class="area-desc">${esc(desc)}</div>
      </div>`;
    })
    .join("");

  // —— 工具与项目条形图 ——
  const toolData: [string, number][] = [
    ["Bash", r.toolTotals.bash],
    ["编辑 Edit", r.toolTotals.edit],
    ["其它", r.toolTotals.other],
    ["读取 Read", r.toolTotals.read],
    ["写入 Write", r.toolTotals.write],
  ];
  const projData = Object.entries(r.projects).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const lineTok = lines.slice(0, 5).map(([n, e]) => [n.replace(/^[^\s]+\s/, ""), e.tok] as [string, number]);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Codex 会话洞察报告</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body><div class="container">
  <h1>Codex 会话洞察</h1>
  <p class="subtitle">${r.msgTotal.toLocaleString()} 条消息 · ${r.count} 个会话 · ${new Date().toISOString().slice(0,10)} 生成</p>

  <div class="at-a-glance">
    <div class="glance-title">一图速览 · At a Glance</div>
    <div class="glance-sections">${glanceHtml}</div>
  </div>

  <nav class="nav-toc">
    <a href="#section-work">工作分布</a>
    <a href="#section-usage">使用方式</a>
    <a href="#section-wins">亮点</a>
    <a href="#section-friction">问题</a>
    <a href="#section-horizon">建议</a>
  </nav>

  <div class="stats-row">
    <div class="stat"><div class="stat-value">${r.count}</div><div class="stat-label">Sessions</div></div>
    <div class="stat"><div class="stat-value">${fmt(r.msgTotal)}</div><div class="stat-label">Messages</div></div>
    <div class="stat"><div class="stat-value">${Math.round(r.tokenTotal / 1e8) / 10}亿</div><div class="stat-label">Tokens</div></div>
    <div class="stat"><div class="stat-value">${fmt(deepAgg.commands)}</div><div class="stat-label">Commands</div></div>
    <div class="stat"><div class="stat-value">${fmt(deepAgg.files)}</div><div class="stat-label">Files Changed</div></div>
    <div class="stat"><div class="stat-value">${esc(r.dateStart.slice(5))}</div><div class="stat-label">→ ${esc(r.dateEnd.slice(5))}</div></div>
  </div>

  <div class="charts-row">
    <div class="chart-card"><div class="chart-title">Languages · 改动语言分布</div>
      ${langTop.length ? bars(langTop, "#10b981") : '<div class="empty">（老会话无 apply_patch 记录）</div>'}
    </div>
    <div class="chart-card"><div class="chart-title">Files Changed · 文件操作</div>
      ${bars([["新增 Add", deepAgg.add], ["修改 Update", deepAgg.upd], ["删除 Delete", deepAgg.del]] as [string, number][], "#4da3ff")}
      ${`<div style="font-size:12px;color:#64748b;margin-top:8px;">命令失败 ${deepAgg.fails}/${deepAgg.commands} 次（${(deepAgg.commands ? ((deepAgg.fails / deepAgg.commands) * 100).toFixed(1) : 0)}%）</div>`}
    </div>
  </div>

  <h2 id="section-work">What You Work On · 工作分布</h2>
  <div class="project-areas">${areasHtml}</div>

  <div class="charts-row">
    <div class="chart-card"><div class="chart-title">token 占比(按工作线)</div>${bars(lineTok, "#4da3ff")}</div>
    <div class="chart-card"><div class="chart-title">工具使用</div>${bars(toolData, "#0891b2")}</div>
  </div>

  <h2 id="section-usage">How You Use Codex · 使用方式</h2>
  <div class="narrative">
    <p>你把 Codex 当作<b>长会话批处理引擎</b>：论文与平台两大主线各由少数跨周/跨月的超长会话承担（DataFusion 20 会话 40.7 亿 token），期间反复「继续」续写、经多次上下文压缩(compact)仍在推进。你习惯把文件/截图/表格直接丢给它（Files mentioned 高频出现），让 Codex 自己读文件定位。</p>
    <p>你<b>看重可复用产物</b>：不只问一句答一句，而是产出能长期用的工具——包括本报告依赖的 agent-sessions MCP 与 token 统计。你也用它做环境与配置排查（hooks 冲突、MCP 启动失败、模型路由），以及审稿回复这类文档工作。</p>
    <div class="key-insight"><strong>核心模式：</strong>少数大主题 · 超长续写 · 高 token · 倾向沉淀工具与文档而非一次性解决。</div>
  </div>

  <h2 id="section-wins">Impressive Things · 亮点工作</h2>
  <div class="section-intro">${hasFacets ? `${facets.length} 个被分析会话中，模型标注出这些做得好的点。` : "这些会话展示了超出「问答」的深度。"}</div>
  <div class="big-wins">${winsHtml}</div>

  <h2 id="section-friction">Where Things Go Wrong · 问题分析</h2>
  <div class="section-intro">${hasFacets ? "基于对每个会话的模型标注聚合：摩擦主要来自这些类别（附真实会话描述）。" : "你的使用数据中反复出现的摩擦点。"}</div>
  <div class="friction-categories">${frictionHtml}</div>

  ${typeChartsHtml}

  <h2 id="section-horizon">Features to Try · 可试建议</h2>
  <div class="section-intro">${topSessionsNote || "基于会话摩擦分析的可操作建议。"}</div>
  ${suggestionHtml}

  ${funHtml}

  <p class="footer-note">数据来源 ~/.codex 会话记录 · token 为官方统计 · 语义标注由 one-hub deepseek-v4-flash 生成 · agent-sessions session_insights</p>
</div></body></html>`;

  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, html, "utf-8");
  console.log("已生成:", outPath, `(${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
