# -*- coding: utf-8 -*-
"""队友进阶分析：
  1. 队友表现分（同队时的场均伤害/KDA/承伤/队内伤害名次）—— 用于区分「他很强」和「运气好」
  2. 条件胜率：控制共现（A 在场时，B 在不在场，分别什么胜率）
  3. 2/3/4/5 人排的最高胜率组合
  4. 最厉害 / 最菜的队友
"""
import pathlib
import json, math, os
from collections import defaultdict

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

N = len(mine); W = sum(1 for _, p in mine if p['stats'].get('win'))
P0 = W / N
ALPHA = P0 * 20.0; BETA = (1 - P0) * 20.0
print('games=%d p0=%.4f' % (N, P0))


def Phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def tsp(w, n):
    if n == 0:
        return 1.0
    se = math.sqrt(P0 * (1 - P0) / n)
    return max(1e-12, min(1.0, 2 * (1 - Phi(abs(w / n - P0) / se))))


def wilson(w, n, z=1.96):
    if n == 0:
        return 0.0
    p = w / n; d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c - r) / d


def shrunken(w, n):
    return (w + ALPHA) / (n + ALPHA + BETA)


def bh(ps):
    n = len(ps); order = sorted(range(n), key=lambda i: ps[i])
    q = [1.0] * n; prev = 1.0
    for rank in range(n - 1, -1, -1):
        i = order[rank]
        prev = min(prev, ps[i] * n / (rank + 1))
        q[i] = prev
    return q


# ---------- 1. 队友表现 ----------
M = defaultdict(lambda: {'n': 0, 'w': 0, 'name': '', 'dmg': 0, 'k': 0, 'd': 0, 'a': 0,
                         'tank': 0, 'gold': 0, 'rank': 0, 'last': 0})
for m, me in mine:
    win = me['stats'].get('win'); tid = me['teamId']
    team = [p for p in m['participants'] if p['teamId'] == tid]
    order = sorted(team, key=lambda p: -(p['stats'].get('totalDamageDealtToChampions') or 0))
    rankof = {p['puuid']: i + 1 for i, p in enumerate(order)}
    for p in team:
        if p['puuid'] == DD:
            continue
        e = M[p['puuid']]; s = p['stats']
        e['n'] += 1; e['w'] += 1 if win else 0
        if p.get('name'):
            e['name'] = p['name']
        e['dmg'] += s.get('totalDamageDealtToChampions') or 0
        e['k'] += s.get('kills') or 0
        e['d'] += s.get('deaths') or 0
        e['a'] += s.get('assists') or 0
        e['tank'] += s.get('totalDamageTaken') or 0
        e['gold'] += s.get('goldEarned') or 0
        e['rank'] += rankof.get(p['puuid'], 3)
        e['last'] = max(e['last'], m.get('gameCreation', 0))

perf = []
for pu, e in M.items():
    n = e['n']
    if n < 15:
        continue
    kda = (e['k'] + e['a']) / max(e['d'], 1)
    perf.append({'puuid': pu, 'name': e['name'] or '(未知)', 'n': n, 'w': e['w'],
                 'p': round(e['w'] / n * 100, 1), 'shrunk': round(shrunken(e['w'], n) * 100, 1),
                 'wilson': round(wilson(e['w'], n) * 100, 1), 'pval': tsp(e['w'], n),
                 'dmg': round(e['dmg'] / n), 'kda': round(kda, 2),
                 'death': round(e['d'] / n, 1), 'assist': round(e['a'] / n, 1),
                 'tank': round(e['tank'] / n), 'gold': round(e['gold'] / n),
                 'teamRank': round(e['rank'] / n, 2)})
qs = bh([x['pval'] for x in perf])
for x, q in zip(perf, qs):
    x['q'] = round(q, 3)
print('perf mates (n>=15):', len(perf))

# ---------- 2. 条件胜率（控制共现） ----------
name2pu = {e['name']: pu for pu, e in M.items() if e['name']}


def cond(pa, pb):
    both = [0, 0]; onlya = [0, 0]
    for m, me in mine:
        tid = me['teamId']; win = me['stats'].get('win')
        pus = {p['puuid'] for p in m['participants'] if p['teamId'] == tid}
        if pa not in pus:
            continue
        tgt = both if pb in pus else onlya
        tgt[0] += 1; tgt[1] += 1 if win else 0
    def pack(v):
        return {'n': v[0], 'w': v[1], 'p': round(v[1] / v[0] * 100, 1) if v[0] else None,
                'wilson': round(wilson(v[1], v[0]) * 100, 1) if v[0] else None}
    return pack(both), pack(onlya)


COND = []
for a, b in [('AQword', '今人不见古时月'), ('今人不见古时月', 'AQword'),
             ('AQword', '加藤惠99'), ('加藤惠99', 'AQword'),
             ('AQword', '下棋高手'), ('AQword', 'Ybac1')]:
    pa, pb = name2pu.get(a), name2pu.get(b)
    if not pa or not pb:
        continue
    both, only = cond(pa, pb)
    COND.append({'a': a, 'b': b, 'both': both, 'onlyA': only})

# ---------- 3. 2/3/4/5 人排最佳组合 ----------
def combos(k):
    out = defaultdict(lambda: [0, 0])
    for m, me in mine:
        win = me['stats'].get('win'); tid = me['teamId']
        ms = sorted(p['puuid'] for p in m['participants']
                    if p['teamId'] == tid and p['puuid'] != DD)
        if len(ms) < k:
            continue
        if k == 1:
            for x in ms:
                c = out[(x,)]; c[0] += 1; c[1] += 1 if win else 0
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


namef = {pu: e['name'] for pu, e in M.items()}
BEST = {}
for k, minn in [(1, 20), (2, 8), (3, 6), (4, 5)]:
    raw = combos(k)
    items = []
    for key, (n, w) in raw.items():
        if n < minn:
            continue
        items.append({'names': [namef.get(p, '?') for p in key], 'n': n, 'w': w,
                      'p': round(w / n * 100, 1), 'shrunk': round(shrunken(w, n) * 100, 1),
                      'wilson': round(wilson(w, n) * 100, 1), 'pval': tsp(w, n)})
    if items:
        qs = bh([x['pval'] for x in items])
        for x, q in zip(items, qs):
            x['q'] = round(q, 3)
    items.sort(key=lambda x: -x['shrunk'])
    BEST[str(k)] = items
    print('party %d (我+%d): %d combos' % (k + 1, k, len(items)))

OUT = {'perf': perf, 'cond': COND, 'best': BEST,
       'meta': {'n': N, 'wins': W, 'p0': round(P0 * 100, 1), 'minN': 15}}
json.dump(OUT, open(os.path.join(BASE, 'reports', '_mate2.json'), 'w', encoding='utf-8'),
          ensure_ascii=False)
print('written')
print('--- top by kda ---')
for x in sorted(perf, key=lambda z: -z['kda'])[:6]:
    print('  %-16s n=%-3d kda=%.2f dmg=%d rank=%.2f p=%.1f%% q=%.3f' %
          (x['name'][:16], x['n'], x['kda'], x['dmg'], x['teamRank'], x['p'], x['q']))
