/**
 * 打法画像：把对局记录汇总成「你是个什么类型的玩家」——时段、战斗风格、英雄池集中度、
 * 稳定性、以及你拿的符文跟版本强势榜的契合度。
 *
 * 只做统计描述，不做心理诊断；每条结论都给出支撑数字与样本量，样本小的会标注出来。
 */
import { loadLolGames } from "./games.js";
import { resolveMe } from "./identity.js";
import { augmentIdsOf, isMayhemGame, myParticipantId } from "./lcu.js";
import { loadData } from "./store.js";

const fmtPct = (v: number, d = 1) => `${v.toFixed(d)}%`;

export async function analyzeMyPlaystyle(): Promise<string> {
  const me = await resolveMe();
  if (!me) {
    return "不知道要分析谁：客户端没开，也没有固定过账号（先在线跑一次 get_my_account_status）。";
  }
  const res = await loadLolGames(me.puuid, 200, me.name);
  const d = loadData();
  const rows = res.games
    .filter(isMayhemGame)
    .map((g: any) => {
      const pid = myParticipantId(g, { puuid: me.puuid, name: me.name.split("#")[0] });
      const p = (g.participants ?? []).find((x: any) => x.participantId === pid) ?? (g.participants ?? [])[0];
      const s: any = p?.stats ?? {};
      const cid = d.championIds[String(p?.championId)];
      return {
        t: g.gameCreation,
        win: s.win === true,
        champ: cid ? d.championById.get(cid.id)?.name ?? cid.name : `英雄#${p?.championId}`,
        kills: s.kills ?? 0,
        deaths: s.deaths ?? 0,
        assists: s.assists ?? 0,
        damage: s.totalDamageDealtToChampions ?? 0,
        gold: s.goldEarned ?? 0,
        minutes: Math.round((g.gameDuration ?? 0) / 60),
        augments: augmentIdsOf(g, pid),
      };
    })
    .sort((a: any, b: any) => a.t - b.t);

  if (!rows.length) return `${me.name}：${res.note}`;

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const avg = (f: (r: any) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
  const winRows = rows.filter((r) => r.win);
  const lossRows = rows.filter((r) => !r.win);
  const avgOf = (arr: any[], f: (r: any) => number) => (arr.length ? arr.reduce((s, r) => s + f(r), 0) / arr.length : 0);

  const out: string[] = [];
  out.push(`【${me.name} 的打法画像】`);
  out.push(`数据：${n} 把海斗（${new Date(rows[0].t).toLocaleDateString("zh-CN")} ~ ${new Date(rows[n - 1].t).toLocaleDateString("zh-CN")}），胜率 ${fmtPct((wins / n) * 100)}（海斗中位线 50%）。`);
  out.push(`来源：${res.note}`);
  out.push("");

  // 1) 时段
  const hourBuckets = [
    { label: "凌晨 0-5", from: 0 },
    { label: "上午 6-11", from: 6 },
    { label: "下午 12-17", from: 12 },
    { label: "晚上 18-23", from: 18 },
  ].map((b) => {
    const s = rows.filter((r) => {
      const h = new Date(r.t).getHours();
      return h >= b.from && h < b.from + 6;
    });
    return { label: b.label, games: s.length, wins: s.filter((r) => r.win).length };
  });
  const busiest = [...hourBuckets].sort((a, b) => b.games - a.games)[0];
  const best = [...hourBuckets].filter((b) => b.games >= 10).sort((a, b) => b.wins / b.games - a.wins / a.games)[0];
  const worst = [...hourBuckets].filter((b) => b.games >= 10).sort((a, b) => a.wins / a.games - b.wins / b.games)[0];
  out.push("① 什么时候打");
  out.push(
    `  ${hourBuckets.map((b) => `${b.label} ${b.games} 把${b.games ? `（${fmtPct((b.wins / b.games) * 100, 0)}）` : ""}`).join(" · ")}`
  );
  out.push(`  最常打：${busiest.label}（${busiest.games} 把）`);
  if (best && worst && best.label !== worst.label) {
    out.push(
      `  样本 ≥10 把的时段里，最好 ${best.label} ${fmtPct((best.wins / best.games) * 100, 0)}、最差 ${worst.label} ${fmtPct((worst.wins / worst.games) * 100, 0)}` +
        `（样本小，仅供参考；想看更稳的结论就多攒几把）`
    );
  }
  out.push("");

  // 2) 战斗风格
  const kda = (avgOf(rows, (r) => r.kills) + avgOf(rows, (r) => r.assists)) / Math.max(avgOf(rows, (r) => r.deaths), 0.1);
  const dmgPerMin = avg((r) => r.damage) / Math.max(1, avg((r) => r.minutes));
  const kdaWin = (avgOf(winRows, (r) => r.kills) + avgOf(winRows, (r) => r.assists)) / Math.max(avgOf(winRows, (r) => r.deaths), 0.1);
  const kdaLoss = lossRows.length
    ? (avgOf(lossRows, (r) => r.kills) + avgOf(lossRows, (r) => r.assists)) / Math.max(avgOf(lossRows, (r) => r.deaths), 0.1)
    : 0;
  out.push("② 战斗风格");
  out.push(
    `  场均 ${avgOf(rows, (r) => r.kills).toFixed(1)}/${avgOf(rows, (r) => r.deaths).toFixed(1)}/${avgOf(rows, (r) => r.assists).toFixed(1)}（KDA ${kda.toFixed(2)}）· 伤害 ${Math.round(avg((r) => r.damage) / 1000)}k · 每分钟伤害 ${Math.round(dmgPerMin)}`
  );
  out.push(
    `  赢局 KDA ${kdaWin.toFixed(2)} vs 输局 ${kdaLoss.toFixed(2)} —— ${
      kdaWin - kdaLoss > 1.2 ? "胜负手感差距大，属于高波动型" : "胜负局表现接近，属于稳定型"
    }`
  );
  const heavy = avgOf(rows, (r) => r.deaths) >= 8;
  out.push(`  场均阵亡 ${avgOf(rows, (r) => r.deaths).toFixed(1)}（${heavy ? "偏激进：每局都在换命" : "偏稳健"}）`);
  out.push("");

  // 3) 英雄池
  const champCount = new Map<string, { g: number; w: number }>();
  for (const r of rows) {
    const c = champCount.get(r.champ) ?? { g: 0, w: 0 };
    c.g++;
    if (r.win) c.w++;
    champCount.set(r.champ, c);
  }
  const sortedChamps = [...champCount.entries()].sort((a, b) => b[1].g - a[1].g);
  const top3Share = sortedChamps.slice(0, 3).reduce((s, [, v]) => s + v.g, 0) / n;
  const onlyOne = sortedChamps.filter(([, v]) => v.g === 1).length;
  out.push("③ 英雄池");
  out.push(
    `  玩过 ${sortedChamps.length} 个英雄，Top3 占 ${fmtPct(top3Share * 100, 0)}（${sortedChamps
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v.g} 把`)
      .join("、")}），只玩过 1 把的有 ${onlyOne} 个`
  );
  const bestChamps = sortedChamps.filter(([, v]) => v.g >= 5).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g);
  const worstChamps = [...bestChamps].reverse();
  if (bestChamps.length) {
    out.push(
      `  样本 ≥5 把里：最顺 ${bestChamps.slice(0, 3).map(([k, v]) => `${k} ${fmtPct((v.w / v.g) * 100, 0)}`).join("、")}` +
        `；最卡 ${worstChamps.slice(0, 3).map(([k, v]) => `${k} ${fmtPct((v.w / v.g) * 100, 0)}`).join("、")}`
    );
  }
  out.push("");

  // 4) 稳定性
  const wins30 = rows.slice(-30).filter((r) => r.win).length;
  const wins60 = rows.slice(-60).filter((r) => r.win).length;
  let lw = 0,
    ll = 0,
    cw = 0,
    cl = 0;
  for (const r of rows) {
    if (r.win) {
      cw++;
      cl = 0;
    } else {
      cl++;
      cw = 0;
    }
    lw = Math.max(lw, cw);
    ll = Math.max(ll, cl);
  }
  out.push("④ 稳定性");
  out.push(`  最长连胜 ${lw}、最长连败 ${ll}`);
  out.push(
    `  最近 30 把 ${wins30}/30（${fmtPct((wins30 / Math.min(30, n)) * 100, 0)}）、最近 60 把 ${wins60}/${Math.min(60, n)}（${fmtPct(
      (wins60 / Math.min(60, n)) * 100,
      0
    )}）、全程 ${fmtPct((wins / n) * 100)}`
  );
  out.push("");

  // 5) 版本契合度：你拿的符文在版本榜的位置
  const augGames: Array<{ games: number; rank: number | null }> = [];
  const augStat = new Map<number, number>();
  for (const r of rows) for (const id of r.augments) augStat.set(id, (augStat.get(id) ?? 0) + 1);
  const totalAugPicks = [...augStat.values()].reduce((a, b) => a + b, 0);
  let rankedPicks = 0;
  let top30Picks = 0;
  let bottomPicks = 0;
  for (const [id, count] of augStat) {
    const a = d.augments.find((x) => x.officialId === id);
    if (!a?.stats?.rank) continue;
    rankedPicks += count;
    if (a.stats.rank <= 30) top30Picks += count;
    if (a.stats.rank > 100) bottomPicks += count;
  }
  out.push("⑤ 版本契合度（你拿的符文 vs 社区站强度榜）");
  if (rankedPicks) {
    out.push(
      `  有榜单数据的符文选择共 ${rankedPicks} 次：前 30 名占 ${fmtPct((top30Picks / rankedPicks) * 100, 0)}、100 名以后占 ${fmtPct(
        (bottomPicks / rankedPicks) * 100,
        0
      )}`
    );
    out.push(
      `  ${top30Picks / rankedPicks >= 0.45 ? "选符文的版本意识不错" : "选符文时对版本名次的参考还不多 —— 版本前 30 名的符文通常更稳"}`
    );
  } else {
    out.push("  这批对局里没读到带榜单数据的符文选择。");
  }
  if (augGames.length) out.push("");
  out.push(`（提醒：单个结论的样本量都不大，样本 <10 的已经标注；想看更准的画像就多攒几局 —— 归档会随每次查询自动累积。）`);
  return out.join("\n");
}
