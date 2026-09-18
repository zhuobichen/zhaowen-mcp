"""
掌盟抓包插件（mitmproxy addon）—— 只读，不改任何流量。

作用：当你在手机上打开掌盟的「战绩」页时，自动把两样东西存到本地：
  1. data/mlol-cookie.txt —— 那次请求的 Cookie 头（含登录态），供 mlol:probe 使用；
  2. data/mlol-samples/*.json —— 请求参数 + 响应原文，用来确认「闸口之后还要不要签名」。

用法：
  npm run mlol:capture          # 在电脑上启动代理（默认监听 8080）
  然后手机 Wi-Fi 设代理 → 电脑 IP:8080 → 装证书 → 打开掌盟战绩页

隐私提醒：代理会看到手机上的全部 HTTPS 流量。只在你自己手机上、抓完立刻 Ctrl+C 关掉。
"""

import json
import os
import re
import time
from pathlib import Path

from mitmproxy import http

# 项目根目录（本脚本在 <root>/tools/ 下）
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
COOKIE_FILE = DATA / "mlol-cookie.txt"
SAMPLE_DIR = DATA / "mlol-samples"

TARGET_HOST = "mlol.qt.qq.com"
# 只关心战绩相关路由；想抓全部就把它改成 "/go/"
TARGET_PATH_PREFIXES = ("/go/battle_info",)

_seen = set()


def _interesting(flow: http.HTTPFlow) -> bool:
    if TARGET_HOST not in flow.request.pretty_host:
        return False
    return any(flow.request.path.startswith(p) for p in TARGET_PATH_PREFIXES)


def request(flow: http.HTTPFlow) -> None:
    if not _interesting(flow):
        return

    cookie = flow.request.headers.get("cookie", "")
    # 只认「像登录态」的 cookie：要有 userid/openid/uin 之类字段
    looks_authed = bool(re.search(r"(userid|openid|uin|acctype)", cookie, re.I))

    print("\n" + "=" * 72)
    print(f"[掌盟请求] {flow.request.method} {flow.request.path}")
    print(f"  Cookie 字段：{', '.join(sorted({c.split('=')[0].strip() for c in cookie.split(';') if '=' in c})) or '（无）'}")
    has_sig = bool(re.search(r"(sig|sign|nonce|timestamp|_t=)", flow.request.path + cookie, re.I))
    print(f"  是否带签名类参数：{'是（注意：那闸口后面还有一层）' if has_sig else '否'}")
    try:
        body = flow.request.get_text()
    except Exception:
        body = ""
    if body:
        print(f"  请求体：{body[:300]}")

    if looks_authed and cookie:
        DATA.mkdir(parents=True, exist_ok=True)
        COOKIE_FILE.write_text(cookie, encoding="utf-8")
        print(f"  ✅ 已把 Cookie 存到 {COOKIE_FILE.relative_to(ROOT)}（含登录态，已在 .gitignore 排除）")
    elif cookie:
        print("  ⚠️ 这次请求的 cookie 不像登录态，先不覆盖已存的那份")


def response(flow: http.HTTPFlow) -> None:
    if not _interesting(flow):
        return
    key = f"{flow.request.method} {flow.request.path}"
    if key in _seen:
        return
    _seen.add(key)

    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%H%M%S")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", flow.request.path)[:60]
    f = SAMPLE_DIR / f"{stamp}_{safe}.json"
    try:
        payload = {
            "request": {
                "method": flow.request.method,
                "path": flow.request.path,
                "body": flow.request.get_text(),
                "headers": {k: v for k, v in flow.request.headers.items() if k.lower() != "cookie"},
            },
            "response_status": flow.response.status_code if flow.response else None,
            "response": flow.response.get_text()[:4000] if flow.response else None,
        }
        f.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  📄 响应已存档：{f.relative_to(ROOT)}")
        text = (flow.response.get_text() if flow.response else "")[:400].replace("\n", " ")
        print(f"  响应片段：{text}")
        print("  → 抓完这两样就够了，可以在电脑上跑 npm run mlol:probe 验证")
    except Exception as e:
        print(f"  （存档失败：{e}）")
