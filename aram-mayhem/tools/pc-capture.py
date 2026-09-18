"""
PC 端抓包插件（mitmproxy addon）—— 目标：找出 WeGame「我的战绩」背后的接口。

只读：不修改任何流量，只把「像战绩接口」的请求与响应存到 data/pc-samples/ 供分析。

用法：
  npm run pc:trust-ca     # 一次性：把 mitmproxy 的 CA 装进当前用户证书库（可撤销）
  npm run pc:capture      # 启动代理（8080）
  # 然后打开 WeGame → 我的战绩 → 随便翻两下
  npm run pc:untrust-ca   # 用完撤掉 CA

筛选规则：域名属于腾讯系（qq.com / gtimg.cn / wegame.com.cn / tencent.com），
且 URL 里含战绩相关关键词（battle / match / history / record / profile / score / lol）。
"""

import json
import re
import time
from pathlib import Path

from mitmproxy import http

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / "data" / "pc-samples"

HOST_SUFFIXES = ("qq.com", "gtimg.cn", "wegame.com.cn", "tencent.com", "qpic.cn")
PATH_KEYWORDS = re.compile(
    r"(battle|match|history|record|profile|score|lol|game|player|summoner|tgp|pallas)", re.I
)
SKIP_EXT = re.compile(r"\.(png|jpg|jpeg|gif|webp|css|woff2?|ico|svg|mp4)(\?|$)", re.I)

_seen = set()
_hits = 0


def _interesting(flow: http.HTTPFlow) -> bool:
    host = flow.request.pretty_host.lower()
    if not any(host == s or host.endswith("." + s) or host.endswith(s) for s in HOST_SUFFIXES):
        return False
    url = flow.request.pretty_url
    if SKIP_EXT.search(url):
        return False
    return bool(PATH_KEYWORDS.search(url))


def response(flow: http.HTTPFlow) -> None:
    global _hits
    if not _interesting(flow):
        return
    key = f"{flow.request.method} {flow.request.pretty_url}"
    if key in _seen:
        return
    _seen.add(key)

    ctype = (flow.response.headers.get("content-type", "") if flow.response else "") or ""
    # 只关心可能带数据的响应（JSON / JS / 文本），图片样式已经跳过
    if not re.search(r"(json|javascript|text)", ctype, re.I):
        return

    _hits += 1
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", flow.request.pretty_url.split("://", 1)[-1])[:90]
    f = SAMPLE_DIR / f"{time.strftime('%H%M%S')}_{_hits:03d}_{safe}.json"
    try:
        body = flow.response.get_text()[:60_000] if flow.response else ""
        payload = {
            "url": flow.request.pretty_url,
            "method": flow.request.method,
            "request_headers": {k: v for k, v in flow.request.headers.items() if k.lower() != "cookie"},
            "has_cookie": "cookie" in {k.lower() for k in flow.request.headers},
            "request_body": flow.request.get_text()[:4000],
            "status": flow.response.status_code if flow.response else None,
            "content_type": ctype,
            "response": body,
        }
        f.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[候选接口 {_hits}] {flow.request.method} {flow.request.pretty_url[:140]}")
        print(f"  状态 {payload['status']} · {ctype[:60]} · 响应 {len(body)} 字 · 带cookie={payload['has_cookie']}")
        print(f"  存档：{f.relative_to(ROOT)}")
        snippet = re.sub(r"\s+", " ", body[:220])
        print(f"  片段：{snippet}")
    except Exception as e:
        print(f"  （存档失败：{e}）")


def done() -> None:
    print(f"\n抓包结束：共记录 {_hits} 个候选接口，样本在 {SAMPLE_DIR.relative_to(ROOT)}")
    print("把样本留着，告诉 Claude 一声就会开始分析。")
