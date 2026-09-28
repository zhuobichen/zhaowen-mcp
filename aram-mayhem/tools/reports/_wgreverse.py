# -*- coding: utf-8 -*-
"""逆推 WeGame game_score：全字段回归 + 分组交叉验证 + 分英雄拟合。"""
import pathlib
import json, os
import numpy as np
import pandas as pd

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
D = json.load(open(os.path.join(BASE, 'reports', '_wgfull.json'), encoding='utf-8'))

rows = []
for gid, rec in D.items():
    dur = (rec.get('duration') or 0) / 60.0
    pl = rec.get('players') or []
    if dur <= 0 or len(pl) < 10:
        continue
    for p in pl:
        if p.get('gameScore') is None:
            continue
        rows.append({
            'gid': gid, 'score': p['gameScore'], 'champ': p.get('championId'),
            'dur': dur, 'win': 1 if p.get('win') == 'Win' else 0,
            'k': p.get('championsKilled') or 0, 'd': p.get('numDeaths') or 0,
            'a': p.get('assists') or 0,
            'gold': p.get('goldEarned') or 0, 'goldSpent': p.get('goldSpent') or 0,
            'dmg': p.get('totalDamageToChampions') or 0,
            'phys': p.get('physicalDamageToChampions') or 0,
            'magic': p.get('magicDamageToChampions') or 0,
            'true': p.get('trueDemageToChampions') or 0,
            'dealtAll': p.get('totalDamageDealt') or 0,
            'taken': p.get('totalDamageTaken') or 0,
            'physTaken': p.get('physicalDamageTaken') or 0,
            'magicTaken': p.get('magicDamageTaken') or 0,
            'heal': p.get('totalHealth') or 0,
            'healMate': p.get('totalHealthToMate') or 0,
            'cc': p.get('timeCcingOthers') or 0,
            'deadTime': p.get('totalTimeSpentDead') or 0,
            'turrets': p.get('turretsKilled') or 0, 'hq': p.get('hqKilled') or 0,
            'cs': p.get('minionsKilled') or 0, 'ncs': p.get('neutralMinionsKilled') or 0,
            'level': p.get('level') or 0, 'exp': p.get('exp') or 0,
            'multi': (p.get('doubleKills') or 0) + (p.get('tripleKills') or 0)*2 +
                     (p.get('quadraKills') or 0)*3 + (p.get('pentaKills') or 0)*4,
            'spree': p.get('largestKillingSpree') or 0,
            'items': p.get('itemsPurchased') or 0,
            'vision': p.get('visionScore') or 0,
        })
df = pd.DataFrame(rows)
print('样本:', len(df), '| 局数:', df.gid.nunique())

# 派生
df['kda'] = (df.k + df.a) / df.d.clip(lower=1)
df['dpm'] = df.dmg / df.dur
df['gpm'] = df.gold / df.dur
df['dTaken'] = df.taken / df.dur
df['healpm'] = df.heal / df.dur
df['ccpm'] = df.cc / df.dur
df['deathRate'] = df.d / df.dur

# 相对本局均值
base_cols = ['dmg', 'gold', 'kda', 'd', 'taken', 'heal', 'cc', 'cs', 'k', 'a', 'level', 'dpm', 'gpm']
g = df.groupby('gid')
for c in base_cols:
    m = g[c].transform('mean').clip(lower=1e-9)
    df['rel_' + c] = df[c] / m
    df['rlog_' + c] = np.log1p(df[c]) - np.log1p(m)


def fit(sub, feats, target='score'):
    X = sub[feats].values.astype(float)
    X = np.column_stack([np.ones(len(X)), X])
    y = sub[target].values.astype(float)
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    pred = X @ coef
    ss = ((y - pred) ** 2).sum()
    tot = ((y - y.mean()) ** 2).sum()
    return (1 - ss / tot if tot else 0), coef


def cv(sub, feats, k=5, seed=42):
    gids = sub.gid.unique().copy()
    rng = np.random.RandomState(seed)
    rng.shuffle(gids)
    folds = np.array_split(gids, k)
    out = []
    for f in folds:
        te = sub[sub.gid.isin(f)]
        tr = sub[~sub.gid.isin(f)]
        if len(te) < 10 or len(tr) < 50:
            continue
        _, coef = fit(tr, feats)
        X = np.column_stack([np.ones(len(te)), te[feats].values.astype(float)])
        pred = X @ coef
        y = te['score'].values.astype(float)
        tot = ((y - y.mean()) ** 2).sum()
        out.append(1 - ((y - pred) ** 2).sum() / tot if tot else 0)
    return float(np.mean(out))


SETS = {
    'A 绝对量(全)': ['k', 'd', 'a', 'gold', 'dmg', 'taken', 'heal', 'cc', 'cs', 'turrets', 'multi', 'win', 'dur', 'level'],
    'B 分均化(全)': ['k', 'd', 'a', 'gpm', 'dpm', 'dTaken', 'healpm', 'ccpm', 'cs', 'turrets', 'multi', 'win'],
    'C 相对量(全)': ['rel_k', 'rel_d', 'rel_a', 'rel_gold', 'rel_dmg', 'rel_taken', 'rel_heal',
                     'rel_cc', 'rel_cs', 'rel_level', 'rlog_kda', 'win', 'turrets', 'multi'],
    'D 相对量精简': ['rlog_kda', 'rel_gold', 'rlog_d', 'rlog_dmg', 'rel_taken', 'rlog_heal'],
    'E 相对量+控制/承伤': ['rlog_kda', 'rel_gold', 'rlog_dmg', 'rel_taken', 'rel_heal', 'rel_cc', 'turrets', 'win'],
}
print('\n%-22s %8s %8s' % ('特征集', 'R²(全量)', 'R²(5折CV)'))
for nm, feats in SETS.items():
    r2, _ = fit(df, feats)
    print('%-22s %8.3f %8.3f' % (nm, r2, cv(df, feats)))

# 标准化系数（相对量模型）
feats = SETS['E 相对量+控制/承伤']
r2, coef = fit(df, feats)
print('\n=== 模型E 标准化系数（相对 importance）===')
sd = df[feats].std().values
imp = np.abs(coef[1:] * sd)
imp = imp / imp.sum()
for nm, c, im in sorted(zip(feats, coef[1:], imp), key=lambda x: -x[2]):
    print('  %-14s 系数 %+13.1f   重要性 %.1f%%' % (nm, c, im * 100))

# 分英雄
print('\n=== 分英雄拟合（>=120 条的英雄，用模型E）===')
out = []
for ch, sub in df.groupby('champ'):
    if len(sub) >= 120:
        r2, _ = fit(sub, feats)
        out.append((int(ch), len(sub), r2))
for ch, n, r2 in sorted(out, key=lambda x: -x[1])[:12]:
    print('  英雄 %-5d n=%-5d R²=%.3f' % (ch, n, r2))
if out:
    print('  分英雄 R² 中位数: %.3f   （全池 R²=%.3f）' % (np.median([x[2] for x in out]), r2))
df.to_pickle(os.path.join(BASE, 'reports', '_wgdf.pkl'))
print('\nsaved _wgdf.pkl')
