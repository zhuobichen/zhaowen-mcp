# -*- coding: utf-8 -*-
"""生成 自己的丁ding#66595 海斗深度分析 HTML 报告（v2：装备/符文/定位/聚类 + 折叠明细）。"""
import pathlib
import csv, json, math, random, os
from collections import defaultdict, Counter

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
CSV = os.path.join(BASE, "reports", "海斗对局明细-自己的丁ding#66595-20260927.csv")
OUT = os.path.join(BASE, "reports", "海斗深度分析-自己的丁ding-66595.html")

ROLE_CN = {'fighter': '战士', 'tank': '坦克', 'mage': '法师', 'assassin': '刺客',
           'marksman': '射手', 'support': '辅助'}
RARITY_CN = {'silver': '银色', 'gold': '金色', 'prismatic': '棱彩', 'unknown': '未知'}


def num(v):
    v = (v or '').strip()
    if v == '':
        return None
    try:
        return float(v)
    except ValueError:
        return None


rows = list(csv.DictReader(open(CSV, encoding='utf-8-sig', newline='')))
for r in rows:
    r['_dur'] = num(r['时长(分)']); r['_dmg'] = num(r['伤害'])
    r['_tank'] = num(r['承伤']); r['_gold'] = num(r['金币'])
    r['_cs'] = num(r['补刀']); r['_k'] = num(r['击杀'])
    r['_d'] = num(r['死亡']); r['_a'] = num(r['助攻'])
    r['_rank'] = num(r['队内伤害名次'])
    r['_win'] = 1 if r['结果'] == '胜' else 0

N = len(rows); W = sum(r['_win'] for r in rows); P0 = W / N
SE0 = math.sqrt(P0 * (1 - P0) / N)


def rate(rs):
    n = len(rs)
    if not n:
        return 0, 0.0, 0.0
    w = sum(r['_win'] for r in rs); p = w / n
    return n, p, (p - P0) / math.sqrt(P0 * (1 - P0) / n)


def avg(rs, key):
    vs = [r[key] for r in rs if r[key] is not None]
    return (sum(vs) / len(vs)) if vs else 0.0


win = [r for r in rows if r['_win']]
los = [r for r in rows if not r['_win']]
byh = defaultdict(list)
for r in rows:
    byh[r['英雄']].append(r)

CH = json.load(open(os.path.join(BASE, 'data/champions.json'), encoding='utf-8'))
by_ep = {c['epithet']: c for c in CH}
ITEMS = json.load(open(os.path.join(BASE, 'data/items.json'), encoding='utf-8'))
item_by_name = {}
for v in ITEMS.values():
    item_by_name.setdefault(v.get('name', ''), v)
AUGS = json.load(open(os.path.join(BASE, 'data/augments.json'), encoding='utf-8'))
aug_by_name = {}
for a in AUGS:
    for nm in (a.get('name'), a.get('nameCommunity'), a.get('nameOfficial')):
        if nm:
            aug_by_name.setdefault(nm, a)

D = {}
D['meta'] = {'account': '自己的丁ding#66595', 'n': N, 'wins': W,
             'p0': round(P0 * 100, 1), 'se': round(SE0 * 100, 2),
             'first': min(r['日期'] for r in rows if r['日期']),
             'last': max(r['日期'] for r in rows if r['日期'])}

D['death'] = []
for lo, hi, lab in [(0, 5, '0–5'), (6, 8, '6–8'), (9, 11, '9–11'), (12, 14, '12–14'), (15, 99, '15+')]:
    sub = [r for r in rows if r['_d'] is not None and lo <= r['_d'] <= hi]
    n, p, z = rate(sub)
    if n:
        D['death'].append({'label': lab, 'n': n, 'p': round(p * 100, 1), 'z': round(z, 2),
                           'dmg': round(avg(sub, '_dmg') / 1000, 1)})

DU = [(0, 14, '短局 ≤14 分'), (15, 20, '中局 15–20 分'), (21, 999, '长局 21 分+')]
D['deathDur'] = {'cats': [l for _, _, l in DU], 'cnt': [], 'series': []}
s_lo, s_hi = [], []
for dlo, dhi, lab in DU:
    lay = [r for r in rows if r['_dur'] is not None and dlo <= r['_dur'] <= dhi]
    D['deathDur']['cnt'].append(len(lay))
    a = [r for r in lay if r['_d'] is not None and r['_d'] <= 8]
    b = [r for r in lay if r['_d'] is not None and r['_d'] >= 9]
    na, pa, _ = rate(a); nb, pb, _ = rate(b)
    s_lo.append({'p': round(pa * 100, 1), 'n': na}); s_hi.append({'p': round(pb * 100, 1), 'n': nb})
D['deathDur']['series'] = [{'name': '死亡 ≤8', 'vals': s_lo}, {'name': '死亡 ≥9', 'vals': s_hi}]

AD = [(0, 19, '<20'), (20, 27, '20–27'), (28, 35, '28–35'), (36, 999, '36+')]
D['assistDur'] = {'cats': [l for _, _, l in DU], 'cnt': D['deathDur']['cnt'], 'series': []}
for alo, ahi, alab in AD:
    vals = []
    for dlo, dhi, dlab in DU:
        sub = [r for r in rows if r['_dur'] is not None and dlo <= r['_dur'] <= dhi
               and r['_a'] is not None and alo <= r['_a'] <= ahi]
        n, p, z = rate(sub)
        vals.append({'p': round(p * 100, 1), 'n': n})
    D['assistDur']['series'].append({'name': '助攻 ' + alab, 'vals': vals})

D['rank'] = []
for k in [1, 2, 3, 4, 5]:
    sub = [r for r in rows if r['_rank'] == k]
    n, p, z = rate(sub)
    D['rank'].append({'label': '第 ' + str(k) + ' 名', 'n': n, 'p': round(p * 100, 1),
                      'z': round(z, 2), 'diff': round((p - P0) * 100, 1)})

D['firstDeath'] = []
for lo, hi, lab in [(0, 5, '死亡 0–5'), (6, 8, '死亡 6–8'), (9, 11, '死亡 9–11'), (12, 99, '死亡 12+')]:
    sub = [r for r in rows if r['_rank'] == 1 and r['_d'] is not None and lo <= r['_d'] <= hi]
    n, p, z = rate(sub)
    if n:
        D['firstDeath'].append({'label': lab, 'n': n, 'p': round(p * 100, 1), 'z': round(z, 2),
                                'dur': round(avg(sub, '_dur'), 1), 'dmg': round(avg(sub, '_dmg') / 1000, 1)})

D['firstHero'] = []
for h, rs in byh.items():
    a = [r for r in rs if r['_rank'] == 1]
    b = [r for r in rs if r['_rank'] and r['_rank'] > 1]
    if len(a) >= 5 and len(b) >= 5:
        wa = sum(r['_win'] for r in a) / len(a); wb = sum(r['_win'] for r in b) / len(b)
        D['firstHero'].append({'h': h, 'na': len(a), 'pa': round(wa * 100, 1),
                               'nb': len(b), 'pb': round(wb * 100, 1), 'gap': round((wa - wb) * 100, 1)})
D['firstHero'].sort(key=lambda x: x['gap'])

MET = [('场均伤害', '_dmg', 0), ('场均承伤', '_tank', 0), ('场均金币', '_gold', 0),
       ('场均击杀', '_k', 1), ('场均死亡', '_d', 1), ('场均助攻', '_a', 1),
       ('场均补刀', '_cs', 1), ('场均时长(分)', '_dur', 1)]
D['metrics'] = []
for lab, key, dec in MET:
    a = avg(win, key); b = avg(los, key)
    D['metrics'].append({'label': lab, 'win': round(a, dec), 'los': round(b, dec), 'dec': dec,
                         'diff': round(a - b, dec), 'rel': round((a - b) / b * 100, 1) if b else 0})

D['heroes'] = []
for h, rs in byh.items():
    if len(rs) >= 15:
        n, p, z = rate(rs)
        c = by_ep.get(h, {})
        D['heroes'].append({'h': h, 'n': n, 'p': round(p * 100, 1), 'z': round(z, 2),
                            'diff': round((p - P0) * 100, 1), 'd': round(avg(rs, '_d'), 1),
                            'dmg': round(avg(rs, '_dmg') / 1000, 1),
                            'tank': round(avg(rs, '_tank') / 1000, 1),
                            'dur': round(avg(rs, '_dur'), 1),
                            'roles': c.get('roles', []),
                            'cnRole': ROLE_CN.get((c.get('roles') or [''])[0], '')})
D['heroes'].sort(key=lambda x: -x['n'])

bym = defaultdict(list)
for r in rows:
    if r['日期']:
        bym[r['日期'][:7]].append(r)
D['months'] = []
for m in sorted(bym):
    n, p, z = rate(bym[m])
    D['months'].append({'m': m, 'n': n, 'p': round(p * 100, 1), 'z': round(z, 2),
                        'dmg': round(avg(bym[m], '_dmg') / 1000, 1), 'd': round(avg(bym[m], '_d'), 1)})

# ---------- 新增 1：英雄定位类别 ----------
role_rows = defaultdict(list)
for h, rs in byh.items():
    c = by_ep.get(h, {})
    rl = c.get('roles') or []
    if rl:
        role_rows[rl[0]].extend(rs)
D['roles'] = []
for rk, rs in role_rows.items():
    n, p, z = rate(rs)
    heroes = sorted({r['英雄'] for r in rs})
    D['roles'].append({'key': rk, 'cn': ROLE_CN.get(rk, rk), 'n': n, 'p': round(p * 100, 1),
                       'z': round(z, 2), 'diff': round((p - P0) * 100, 1),
                       'd': round(avg(rs, '_d'), 1), 'dmg': round(avg(rs, '_dmg') / 1000, 1),
                       'tank': round(avg(rs, '_tank') / 1000, 1),
                       'heroes': heroes[:14], 'nh': len(heroes)})
D['roles'].sort(key=lambda x: -x['p'])
# 多标签计数版（一个英雄可进多个 role）
multi = defaultdict(list)
for h, rs in byh.items():
    for rk in (by_ep.get(h, {}).get('roles') or []):
        multi[rk].extend(rs)
D['rolesMulti'] = []
for rk, rs in multi.items():
    n, p, z = rate(rs)
    D['rolesMulti'].append({'cn': ROLE_CN.get(rk, rk), 'n': n, 'p': round(p * 100, 1), 'z': round(z, 2)})
D['rolesMulti'].sort(key=lambda x: -x['p'])

# ---------- 新增 2：K-means 聚类 ----------
FEAT = [('_dmg', '伤害'), ('_tank', '承伤'), ('_d', '死亡'), ('_dur', '时长')]
hlist = []
for h, rs in byh.items():
    if len(rs) >= 15:
        hlist.append({'h': h, 'n': len(rs),
                      'v': [avg(rs, k) for k, _ in FEAT],
                      'p': sum(r['_win'] for r in rs) / len(rs)})
cols = list(zip(*[x['v'] for x in hlist]))
mu = [sum(c) / len(c) for c in cols]
sd = [math.sqrt(sum((x - mu[i]) ** 2 for x in cols[i]) / len(cols[i])) or 1 for i in range(len(cols))]
Z = [[(x['v'][i] - mu[i]) / sd[i] for i in range(len(mu))] for x in hlist]


def kmeans(pts, k, seed=42, iters=300):
    rnd = random.Random(seed)
    cents = [list(pts[rnd.randrange(len(pts))])]
    for _ in range(k - 1):
        d2 = [min(sum((p[j] - c[j]) ** 2 for j in range(len(p))) for c in cents) for p in pts]
        tot = sum(d2); r = rnd.random() * tot; acc = 0
        for i, v in enumerate(d2):
            acc += v
            if acc >= r:
                cents.append(list(pts[i])); break
        else:
            cents.append(list(pts[-1]))
    lab = [0] * len(pts)
    for _ in range(iters):
        newlab = [min(range(k), key=lambda ci: sum((p[j] - cents[ci][j]) ** 2 for j in range(len(p))))
                  for p in pts]
        newc = []
        for ci in range(k):
            mem = [p for p, l in zip(pts, newlab) if l == ci]
            newc.append([sum(p[j] for p in mem) / len(mem) for j in range(len(pts[0]))] if mem else cents[ci])
        if newlab == lab and newc == cents:
            break
        lab, cents = newlab, newc
    return lab, cents


K = 4
labels, cents = kmeans(Z, K)
clusters = []
for ci in range(K):
    mem = [h for h, l in zip(hlist, labels) if l == ci]
    if not mem:
        continue
    nn = sum(m['n'] for m in mem)
    ww = sum(round(m['p'] * m['n']) for m in mem)
    prof = {}
    for i, (_, cn) in enumerate(FEAT):
        prof[cn] = round((cents[ci][i] * sd[i] + mu[i]) / (1000 if FEAT[i][0] in ('_dmg', '_tank') else 1), 1)
    clusters.append({
        'id': ci, 'size': len(mem), 'games': nn, 'p': round(ww / nn * 100, 1),
        'z': round((ww / nn - P0) / math.sqrt(P0 * (1 - P0) / nn), 2),
        'prof': prof,
        'heroes': sorted([m['h'] for m in mem], key=lambda h: -len(byh[h])),
    })
D['clusters'] = clusters
D['bubble'] = [{'h': x['h'], 'n': x['n'], 'dmg': round(x['v'][0] / 1000, 1),
                'tank': round(x['v'][1] / 1000, 1), 'd': round(x['v'][2], 1),
                'dur': round(x['v'][3], 1), 'p': round(x['p'] * 100, 1),
                'cl': labels[i], 'roles': by_ep.get(x['h'], {}).get('roles', [])}
               for i, x in enumerate(hlist)]
D['featNames'] = [cn for _, cn in FEAT]

# ---------- 新增 3：装备胜率（只算成装，排除鞋/消耗品） ----------
def item_ok(name):
    v = item_by_name.get(name)
    if v is None:
        return None
    cats = v.get('categories', [])
    if 'Boots' in cats or 'Consumable' in cats or 'Vision' in cats:
        return False
    return v.get('price', 0) >= 2200


eq = {}
unknown_items = Counter()
for r in rows:
    seen = set()
    for i in range(1, 7):
        v = (r.get('装备%d' % i) or '').strip()
        if not v or v in seen:
            continue
        seen.add(v)
        ok = item_ok(v)
        if ok is None:
            unknown_items[v] += 1
            continue
        if not ok:
            continue
        e = eq.setdefault(v, [0, 0])
        e[0] += 1; e[1] += r['_win']
D['items'] = []
for name, (n, w) in eq.items():
    if n >= 15:
        p = w / n
        D['items'].append({'name': name, 'n': n, 'p': round(p * 100, 1),
                           'diff': round((p - P0) * 100, 1),
                           'z': round((p - P0) / math.sqrt(P0 * (1 - P0) / n), 2),
                           'price': item_by_name.get(name, {}).get('price', 0)})
D['items'].sort(key=lambda x: -x['diff'])
D['itemUnknown'] = unknown_items.most_common(6)

# ---------- 新增 4：符文胜率 ----------
aq = {}
for r in rows:
    seen = set()
    for i in range(1, 7):
        v = (r.get('符文%d' % i) or '').strip()
        if not v or v in seen:
            continue
        seen.add(v)
        e = aq.setdefault(v, [0, 0]); e[0] += 1; e[1] += r['_win']
D['augments'] = []
for name, (n, w) in aq.items():
    if n >= 20:
        p = w / n
        meta = aug_by_name.get(name, {})
        st = meta.get('stats') or {}
        D['augments'].append({'name': name, 'n': n, 'p': round(p * 100, 1),
                              'diff': round((p - P0) * 100, 1),
                              'z': round((p - P0) / math.sqrt(P0 * (1 - P0) / n), 2),
                              'rarity': RARITY_CN.get(meta.get('rarity', ''), '—'),
                              'rank': st.get('rank', ''),
                              'wr': st.get('winRate', '')})
D['augments'].sort(key=lambda x: -x['diff'])
ar = defaultdict(list)
for name, (n, w) in aq.items():
    meta = aug_by_name.get(name, {})
    rk = meta.get('rarity', 'unknown')
    ar[rk].append((n, w))
D['augRarity'] = []
for rk, lst in ar.items():
    nn = sum(n for n, _ in lst); ww = sum(w for _, w in lst)
    if nn:
        D['augRarity'].append({'cn': RARITY_CN.get(rk, rk), 'n': nn, 'p': round(ww / nn * 100, 1)})
D['augRarity'].sort(key=lambda x: -x['p'])
D['augRarityNote'] = ('按「每件符文的出现次数」加权，一件符文在一局里只算一次；'
                      '同一局 6 个符文槽混着不同品质，所以这是「槽位加权」而不是「品质对比实验」。')

# ---------- 每局明细 ----------
D['games'] = []
for r in rows:
    D['games'].append([
        r['日期'], r['英雄'], r['结果'],
        int(num(r['击杀']) or 0), int(num(r['死亡']) or 0), int(num(r['助攻']) or 0),
        int(num(r['伤害']) or 0), int(num(r['承伤']) or 0), int(num(r['金币']) or 0),
        int(num(r['补刀']) or 0), int(num(r['时长(分)']) or 0), int(num(r['队内伤害名次']) or 0),
        ' · '.join([(r.get('符文%d' % i) or '').strip() for i in range(1, 7)
                    if (r.get('符文%d' % i) or '').strip()]),
        ' · '.join([(r.get('装备%d' % i) or '').strip() for i in range(1, 7)
                    if (r.get('装备%d' % i) or '').strip()])])

JSON_DATA = json.dumps(D, ensure_ascii=False, separators=(',', ':'))
print('data ready. items=%d augments=%d roles=%d clusters=%d' %
      (len(D['items']), len(D['augments']), len(D['roles']), len(D['clusters'])))
json.dump(D, open(os.path.join(BASE, 'reports', '_report_data.json'), 'w', encoding='utf-8'),
          ensure_ascii=False)
print('intermediate json written')
