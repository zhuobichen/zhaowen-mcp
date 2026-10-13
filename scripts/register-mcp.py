# -*- coding: utf-8 -*-
"""把一个 MCP 服务安全地注册进 Claude Code 的 .claude.json。

用法：
    python register-mcp.py --config ~/.claude.json --name my-mcp \\
        --node <服务目录> [--env K=V ...] [--dry-run]

`--node` 给服务目录时，自动拼出 cmd /c node <tsx> <index.ts> 这套 args
（tsx 取该目录 node_modules 里的那份）。要给别的命令形态就用 --command/--arg。

**为什么不用手改，也不整份 json round-trip**

1. `.claude.json` 里有**多处** `"mcpServers"`：`projects[...]` 下面那几个是空对象 `{}`，
   只有顶层那个是真的。按第一次出现去插，会插进空对象里变成 `{...,}` 的拖尾逗号，
   整个文件解析不了。这里用「`{` 后面跟的是 `"键名"` 而不是 `}`」来挑出顶层那个。
2. 文件里还有大小写不同的近似重复键（`xxx[1m]` / `xxx[1M]`），整份 round-trip 有丢键风险。
   所以走**定点文本插入**，逐字节保留其余内容。
3. 写之前先自检：解析得开、只多出预期的那一项。**不通过就不写**，并留一份带时间戳的备份。
"""
import argparse
import io
import json
import os
import re
import shutil
import time


def build_args(ns):
    if ns.node:
        d = ns.node.rstrip("/\\").replace("\\", "/")
        tsx = d + "/node_modules/tsx/dist/cli.mjs"
        if not os.path.exists(tsx):
            raise SystemExit("找不到 tsx：%s（先在那个目录 npm install）" % tsx)
        return ["/c", "node", tsx, d + "/index.ts"]
    if not ns.arg:
        raise SystemExit("要么给 --node <服务目录>，要么给 --command/--arg")
    return list(ns.arg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.expanduser("~/.claude.json"))
    ap.add_argument("--name", required=True, help="mcpServers 里的键名")
    ap.add_argument("--node", help="服务目录（自动拼 tsx + index.ts）")
    ap.add_argument("--command", default="cmd", help="可执行文件，默认 cmd")
    ap.add_argument("--arg", action="append", default=[], help="重复给出，拼 args")
    ap.add_argument("--env", action="append", default=[], help="重复给出，K=V")
    ap.add_argument("--dry-run", action="store_true")
    ns = ap.parse_args()

    env = {}
    for kv in ns.env:
        k, _, v = kv.partition("=")
        env[k.strip()] = v

    entry = {"type": "stdio", "command": ns.command, "args": build_args(ns)}
    if env:
        entry["env"] = env

    s = io.open(ns.config, encoding="utf-8").read()
    if '"%s"' % ns.name in s:
        raise SystemExit("已经注册过 %s 了，没动" % ns.name)

    cands = [m.start() for m in re.finditer(r'"mcpServers"\s*:\s*\{', s)]
    good = [c for c in cands if re.match(r'"mcpServers"\s*:\s*\{\s*"', s[c:])]
    print("mcpServers 出现 %d 处，其中非空对象 %d 处" % (len(cands), len(good)))
    if len(good) != 1:
        raise SystemExit("顶层 mcpServers 不唯一，中止（先用 --dry-run 看清楚）")
    i = good[0]
    j = re.match(r'"mcpServers"\s*:\s*\{', s[i:]).end() + i

    m = re.match(r'"mcpServers"\s*:\s*\{\s*\n( *)"', s[i:])
    indent = len(m.group(1)) if m else 4
    print("顶层 mcpServers 在第 %d 字符，缩进 %d 空格" % (i, indent))

    body = json.dumps({ns.name: entry}, ensure_ascii=False, indent=indent)
    lines = body.splitlines()[1:-1]
    inner = "\n".join((" " * indent + ln[indent:]) if ln.startswith(" " * indent) else (" " * indent + ln)
                      for ln in lines)
    new = s[:j] + "\n" + inner + "," + s[j:]

    # 落盘前自检：新旧都解析得开，且只多这一项
    before = json.loads(s)
    after = json.loads(new)
    if ns.name not in after.get("mcpServers", {}):
        raise SystemExit("自检失败：新内容里没有 " + ns.name)
    chk = json.loads(new)
    chk["mcpServers"].pop(ns.name)
    if chk != before:
        raise SystemExit("自检失败：除新增项外内容变了，中止")

    if ns.dry_run:
        print("\n--dry-run，未写入。将插入：\n" + inner)
        return

    bak = ns.config + ".bak-before-%s-%d" % (ns.name, int(time.time()))
    shutil.copy2(ns.config, bak)
    io.open(ns.config, "w", encoding="utf-8", newline="").write(new)
    print("已写入 %s\n备份 %s" % (ns.config, bak))
    print("mcpServers 数量 %d -> %d" % (len(before["mcpServers"]), len(after["mcpServers"])))
    print("\n提醒：改完要重连（重启 Claude Code 或重开会话）—— 工具清单在连接那一刻定下。")


if __name__ == "__main__":
    main()
