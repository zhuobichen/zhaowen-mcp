# -*- coding: utf-8 -*-
"""丁ding 与今人同队时，今人还和谁一起排过。"""
import pathlib
import json, os
from collections import Counter, defaultdict

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
arch = json.load(open(os.path.join(BASE, "data/archive/lol-matches.json"), encoding="utf-8"))
ME = "自己的丁ding"
JR = "今人不见古时月"


def norm(n):
    return (n or "").split("#")[0].strip()


mate = Counter()          # 今人的其他队友（同队次数）
mate_dd_win = Counter()   # 这些局里丁ding的胜负
tri = Counter()           # 三人以上组合：和谁「同时」在场
n_games = 0
n_multi = 0

for k, v in arch["games"].items():
    parts = v.get("participants") or []
    names = {norm(p.get("name")): p for p in parts}
    if ME not in names or JR not in names:
        continue
    me, jr = names[ME], names[JR]
    if me.get("teamId") != jr.get("teamId"):
        continue
    n_games += 1
    others = [nm for nm, p in names.items()
              if nm not in (ME, JR) and p.get("teamId") == jr.get("teamId")]
    for nm in others:
        mate[nm] += 1
    if len(others) >= 2:
        n_multi += 1

print("丁ding 与 今人 同队的局数: %d" % n_games)
print("其中还有 ≥2 个其他队友的: %d\n" % n_multi)
print("%-26s %6s %8s" % ("今人的其他队友", "同队局", "占同队局"))
for nm, c in mate.most_common(25):
    print("%-26s %6d %7.1f%%" % (nm, c, c / n_games * 100))

# 这些局里丁ding的胜率（对照：与今人同队整体）
wins = 0
tot = 0
for k, v in arch["games"].items():
    parts = v.get("participants") or []
    names = {norm(p.get("name")): p for p in parts}
    if ME not in names or JR not in names:
        continue
    me, jr = names[ME], names[JR]
    if me.get("teamId") != jr.get("teamId"):
        continue
    st = me.get("stats") or {}
    tot += 1
    if st.get("win"):
        wins += 1
print("\n这些局的丁ding胜率: %.1f%% (%d/%d)" % (wins / tot * 100, wins, tot))

# 常见三/四人组合（只出现次数靠前的）
print("\n=== 出现最多的『同时在场』组合（含今人队友，≥8 次）===")
combo = Counter()
for k, v in arch["games"].items():
    parts = v.get("participants") or []
    names = {norm(p.get("name")): p for p in parts}
    if ME not in names or JR not in names:
        continue
    me, jr = names[ME], names[JR]
    if me.get("teamId") != jr.get("teamId"):
        continue
    others = sorted(nm for nm, p in names.items()
                    if nm not in (ME, JR) and p.get("teamId") == jr.get("teamId"))
    if len(others) >= 2:
        combo[tuple(others)] += 1
for c, n in combo.most_common(12):
    if n >= 8:
        print("  %-58s %d 局" % (" + ".join(c), n))
