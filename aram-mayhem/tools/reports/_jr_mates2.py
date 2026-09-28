# -*- coding: utf-8 -*-
"""对照：加藤惠 / Ybac1 与今人的同队关系（不要求丁ding在场）。"""
import pathlib
import json, os
from collections import Counter

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
arch = json.load(open(os.path.join(BASE, "data/archive/lol-matches.json"), encoding="utf-8"))
DD = "自己的丁ding"
JR = "今人不见古时月"
TARGETS = ["加藤惠99", "Ybac1", "上杉家主丶绘梨衣", "事已至此先吃饭吧", "AQword"]


def norm(n):
    return (n or "").split("#")[0].strip()


stat = {t: {"jr_same": 0, "jr_same_with_dd": 0, "dd_same": 0, "all": 0} for t in TARGETS}

for k, v in arch["games"].items():
    parts = v.get("participants") or []
    names = {}
    for p in parts:
        names[norm(p.get("name"))] = p
    for t in TARGETS:
        if t not in names:
            continue
        stat[t]["all"] += 1
        tp = names[t]
        if JR in names and names[JR].get("teamId") == tp.get("teamId"):
            stat[t]["jr_same"] += 1
            if DD in names and names[DD].get("teamId") == tp.get("teamId"):
                stat[t]["jr_same_with_dd"] += 1
        if DD in names and names[DD].get("teamId") == tp.get("teamId"):
            stat[t]["dd_same"] += 1

print("%-22s %8s %10s %14s %10s" % ("玩家", "归档总", "和今人同队", "其中丁ding也在", "和丁ding同队"))
for t in TARGETS:
    s = stat[t]
    print("%-22s %8d %10d %14d %10d" % (t, s["all"], s["jr_same"], s["jr_same_with_dd"], s["dd_same"]))

# 今人自己视角：他的其他队友排行（不要求丁ding在场）
print("\n=== 今人的队友排行（不要求丁ding在场）===")
mate = Counter()
for k, v in arch["games"].items():
    parts = v.get("participants") or []
    names = {norm(p.get("name")): p for p in parts}
    if JR not in names:
        continue
    jr = names[JR]
    for nm, p in names.items():
        if nm == JR:
            continue
        if p.get("teamId") == jr.get("teamId"):
            mate[nm] += 1
for nm, c in mate.most_common(15):
    print("  %-26s %d" % (nm, c))
