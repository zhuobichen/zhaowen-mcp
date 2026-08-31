#!/usr/bin/env python3
"""easy-log 工作日志报告生成器

拉取 easy-log MCP 的工作日志数据，生成可视化 HTML 报告（月度投入天数条形图 + 各月工作内容 + 年度汇总）。

用法:
  python report.py --api-key sk-xxx                    # 生成 report.html（当前目录）
  python report.py --api-key sk-xxx --output out.html   # 指定输出路径
  python report.py                                       # 从 scripts/.env 读 WORK_MANAGEMENT_API_KEY

依赖: 仅 Python 标准库，无需第三方包。
"""
import argparse
import datetime
import html
import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

URL = "https://ai-log.hycx-gd.cn/Log/api/mcp"


class EasyLogClient:
    def __init__(self, api_key: str):
        self.key = api_key
        self.session = None

    def _rpc(self, method: str, params: dict | None = None, mid: int = 1) -> dict:
        body = {"jsonrpc": "2.0", "id": mid, "method": method}
        if params is not None:
            body["params"] = params
        req = urllib.request.Request(
            URL, data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Authorization": f"Bearer {self.key}",
            },
        )
        if self.session:
            req.add_header("Mcp-Session-Id", self.session)
        with urllib.request.urlopen(req, timeout=40) as r:
            self.session = self.session or r.headers.get("mcp-session-id")
            return json.loads(r.read().decode())

    def call(self, name: str, args: dict, mid: int = 10) -> str:
        r = self._rpc("tools/call", {"name": name, "arguments": args}, mid)
        c = r.get("result", {}).get("content", [{}])
        return c[0].get("text", "") if c else ""

    def connect(self) -> None:
        self._rpc("initialize", {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "easy-log-report", "version": "1.0"},
        })

    def list_all_logs(self) -> list[dict]:
        logs, page = [], 1
        while page <= 200:
            txt = self.call("list_work_logs_work_log_list_get",
                            {"page": page, "page_size": 50}, mid=10 + page)
            try:
                batch = json.loads(txt)
            except Exception:
                break
            if not isinstance(batch, list) or not batch:
                break
            logs.extend(batch)
            if len(batch) < 50:
                break
            page += 1
        return logs


def esc(s: object) -> str:
    return html.escape(str(s))


def filter_future(logs: list[dict]) -> list[dict]:
    """按当前日期过滤"穿越"记录：work_on 晚于今天（未来日期）的排除。"""
    today = datetime.date.today()
    out = []
    for l in logs:
        w = str(l.get("work_on", ""))[:10]
        try:
            if w and datetime.date.fromisoformat(w) > today:
                continue
        except ValueError:
            pass
        out.append(l)
    return out


def build_report(logs: list[dict], output: str, username: str) -> str:
    monthly = defaultdict(lambda: {"duration": 0.0, "days": 0.0, "count": 0, "tasks": []})
    for l in logs:
        w = str(l.get("work_on", ""))[:7] or f"{l.get('year')}-{l.get('month'):02d}"
        monthly[w]["duration"] += l.get("duration") or 0
        monthly[w]["days"] += l.get("days") or 0
        monthly[w]["count"] += 1
        t = f"{l.get('task') or ''}（{l.get('project_name') or ''}）"
        if t not in monthly[w]["tasks"]:
            monthly[w]["tasks"].append(t)

    months = sorted(monthly)
    maxdays = max(monthly[m]["days"] for m in months) or 1
    total_days = sum(monthly[m]["days"] for m in months)
    total_dur = sum(monthly[m]["duration"] for m in months)
    peak = max(months, key=lambda m: monthly[m]["days"])

    yearly = defaultdict(lambda: {"days": 0.0, "dur": 0.0})
    for m in months:
        yearly[m[:4]]["days"] += monthly[m]["days"]
        yearly[m[:4]]["dur"] += monthly[m]["duration"]

    bars = ""
    for m in months:
        v = monthly[m]
        pct = v["days"] / maxdays * 100
        bars += (f'<div class="bar-row"><span class="bar-label">{m}</span>'
                 f'<div class="bar-track"><div class="bar" style="width:{pct:.1f}%">'
                 f'<span class="bar-inner">{v["days"]:.0f}天</span></div></div></div>')

    tbl = ""
    for m in months:
        v = monthly[m]
        items = "".join(f"<li>{esc(t)}</li>" for t in v["tasks"])
        tbl += (f'<details><summary><span class="m">{m}</span>'
                f'<span class="meta">{v["days"]:.0f} 天 · {v["duration"]:.0f} 工时 · {v["count"]} 条</span></summary>'
                f'<ul class="tasks">{items}</ul></details>')

    yearly_rows = "".join(
        f"<tr><td>{y}</td><td>{yearly[y]['days']:.0f} 天</td><td>{yearly[y]['dur']:.0f} 工时</td></tr>"
        for y in sorted(yearly))

    comment = f"""
    <p><b>① 成长轨迹。</b>跨度 {months[0]} ~ {months[-1]}，从执行性任务逐步走向方法校正与跨项目协调。</p>
    <p><b>② 工作强度。</b>总投入 {total_days:.0f} 天 / {total_dur:.0f} 工时，最忙月 {peak}（{monthly[peak]['days']:.0f} 天），长期高位。</p>
    <p><b>③ 节奏。</b>呈「起步 → 高峰 → 多元 → 放缓」阶段变化；部分月份无记录，建议补齐口径。</p>
    <p><b>④ 建议。</b>多线并行的工作建议沉淀为项目文档；核对单月超 30 天的记录是否含补录/叠加。</p>
    """

    doc = f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(username)} · 工作日志分析</title><style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:linear-gradient(160deg,#0f172a 0%,#1e293b 40%,#f1f5f9 40.2%,#f8fafc 100%);color:#1e293b;min-height:100vh}}
.container{{max-width:960px;margin:0 auto;padding:32px 20px 60px}}
.hero{{background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border-radius:16px;padding:28px 30px;margin-bottom:24px;box-shadow:0 10px 30px rgba(14,165,233,.25)}}
.hero h1{{font-size:26px;font-weight:700}}
.hero .sub{{opacity:.85;font-size:13px;margin-top:6px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px}}
.card{{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.05);transition:transform .15s}}
.card:hover{{transform:translateY(-2px)}}
.card .num{{font-size:26px;font-weight:800;color:#0ea5e9}}
.card.hot{{border-color:#f59e0b}}.card.hot .num{{color:#f59e0b}}
.card .lbl{{font-size:12px;color:#64748b;margin-top:4px}}
section{{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;margin-bottom:22px;box-shadow:0 2px 8px rgba(0,0,0,.04)}}
h2{{font-size:17px;margin-bottom:16px}}
.bar-row{{display:flex;align-items:center;gap:10px;margin-bottom:7px}}
.bar-label{{width:66px;font-size:12px;color:#64748b;text-align:right;flex-shrink:0}}
.bar-track{{flex:1;background:#f1f5f9;border-radius:6px;height:26px;overflow:hidden}}
.bar{{background:linear-gradient(90deg,#38bdf8,#6366f1);height:100%;border-radius:6px;display:flex;align-items:center;min-width:34px}}
.bar-inner{{font-size:11px;color:#fff;padding-left:8px;white-space:nowrap;font-weight:600}}
table{{width:100%;border-collapse:collapse;font-size:14px}}
th{{text-align:left;color:#64748b;font-weight:500;padding:8px 10px;border-bottom:2px solid #e2e8f0}}
td{{padding:9px 10px;border-bottom:1px solid #f1f5f9}}
details{{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:7px;background:#fafbfc}}
summary{{cursor:pointer;font-weight:600;font-size:14px;list-style:none;display:flex;align-items:center;gap:12px}}
summary::-webkit-details-marker{{display:none}}
summary .m{{color:#0ea5e9}}
summary .meta{{color:#94a3b8;font-weight:400;font-size:12px;margin-left:auto}}
.tasks{{margin:10px 0 4px 22px;font-size:13px;color:#475569}}
.tasks li{{margin-bottom:5px;line-height:1.6}}
.comment p{{margin-bottom:12px;line-height:1.8;font-size:14px;color:#334155}}
.comment b{{color:#6366f1}}
</style></head><body><div class="container">
<div class="hero"><h1>📊 {esc(username)} · 工作日志分析</h1>
<div class="sub">数据源：easy-log MCP ｜ {months[0]} ~ {months[-1]} ｜ 共 {len(logs)} 条 ｜ 单位：天</div></div>
<div class="cards">
<div class="card"><div class="num">{total_days:.0f}</div><div class="lbl">总投入天数</div></div>
<div class="card"><div class="num">{total_dur:.0f}</div><div class="lbl">总工时 (h)</div></div>
<div class="card"><div class="num">{len(logs)}</div><div class="lbl">日志条数</div></div>
<div class="card"><div class="num">{months[0]}~{months[-1]}</div><div class="lbl">时间跨度</div></div>
<div class="card hot"><div class="num">{peak}</div><div class="lbl">最忙月 · {monthly[peak]['days']:.0f} 天</div></div>
</div>
<section><h2>📈 月度投入天数</h2>{bars}
<h2 style="margin-top:22px">📆 年度汇总</h2>
<table><tr><th>年份</th><th>投入天数</th><th>总工时</th></tr>{yearly_rows}</table></section>
<section><h2>🗂 各月工作内容</h2>{tbl}</section>
<section class="comment"><h2>📝 统计要点</h2>{comment}</section>
</div></body></html>"""

    with open(output, "w", encoding="utf-8") as f:
        f.write(doc)
    return output


def load_key_from_env() -> str:
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("WORK_MANAGEMENT_API_KEY="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("WORK_MANAGEMENT_API_KEY", "")


def main() -> int:
    ap = argparse.ArgumentParser(description="easy-log 工作日志报告生成器")
    ap.add_argument("--api-key", help="MCP API Key（默认从 scripts/.env 或环境变量读取）")
    ap.add_argument("--output", default="report.html", help="输出 HTML 路径（默认 report.html）")
    args = ap.parse_args()

    key = args.api_key or load_key_from_env()
    if not key:
        print("错误: 未提供 API Key（--api-key 或 scripts/.env 的 WORK_MANAGEMENT_API_KEY）", file=sys.stderr)
        return 1

    try:
        client = EasyLogClient(key)
        client.connect()
        logs = filter_future(client.list_all_logs())
    except Exception as e:
        print(f"错误: 拉取日志失败（{e}）", file=sys.stderr)
        return 1

    username = logs[0].get("user_name", "用户") if logs else "用户"
    out = build_report(logs, args.output, username)
    print(f"✅ 已生成报告: {out}（{len(logs)} 条日志）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
