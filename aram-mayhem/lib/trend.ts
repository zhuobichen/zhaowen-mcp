/**
 * 长期趋势：把归档按周（周一起算）分桶，看走势。
 *
 * 这个工具的价值随时间增长 —— 归档只增不减，攒得越久越能看出「最近是不是在变强」，
 * 而单次接口窗口（海斗 200 局 / 云顶 20 局）是看不出长期趋势的。
 *
 * 只读本地归档 ∪ 实时取数（loadLolGames / loadTftGames）。
 * 样本少的周会被标出来，不参与「趋势」结论 —— 一周打 3 把的胜率没有意义。
 */
import { loadLolGames, loadTftGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";

export interface WeekBucket {
  /** 该周周一（本地时间）的 ISO 日期，作为标签 */
  week: string;
  from: number;
  to: number;
  games: number;
  wins: number;
  winRate: number;
  /** 场均 K/D/A（云顶时是平均名次，见 avgPlacement） */
  kda: number;
  avgDamage: number;
  /** 云顶用：平均名次 */
  avgPlacement: number | null;
  /** 该周名次的**标准差**（云顶用）。名次不是比例，均值差的噪声要由它推 */
  sdPlacement: number | null;
  /** 玩过的不同英雄数（云顶为 null） */
  champions: number | null;
  /** 样本是否够得出结论 */
  enough: boolean;
}

export interface TrendReport {
  name: string;
  kind: "mayhem" | "tft";
  weeks: WeekBucket[];
  /** 样本够的周数 */
  usableWeeks: number;
  /** 最近 4 个「样本够」的周 vs 之前 4 周（没有则 null） */
  recent: { weeks: number; games: number; winRate: number } | null;
  earlier: { weeks: number; games: number; winRate: number } | null;
  /** 趋势结论（一句话），样本不足时直说 */
  verdict: string;
  note: string;
}

/** 本地时间的「本周周一 00:00」 */
function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

const WEEK_MS = 7 * 86400 * 1000;

export async function analyzeTrend(
  opts: { who?: string; kind?: "mayhem" | "tft"; minGamesPerWeek?: number; weeks?: number } = {}
): Promise<TrendReport> {
  let puuid: string;
  let name: string;
  if (opts.who) {
    const r = await resolveAccountByName(opts.who);
    if (!r.matches.length) throw new Error(`没找到「${opts.who}」——${r.note}`);
    puuid = r.matches[0].puuid;
    name = r.matches[0].name;
  } else {
    const me = await resolveMe();
    if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");
    puuid = me.puuid;
    name = me.name;
  }

  const kind = opts.kind ?? "mayhem";
  const minGamesPerWeek = opts.minGamesPerWeek ?? 5;

  /** 每局抽出来的一行 */
  interface Row {
    t: number;
    win: boolean;
    champ: string;
    k: number;
    dd: number;
    a: number;
    dmg: number;
    place: number | null;
  }
  const rows: Row[] = [];

  if (kind === "tft") {
    const res = await loadTftGames(puuid, name);
    for (const g of res.games) {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      if (!p?.placement) continue;
      rows.push({
        t: g.gameCreation ?? 0,
        win: Number(p.placement) === 1,
        champ: "",
        k: 0,
        dd: 0,
        a: 0,
        dmg: Number(p.total_damage_to_players ?? 0),
        place: Number(p.placement),
      });
    }
  } else {
    const res = await loadLolGames(puuid, 2000, name);
    for (const g of res.games.filter(isMayhemGame)) {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      const s: any = p?.stats ?? {};
      if (s.win === undefined) continue;
      rows.push({
        t: g.gameCreation ?? 0,
        win: s.win === true,
        champ: String(p?.championId ?? ""),
        k: Number(s.kills ?? 0),
        dd: Number(s.deaths ?? 0),
        a: Number(s.assists ?? 0),
        dmg: Number(s.totalDamageDealtToChampions ?? 0),
        place: null,
      });
    }
  }

  rows.sort((x, y) => x.t - y.t);
  if (!rows.length) {
    return {
      name,
      kind,
      weeks: [],
      usableWeeks: 0,
      recent: null,
      earlier: null,
      verdict: "没有可用的对局数据。",
      note: "归档为空且本次也没读到对局。",
    };
  }

  const map = new Map<number, Row[]>();
  for (const r of rows) {
    const k = weekStart(r.t);
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }

  const fmtDay = (t: number) => {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  let weeks: WeekBucket[] = [...map.entries()]
    .map(([w, rs]) => {
      const wins = rs.filter((r) => r.win).length;
      const places = rs.map((r) => r.place).filter((x): x is number => x != null);
      return {
        week: fmtDay(w),
        from: w,
        to: w + WEEK_MS - 1,
        games: rs.length,
        wins,
        winRate: (wins / rs.length) * 100,
        kda:
          rs.reduce((s, r) => s + r.k + r.a, 0) / Math.max(rs.reduce((s, r) => s + r.dd, 0), 1),
        avgDamage: rs.reduce((s, r) => s + r.dmg, 0) / rs.length,
        avgPlacement: places.length ? places.reduce((a, b) => a + b, 0) / places.length : null,
        // 名次的标准差（样本标准差）。判「名次变化是不是噪声」要用它推标准误 ——
        // 名次不是比例，不能像胜率那样用 p(1-p)/n。
        sdPlacement: (() => {
          if (places.length < 2) return null;
          const mean = places.reduce((a, b) => a + b, 0) / places.length;
          return Math.sqrt(places.reduce((s2, x) => s2 + (x - mean) ** 2, 0) / (places.length - 1));
        })(),
        champions: kind === "mayhem" ? new Set(rs.map((r) => r.champ)).size : null,
        enough: rs.length >= minGamesPerWeek,
      };
    })
    .sort((a, b) => a.from - b.from);

  const keep = opts.weeks ?? 16;
  weeks = weeks.slice(-keep);

  // 趋势对比：最近 4 个样本够的周 vs 之前 4 个（同口径：都只取样本够的周）
  const usable = weeks.filter((w) => w.enough);
  const summarize = (list: WeekBucket[]) => {
    const games = list.reduce((s, w) => s + w.games, 0);
    const wins = list.reduce((s, w) => s + w.wins, 0);
    return { weeks: list.length, games, winRate: games ? (wins / games) * 100 : 0 };
  };
  const recent = usable.length >= 2 ? summarize(usable.slice(-4)) : null;
  const earlier = usable.length >= 5 ? summarize(usable.slice(-8, -4)) : null;

  let verdict: string;
  if (kind === "tft") {
    const places = usable.map((w) => w.avgPlacement).filter((x): x is number => x != null);
    if (places.length >= 4) {
      const half = Math.floor(places.length / 2);
      const oldWeeks = usable.slice(0, half);
      const newWeeks = usable.slice(half);
      const oldAvg = places.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(half, 1);
      const newAvg = places.slice(half).reduce((a, b) => a + b, 0) / Math.max(places.length - half, 1);
      // 判据按**标准误**，不用固定的 0.2 名（名次标准差约 2.2，10 局时标准误就有 0.7）。
      // 每半段的标准误 = 该段合并标准差 / √(该段总局数)；合并标准差用各周的 sd 和局数拼。
      const seHalf = (weeks: typeof usable) => {
        const withSd = weeks.filter((w) => w.sdPlacement != null && w.games > 0);
        const g = withSd.reduce((s2, w) => s2 + w.games, 0);
        if (!g || !withSd.length) return Number.NaN;
        const pooled = Math.sqrt(
          withSd.reduce((s2, w) => s2 + (w.games - 1) * Math.pow(w.sdPlacement!, 2), 0) /
            Math.max(g - withSd.length, 1)
        );
        return pooled / Math.sqrt(g);
      };
      const seP = Math.sqrt(Math.pow(seHalf(oldWeeks), 2) + Math.pow(seHalf(newWeeks), 2));
      const kP = Number.isFinite(seP) && seP > 0 ? Math.abs(newAvg - oldAvg) / seP : 0;
      const numsP =
        Number.isFinite(seP) && seP > 0
          ? `差 ${Math.abs(newAvg - oldAvg).toFixed(2)} 名，噪声（一个标准误）约 ${seP.toFixed(2)} 名`
          : "";
      verdict =
        `云顶按平均名次看（越小越好）：前段 ${oldAvg.toFixed(2)} → 后段 ${newAvg.toFixed(2)}，` +
        (kP <= 2
          ? `两者分不开（${numsP}），没有明显变化。`
          : newAvg < oldAvg
            ? `名次变好了 ${(oldAvg - newAvg).toFixed(2)}（${numsP}，约是噪声的 ${kP.toFixed(1)} 倍），是在进步。`
            : `名次变差了 ${(newAvg - oldAvg).toFixed(2)}（${numsP}，约是噪声的 ${kP.toFixed(1)} 倍），最近掉分。`) +
        // 口径说明是「与原始数据对账」时补的：这里是**各周平均名次的平均**（每周等权），
        // 不是按局数加权的合并平均 —— 周场次不等时两者会不一样。
        // 不算错，但不写出来读者会以为是按局数算的。
        `（口径：先把每周各自的平均名次算出来，再对周取平均 —— 每周等权，不按局数加权；` +
        `有效周按 ≥${minGamesPerWeek} 局筛，取最近 ${keep} 周内的。）`;
    } else {
      verdict = "样本够的周太少（云顶一局时长长，周场次本来就不多），暂时看不出趋势。";
    }
  } else if (recent && earlier) {
    const diff = recent.winRate - earlier.winRate;
    // 判据按**两比例标准误**，不用固定的 3 个百分点。
    // 口径：把每个窗口当成一个 n=窗口内局数 的比例 —— 与 tilt / contribution / combat 一致。
    // （更保守的做法是拿「周」当抽样单位（每组才 4 个），但那会把几乎所有趋势都判成看不出；
    //   周内相关性确实存在，所以下面把这条简化写进结论里。）
    // 实测：58 把 50.0% vs 42 把 40.5%，差 9.5pp，标准误 10.1pp —— 原写法会报「是在变强」。
    const se = Math.sqrt(
      Math.max(recent.winRate * (100 - recent.winRate), 1) / Math.max(recent.games, 1) +
        Math.max(earlier.winRate * (100 - earlier.winRate), 1) / Math.max(earlier.games, 1)
    );
    const k = se > 0 ? Math.abs(diff) / se : 0;
    const nums = `差 ${Math.abs(diff).toFixed(1)} 个百分点，噪声（一个标准误）${se.toFixed(1)} 个百分点`;
    verdict =
      `最近 ${recent.weeks} 个有效周 ${recent.games} 把 ${recent.winRate.toFixed(1)}%，` +
      `之前 ${earlier.weeks} 个有效周 ${earlier.games} 把 ${earlier.winRate.toFixed(1)}% —— ` +
      (k <= 2
        ? `两者分不开（${nums}），看不出趋势性变化。` +
          `按这个量级，要看出 3 个百分点的变化，每组大约需要 ${Math.ceil(0.5 * Math.pow(1.96 / 0.03, 2)).toLocaleString("en-US")} 把。`
        : diff > 0
          ? `最近好了 ${diff.toFixed(1)} 个百分点（${nums}，约是噪声的 ${k.toFixed(1)} 倍），是在变强。`
          : `最近差了 ${Math.abs(diff).toFixed(1)} 个百分点（${nums}，约是噪声的 ${k.toFixed(1)} 倍），状态在下滑。`) +
      `（口径：两个窗口各当成一个整体比，标准误按局数算 —— 同一窗口里各周之间不是独立的，` +
      `所以这个区间偏乐观；真实的不确定度只会更大。）`;
  } else {
    verdict = `样本够（≥${minGamesPerWeek} 局）的周只有 ${usable.length} 个，还不足以谈趋势。`;
  }

  return {
    name,
    kind,
    weeks,
    usableWeeks: usable.length,
    recent,
    earlier,
    verdict,
    note:
      `${weeks.length} 个自然周（周一起算），其中 ${usable.length} 周达到「≥${minGamesPerWeek} 局」的有效样本门槛。` +
      `未达标的周仍会列出，但不参与趋势结论 —— 一周打 3 把的胜率没有意义。` +
      (kind === "mayhem" ? "口径：只统计海斗（海克斯大乱斗及其同族队列）。" : "口径：全部云顶对局。"),
  };
}

/** 文本输出 */
export async function trendText(
  opts: { who?: string; kind?: "mayhem" | "tft"; minGamesPerWeek?: number } = {}
): Promise<string> {
  let r: TrendReport;
  try {
    r = await analyzeTrend(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  const out: string[] = [];
  out.push(`${r.name} · ${r.kind === "tft" ? "云顶" : "海斗"}周趋势`);
  out.push(r.note);
  out.push("");

  if (!r.weeks.length) {
    out.push("没有可展示的周。");
    return out.join("\n");
  }

  const maxGames = Math.max(1, ...r.weeks.map((w) => w.games));
  out.push("  周起始     场次  胜率    走势                KDA    场均伤害");
  for (const w of r.weeks) {
    const bar = "▇".repeat(Math.max(1, Math.round((w.games / maxGames) * 10)));
    const flag = w.enough ? " " : "（样本少）";
    const wr = w.winRate.toFixed(1).padStart(5);
    out.push(
      `  ${w.week}  ${String(w.games).padStart(3)}  ${wr}%  ${bar.padEnd(12)}  ` +
        `${w.kda.toFixed(2).padStart(5)}  ${Math.round(w.avgDamage / 1000).toString().padStart(4)}k ${flag}`
    );
  }
  out.push("");
  out.push(`覆盖 ${fmtDate(r.weeks[0].from)} ~ ${fmtDate(r.weeks[r.weeks.length - 1].to)}，共 ${r.weeks.length} 周。`);
  out.push("");
  out.push(`结论：${r.verdict}`);
  if (r.recent && r.earlier) {
    // 结论里引用了这两段的胜率（如「最近 50.0% / 之前 40.5%」），所以这里必须把它们
    // 明确列出来 —— 上面的逐周表里没有「4 个有效周合并」这一行，不列就没法核对。
    // 是结论自洽审计查出来的（只给「胜率差」不够）。
    const f = (x: number) => `${x.toFixed(1)}%`;
    out.push(
      `  最近 ${r.recent.weeks} 个有效周：${r.recent.games} 把 ${f(r.recent.winRate)}` +
        `　之前 ${r.earlier.weeks} 个：${r.earlier.games} 把 ${f(r.earlier.winRate)}` +
        `　差 ${r.recent.winRate - r.earlier.winRate >= 0 ? "+" : ""}${(r.recent.winRate - r.earlier.winRate).toFixed(1)} 个百分点`
    );
  }
  return out.join("\n");
}
