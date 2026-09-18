/**
 * 跨账号对比：把两个账号的海斗核心指标并排比（支持「我 vs 好友」「好友 vs 好友」）。
 * 只读；数据来自本地归档 ∪ 客户端/SGP。
 */
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { augmentIdsOf, isMayhemGame, myParticipantId } from "./lcu.js";
import { loadData } from "./store.js";

export interface AccountProfile {
  name: string;
  games: number;
  wins: number;
  winRate: number;
  kda: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  minutes: number;
  recentWinRate: number | null;
  topChampions: Array<{ name: string; games: number; winRate: number }>;
  topAugments: Array<{ name: string; games: number; winRate: number }>;
  /** 符文偏好明细：每件出现过 ≥5 次的符文，share = 出现次数 / 总符文槽位（含重复拿多次的局） */
  augmentPrefs: Array<{ name: string; games: number; winRate: number; share: number }>;
  from: number | null;
  to: number | null;
}

export async function profileOf(puuid: string, name: string, limit = 2000): Promise<AccountProfile> {
  const d = loadData();
  const res = await loadLolGames(puuid, limit, name);
  const rows = res.games
    .filter(isMayhemGame)
    .map((g: any) => {
      const pid = myParticipantId(g, { puuid, name: name.split("#")[0] });
      const p = (g.participants ?? []).find((x: any) => x.participantId === pid) ?? (g.participants ?? [])[0];
      const s: any = p?.stats ?? {};
      const cid = d.championIds[String(p?.championId)];
      return {
        t: g.gameCreation ?? 0,
        win: s.win === true,
        champ: cid ? d.championById.get(cid.id)?.name ?? cid.name : `英雄#${p?.championId}`,
        k: Number(s.kills ?? 0),
        dd: Number(s.deaths ?? 0),
        a: Number(s.assists ?? 0),
        dmg: Number(s.totalDamageDealtToChampions ?? 0),
        min: Math.round((g.gameDuration ?? 0) / 60),
        augments: augmentIdsOf(g, pid),
      };
    })
    .sort((x: any, y: any) => x.t - y.t);

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const avg = (f: (r: any) => number) => (n ? rows.reduce((s, r) => s + f(r), 0) / n : 0);
  const bucket = (key: (r: any) => string) => {
    const m = new Map<string, { games: number; wins: number }>();
    for (const r of rows) {
      const k = key(r);
      const c = m.get(k) ?? { games: 0, wins: 0 };
      c.games++;
      if (r.win) c.wins++;
      m.set(k, c);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ name: k, games: v.games, winRate: (v.wins / v.games) * 100 }))
      .sort((a, b) => b.games - a.games);
  };
  const augStat = new Map<number, { games: number; wins: number }>();
  for (const r of rows) {
    for (const id of r.augments) {
      const c = augStat.get(id) ?? { games: 0, wins: 0 };
      c.games++;
      if (r.win) c.wins++;
      augStat.set(id, c);
    }
  }
  const recent = rows.slice(-20);

  const totalSlots = rows.reduce((s2, r) => s2 + r.augments.length, 0);
  const augmentPrefs = [...augStat.entries()]
    .filter(([, v]) => v.games >= 5)
    .map(([id, v]) => ({
      name: d.augments.find((a) => a.officialId === id)?.name ?? `未知符文#${id}`,
      games: v.games,
      winRate: (v.wins / v.games) * 100,
      share: totalSlots ? v.games / totalSlots : 0,
    }))
    .filter((x) => !x.name.startsWith("未知符文")); // 说不出名字的不参与对比

  return {
    name,
    games: n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    kda: (avg((r) => r.k) + avg((r) => r.a)) / Math.max(avg((r) => r.dd), 0.1),
    kills: avg((r) => r.k),
    deaths: avg((r) => r.dd),
    assists: avg((r) => r.a),
    damage: avg((r) => r.dmg),
    minutes: avg((r) => r.min),
    recentWinRate: recent.length ? (recent.filter((r) => r.win).length / recent.length) * 100 : null,
    topChampions: bucket((r) => r.champ).slice(0, 5),
    augmentPrefs,
    topAugments: [...augStat.entries()]
      .map(([id, v]) => ({
        name: d.augments.find((a) => a.officialId === id)?.name ?? `#${id}`,
        games: v.games,
        winRate: (v.wins / v.games) * 100,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 5),
    from: rows[0]?.t ?? null,
    to: rows[n - 1]?.t ?? null,
  };
}

async function resolveOne(who?: string): Promise<{ puuid: string; name: string }> {
  if (!who || /^(me|我)$/i.test(who)) {
    const me = await resolveMe();
    if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");
    return { puuid: me.puuid, name: me.name };
  }
  const r = await resolveAccountByName(who);
  if (!r.matches.length) throw new Error(`没找到「${who}」——${r.note}`);
  if (r.matches.length > 1) throw new Error(`「${who}」匹配到多个账号：${r.matches.map((m) => m.name).join("、")}`);
  return { puuid: r.matches[0].puuid, name: r.matches[0].name };
}

export async function compareAccounts(a: string | undefined, b: string): Promise<string> {
  const [A, B] = await Promise.all([resolveOne(a), resolveOne(b)]);
  const [pa, pb] = await Promise.all([profileOf(A.puuid, A.name), profileOf(B.puuid, B.name)]);
  const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleDateString("zh-CN") : "—");

  const rows: Array<[string, string, string]> = [
    ["海斗局数", `${pa.games}`, `${pb.games}`],
    ["胜率", `${pa.winRate.toFixed(1)}%`, `${pb.winRate.toFixed(1)}%`],
    ["最近 20 把胜率", pa.recentWinRate != null ? `${pa.recentWinRate.toFixed(0)}%` : "—", pb.recentWinRate != null ? `${pb.recentWinRate.toFixed(0)}%` : "—"],
    ["KDA", pa.kda.toFixed(2), pb.kda.toFixed(2)],
    ["场均 K/D/A", `${pa.kills.toFixed(1)}/${pa.deaths.toFixed(1)}/${pa.assists.toFixed(1)}`, `${pb.kills.toFixed(1)}/${pb.deaths.toFixed(1)}/${pb.assists.toFixed(1)}`],
    ["场均伤害", `${Math.round(pa.damage / 1000)}k`, `${Math.round(pb.damage / 1000)}k`],
    ["场均时长", `${pa.minutes.toFixed(0)} 分`, `${pb.minutes.toFixed(0)} 分`],
    ["数据跨度", `${fmtDate(pa.from)} ~ ${fmtDate(pa.to)}`, `${fmtDate(pb.from)} ~ ${fmtDate(pb.to)}`],
  ];

  const w = (s: string) => [...s].reduce((n, c) => n + (/[一-龥＀-￯]/.test(c) ? 2 : 1), 0);
  const pad = (s: string, width: number) => s + " ".repeat(Math.max(0, width - w(s)));
  const colW = Math.max(...rows.flatMap((r) => [w(r[0]), w(r[1]), w(r[2])]), w(pa.name), w(pb.name)) + 3;

  const out: string[] = [];
  out.push(`跨账号对比：${pa.name}  vs  ${pb.name}`);
  out.push("");
  out.push(`${pad("指标", colW)}${pad(pa.name, colW)}${pb.name}`);
  out.push(`${pad("", colW)}${pad("", colW)}`);
  for (const [k, va, vb] of rows) out.push(`${pad(k, colW)}${pad(va, colW)}${vb}`);

  out.push("");
  out.push(`${pa.name} 常玩：${pa.topChampions.map((c) => `${c.name}(${c.games}把${c.winRate.toFixed(0)}%)`).join("、") || "—"}`);
  out.push(`${pb.name} 常玩：${pb.topChampions.map((c) => `${c.name}(${c.games}把${c.winRate.toFixed(0)}%)`).join("、") || "—"}`);
  out.push("");
  out.push(`${pa.name} 常用符文：${pa.topAugments.map((a) => `${a.name}(${a.games}把${a.winRate.toFixed(0)}%)`).join("、") || "—"}`);
  out.push(`${pb.name} 常用符文：${pb.topAugments.map((a) => `${a.name}(${a.games}把${a.winRate.toFixed(0)}%)`).join("、") || "—"}`);

  // 符文偏好差异：两边各自出现的比例差最大的是哪些
  const prefA = new Map(pa.augmentPrefs.map((x) => [x.name, x]));
  const prefB = new Map(pb.augmentPrefs.map((x) => [x.name, x]));
  const allNames = new Set([...prefA.keys(), ...prefB.keys()]);
  const diffs = [...allNames]
    .map((name) => {
      const a = prefA.get(name);
      const b = prefB.get(name);
      return {
        name,
        shareA: a?.share ?? 0,
        shareB: b?.share ?? 0,
        wrA: a?.winRate ?? null,
        wrB: b?.winRate ?? null,
        gap: (a?.share ?? 0) - (b?.share ?? 0),
      };
    })
    .filter((x) => Math.abs(x.gap) >= 0.02) // 至少差 2 个百分点才值得说
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));

  if (diffs.length) {
    out.push("", "符文偏好差异（按出现比例差排，只看差 ≥2 个百分点的）：");
    for (const x of diffs.slice(0, 8)) {
      const who = x.gap > 0 ? pa.name : pb.name;
      const sA = `${(x.shareA * 100).toFixed(0)}%`;
      const sB = `${(x.shareB * 100).toFixed(0)}%`;
      const wr = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
      out.push(
        `  · ${x.name}：${pa.name} ${sA} / ${pb.name} ${sB} —— ${who} 拿得多` +
          `（各自拿到时的胜率 ${wr(x.wrA)} vs ${wr(x.wrB)}）`
      );
    }
  }

  // 两人都常拿的符文，胜率差最大的
  const both = [...allNames]
    .filter((name) => prefA.has(name) && prefB.has(name))
    .map((name) => ({ name, a: prefA.get(name)!, b: prefB.get(name)! }))
    .filter((x) => x.a.games >= 10 && x.b.games >= 10)
    .sort((x, y) => Math.abs(y.a.winRate - y.b.winRate) - Math.abs(x.a.winRate - x.b.winRate));
  if (both.length) {
    out.push("", "两人都拿过的符文里，胜率差最大的几件：");
    for (const x of both.slice(0, 5)) {
      const better = x.a.winRate >= x.b.winRate ? pa.name : pb.name;
      out.push(
        `  · ${x.name}：${pa.name} ${x.a.winRate.toFixed(0)}%（${x.a.games} 把） vs ${pb.name} ${x.b.winRate.toFixed(0)}%（${x.b.games} 把）—— ${better} 用得好`
      );
    }
  }

  // 一句结论。判据按**标准误倍数**，不用固定的 1.5 个百分点 ——
  // 两个账号各自局数常常差很多，同一个 1.5pp，在 1000 局 vs 900 局上是实的，
  // 在 30 局 vs 20 局上连一个标准误都不到。和 tilt / contribution / combat-profile 同一类毛病。
  const diff = pa.winRate - pb.winRate;
  const winner = diff >= 0 ? pa : pb;
  const loser = diff >= 0 ? pb : pa;
  const se = Math.sqrt(
    Math.max(pa.winRate * (100 - pa.winRate), 1) / Math.max(pa.games, 1) +
      Math.max(pb.winRate * (100 - pb.winRate), 1) / Math.max(pb.games, 1)
  );
  const k = se > 0 ? Math.abs(diff) / se : 0;
  // 措辞刻意不把「约是噪声的 X 倍」塞进括号里 —— 外面已经有一层括号时会变成
  // 「（差 1.9 个百分点，标准误 3.2（约是噪声的 0.60 倍））」，读起来很绕。
  const nums = `差 ${Math.abs(diff).toFixed(1)} 个百分点，噪声（一个标准误）${se.toFixed(1)} 个百分点`;
  if (k < 1.5) {
    out.push("", `结论：两人胜率几乎持平 —— ${nums}，两者分不开；属于同一档，差异更多体现在英雄与符文偏好上。`);
  } else if (k < 2.5) {
    out.push(
      "",
      `结论：${winner.name} 胜率高一些 —— ${nums}，约是噪声的 ${k.toFixed(2)} 倍，**正好卡在「分得开」的线上**，` +
        `先当倾向，别当结论。（样本 ${winner.games} vs ${loser.games} 把）`
    );
  } else {
    out.push(
      "",
      `结论：${winner.name} 胜率高 ${Math.abs(diff).toFixed(1)} 个百分点（样本 ${winner.games} vs ${loser.games} 把，约是噪声的 ${k.toFixed(1)} 倍）` +
        `；${pa.kda > pb.kda ? pa.name : pb.name} 的 KDA 更好（${Math.max(pa.kda, pb.kda).toFixed(2)} vs ${Math.min(pa.kda, pb.kda).toFixed(2)}）。` +
        "样本量差异较大时请谨慎解读。"
    );
  }
  return out.join("\n");
}
