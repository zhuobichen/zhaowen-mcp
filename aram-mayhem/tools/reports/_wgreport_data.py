# -*- coding: utf-8 -*-
"""整理 WeGame 500 局数据 → 供补充报告 HTML 使用。"""
import pathlib
import json, os, datetime
from collections import defaultdict, Counter
import numpy as np

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
D = json.load(open(os.path.join(BASE, 'reports', '_wgfull.json'), encoding='utf-8'))
H = {str(b['game_id']): b for b in json.load(open(os.path.join(BASE, 'reports', '_wghistory.json'), encoding='utf-8'))}
ME = '自己的丁ding'
CIDS = json.load(open(os.path.join(BASE, 'data', 'champion-ids.json'), encoding='utf-8'))


def cname(cid):
    v = CIDS.get(str(cid)) or {}
    return v.get('name') or ('#' + str(cid))


def norm(n):
    return (n or '').split('#')[0].strip()


# ---- 我的每局 ----
me = {}
for gid, rec in D.items():
    for p in rec.get('players') or []:
        if ME in (p.get('name') or ''):
            me[gid] = p
            break

mn = len(me)
mw = sum(1 for p in me.values() if p.get('win') == 'Win')
mmvp = sum(1 for p in me.values() if p.get('mvp'))
msvp = sum(1 for p in me.values() if p.get('svp'))
scores = [p['gameScore'] for p in me.values() if p.get('gameScore')]
print('我的局数 %d 胜率 %.1f%% MVP %d SVP %d' % (mn, mw / mn * 100, mmvp, msvp))

# 分位
qs = np.percentile(scores, [5, 25, 50, 75, 95]).round(0).astype(int).tolist()

# 直方图
lo, hi = min(scores), max(scores)
bins = 14
hist = [0] * bins
for s in scores:
    i = min(bins - 1, int((s - lo) / (hi - lo + 1e-9) * bins))
    hist[i] += 1
hist_axis = [round(lo + (hi - lo) * (i + 0.5) / bins) for i in range(bins)]

# 胜/负均分
wsc = [p['gameScore'] for p in me.values() if p.get('win') == 'Win' and p.get('gameScore')]
lsc = [p['gameScore'] for p in me.values() if p.get('win') == 'Fail' and p.get('gameScore')]

# 月度
bym = defaultdict(list)
for gid, p in me.items():
    h = H.get(gid) or {}
    t = h.get('game_start_time')
    if not t:
        continue
    d = datetime.datetime.fromtimestamp(int(t) / 1000)
    bym[d.strftime('%Y-%m')].append(p)
months = []
for m in sorted(bym):
    rs = bym[m]
    sc = [x['gameScore'] for x in rs if x.get('gameScore')]
    wn = sum(1 for x in rs if x.get('win') == 'Win')
    months.append({'m': m, 'n': len(rs), 'wr': round(wn / len(rs) * 100, 1),
                   'score': round(sum(sc) / len(sc)) if sc else 0,
                   'mvp': sum(1 for x in rs if x.get('mvp')),
                   'svp': sum(1 for x in rs if x.get('svp'))})

# ---- 组队人数 ----
party = []
bysize = defaultdict(list)
for gid, p in me.items():
    h = H.get(gid) or {}
    sz = h.get('team_made_size')
    if sz:
        bysize[sz].append(p)
for sz in sorted(bysize):
    rs = bysize[sz]
    sc = [x['gameScore'] for x in rs if x.get('gameScore')]
    wn = sum(1 for x in rs if x.get('win') == 'Win')
    party.append({'size': sz, 'n': len(rs), 'wr': round(wn / len(rs) * 100, 1),
                  'score': round(sum(sc) / len(sc)) if sc else 0,
                  'mvp': sum(1 for x in rs if x.get('mvp')),
                  'svp': sum(1 for x in rs if x.get('svp'))})

# ---- 队友 ----
mate = defaultdict(lambda: {'n': 0, 'w': 0, 'mvp': 0, 'svp': 0, 's': 0, 'k': 0, 'd': 0, 'a': 0, 'dmg': 0})
for gid, rec in D.items():
    mp = me.get(gid)
    if not mp:
        continue
    myteam = mp.get('teamId')
    for p in rec.get('players') or []:
        if ME in (p.get('name') or '') or p.get('teamId') != myteam:
            continue
        e = mate[norm(p.get('name'))]
        e['n'] += 1
        e['w'] += 1 if mp.get('win') == 'Win' else 0
        e['mvp'] += 1 if p.get('mvp') else 0
        e['svp'] += 1 if p.get('svp') else 0
        e['s'] += p.get('gameScore') or 0
        e['k'] += p.get('championsKilled') or 0
        e['d'] += p.get('numDeaths') or 0
        e['a'] += p.get('assists') or 0
        e['dmg'] += p.get('totalDamageToChampions') or 0
mates = []
for nm, e in mate.items():
    if e['n'] < 8:
        continue
    n = e['n']
    kda = (e['k'] + e['a']) / max(e['d'], 1)
    mates.append({'name': nm, 'n': n, 'w': e['w'], 'wr': round(e['w'] / n * 100, 1),
                  'mvp': e['mvp'], 'svp': e['svp'], 'rate': round((e['mvp'] + e['svp']) / n * 100, 1),
                  'avgScore': round(e['s'] / n), 'kda': round(kda, 2), 'dmg': round(e['dmg'] / n)})
mates.sort(key=lambda x: -x['avgScore'])

# 相关：官方分 vs 同队胜率
xs = [m['avgScore'] for m in mates]; ys = [m['wr'] for m in mates]
corr = float(np.corrcoef(xs, ys)[0, 1]) if len(mates) >= 3 else 0

# ---- 我的英雄 ----
hc = defaultdict(lambda: {'n': 0, 'w': 0, 's': 0})
for gid, p in me.items():
    c = p.get('championId')
    e = hc[c]
    e['n'] += 1
    e['w'] += 1 if p.get('win') == 'Win' else 0
    e['s'] += p.get('gameScore') or 0
heroes = [{'champ': int(c), 'name': cname(c), 'n': e['n'], 'wr': round(e['w'] / e['n'] * 100, 1),
           'score': round(e['s'] / e['n'])} for c, e in hc.items() if e['n'] >= 8]
heroes.sort(key=lambda x: -x['n'])

OUT = {
    'meta': {'n': mn, 'wins': mw, 'wr': round(mw / mn * 100, 1),
             'mvp': mmvp, 'svp': msvp,
             'mvpRate': round(mmvp / mn * 100, 1), 'svpRate': round(msvp / mn * 100, 1),
             'avgScore': round(sum(scores) / len(scores)), 'minScore': lo, 'maxScore': hi,
             'q': qs,
             'first': min((H.get(g) or {}).get('game_start_time', '0') for g in me),
             'last': max((H.get(g) or {}).get('game_start_time', '0') for g in me)},
    'hist': {'axis': hist_axis, 'counts': hist},
    'winLoss': {'win': round(sum(wsc) / len(wsc)) if wsc else 0,
                'lose': round(sum(lsc) / len(lsc)) if lsc else 0},
    'months': months, 'party': party, 'mates': mates, 'corr': round(corr, 3),
    'heroes': heroes[:16],
}
for k in ('first', 'last'):
    t = OUT['meta'][k]
    OUT['meta'][k] = datetime.datetime.fromtimestamp(int(t) / 1000).strftime('%Y-%m-%d') if t and t != '0' else '—'

json.dump(OUT, open(os.path.join(BASE, 'reports', '_wgreport.json'), 'w', encoding='utf-8'),
          ensure_ascii=False)
print('队友 %d 人 | 相关 r=%.3f' % (len(mates), corr))
print('组队人数:', [(p['size'], p['n'], p['wr']) for p in party])
print('月度:', [(m['m'], m['n'], m['wr'], m['score']) for m in months])
print('saved _wgreport.json')
