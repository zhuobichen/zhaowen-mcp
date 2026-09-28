# -*- coding: utf-8 -*-
"""队友与组队组合分析。
方法：
  1. 用 puuid 反查所有含丁ding的对局（不依赖 puuidName，那只是归档主体）
  2. 队友/组合统计
  3. Beta-Binomial 经验贝叶斯收缩（样本少的组合向基准收缩，抑制小样本虚高）
  4. Wilson 得分区间下界（保守排名）
  5. Benjamini-Hochberg FDR 控制多重比较
"""
import pathlib
import json, math, os
from collections import defaultdict, Counter
from math import comb

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
D = json.load(open(os.path.join(BASE, 'data/archive/lol-matches.json'), encoding='utf-8'))
vals = list(D['games'].values())

DD = None
for m in vals:
    for p in m['participants']:
        if (p.get('name') or '').startswith('自己的丁ding'):
            DD = p['puuid']; break
    if DD:
        break

mine = []
for m in vals:
    for p in m['participants']:
        if p['puuid'] == DD:
            mine.append((m, p)); break

N = len(mine)
W = sum(1 for _, p in mine if p['stats'].get('win'))
P0 = W / N
print('games=%d wins=%d p0=%.4f' % (N, W, P0))


def Phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def two_sided_p(w, n):
    if n == 0:
        return 1.0
    se = math.sqrt(P0 * (1 - P0) / n)
    if se == 0:
        return 1.0
    return max(1e-12, min(1.0, 2 * (1 - Phi(abs(w / n - P0) / se))))


def wilson_lower(w, n, z=1.96):
    if n == 0:
        return 0.0
    p = w / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c - r) / d


K_PRIOR = 20.0   # 先验强度：相当于先垫 20 局基准，样本越少收缩越强
ALPHA = P0 * K_PRIOR
BETA = (1 - P0) * K_PRIOR


def shrunk(w, n):
    return (w + ALPHA) / (n + ALPHA + BETA)


def bh_fdr(pvals):
    n = len(pvals)
    order = sorted(range(n), key=lambda i: pvals[i])
    q = [1.0] * n
    prev = 1.0
    for rank in range(n - 1, -1, -1):
        i = order[rank]
        val = min(prev, pvals[i] * n / (rank + 1))
        q[i] = val
        prev = val
    return q


# ---------- 队友 ----------
mate = defaultdict(lambda: {'n': 0, 'w': 0, 'name': '', 'last': 0, 'champ': Counter()})
for m, me in mine:
    win = me['stats'].get('win')
    tid = me['teamId']
    for p in m['participants']:
        if p['puuid'] == DD or p['teamId'] != tid:
            continue
        e = mate[p['puuid']]
        e['n'] += 1
        e['w'] += 1 if win else 0
        if p.get('name'):
            e['name'] = p['name']
        e['last'] = max(e['last'], m.get('gameCreation', 0))
        e['champ'][p.get('championId')] += 1

mates = []
for pu, e in mate.items():
    n, w = e['n'], e['w']
    mates.append({'puuid': pu, 'name': e['name'] or '(未知)', 'n': n, 'w': w,
                  'p': round(w / n * 100, 1), 'shrunk': round(shrunk(w, n) * 100, 1),
                  'wilson': round(wilson_lower(w, n) * 100, 1),
                  'pval': two_sided_p(w, n), 'last': e['last']})
qs = bh_fdr([x['pval'] for x in mates])
for x, q in zip(mates, qs):
    x['q'] = round(q, 3)
D_total = len([x for x in mates if x['n'] >= 1])

# ---------- 组合 ----------
def combos(k):
    out = defaultdict(lambda: [0, 0])
    for m, me in mine:
        win = me['stats'].get('win')
        tid = me['teamId']
        ms = sorted(p['puuid'] for p in m['participants']
                    if p['teamId'] == tid and p['puuid'] != DD)
        if len(ms) < k:
            continue
        if k == 1:
            for i in range(len(ms)):
                c = out[(ms[i],)]; c[0] += 1; c[1] += 1 if win else 0
        elif k == 2:
            for i in range(len(ms)):
                for j in range(i + 1, len(ms)):
                    c = out[(ms[i], ms[j])]; c[0] += 1; c[1] += 1 if win else 0
        elif k == 3:
            for i in range(len(ms)):
                for j in range(i + 1, len(ms)):
                    for l in range(j + 1, len(ms)):
                        c = out[(ms[i], ms[j], ms[l])]; c[0] += 1; c[1] += 1 if win else 0
        else:
            c = out[tuple(ms[:k])]; c[0] += 1; c[1] += 1 if win else 0
    return out

namef = {pu: e['name'] for pu, e in mate.items()}


def build(k, minn):
    raw = combos(k)
    items = []
    for key, (n, w) in raw.items():
        if n < minn:
            continue
        names = [namef.get(p, '?') for p in key]
        items.append({'key': key, 'names': names, 'n': n, 'w': w,
                      'p': round(w / n * 100, 1), 'shrunk': round(shrunk(w, n) * 100, 1),
                      'wilson': round(wilson_lower(w, n) * 100, 1),
                      'pval': two_sided_p(w, n)})
    qs = bh_fdr([x['pval'] for x in items]) if items else []
    for x, q in zip(items, qs):
        x['q'] = round(q, 3)
    items.sort(key=lambda x: -x['shrunk'])
    return items


c2 = build(2, 8)
c3 = build(3, 6)
c4 = build(4, 5)
print('mates=%d c2=%d c3=%d c4=%d' % (len(mates), len(c2), len(c3), len(c4)))

# ---------- 组队规模（用「熟人陪同数」当代理） ----------
FAM = {x['puuid'] for x in mates if x['n'] >= 10}
scale = defaultdict(lambda: [0, 0])
for m, me in mine:
    win = me['stats'].get('win')
    tid = me['teamId']
    k = sum(1 for p in m['participants'] if p['teamId'] == tid and p['puuid'] != DD and p['puuid'] in FAM)
    s = scale[k]
    s[0] += 1; s[1] += 1 if win else 0
Dscale = []
for k in sorted(scale):
    n, w = scale[k]
    Dscale.append({'k': k, 'n': n, 'w': w, 'p': round(w / n * 100, 1),
                   'wilson': round(wilson_lower(w, n) * 100, 1),
                   'pval': round(two_sided_p(w, n), 4),
                   'shrunk': round(shrunk(w, n) * 100, 1)})
print('scale:', [(d['k'], d['n'], d['p']) for d in Dscale])

mates.sort(key=lambda x: -x['shrunk'])
OUT = {
    'meta': {'n': N, 'wins': W, 'p0': round(P0 * 100, 1),
             'distinctMates': D_total,
             'famThreshold': 10, 'famCount': len(FAM),
             'prior': K_PRIOR},
    'mates': mates,
    'c2': c2, 'c3': c3, 'c4': c4,
    'scale': Dscale,
}
json.dump(OUT, open(os.path.join(BASE, 'reports', '_mate.json'), 'w', encoding='utf-8'),
          ensure_ascii=False)
print('written')
print('--- top mates by shrunk ---')
for x in mates[:14]:
    print('  %-18s n=%-4d p=%5.1f%% shrunk=%5.1f wilson=%5.1f q=%.3f' %
          (x['name'][:18], x['n'], x['p'], x['shrunk'], x['wilson'], x['q']))
