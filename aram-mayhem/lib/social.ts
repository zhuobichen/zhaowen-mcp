/**
 * 队友 / 对手分析。
 *
 * 数据来源：SGP 的对局记录带**全部 10 个参与者**（含 puuid 与显示名），
 * 所以可以统计「和谁一起打、胜率如何」「遇到过谁、对他们胜率如何」。
 * 本地客户端（LCU）只给自己的那一行，那类对局没有队友数据 —— 这里会如实标注覆盖率。
 *
 * 只读，不涉及任何写操作。
 */
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";
import { SOCIAL_LIST_MIN_GAMES, SOCIAL_VERDICT_MIN_GAMES } from "./thresholds.js";

export interface CoPlayer {
  puuid: string;
  name: string;
  /** 一起打（同队）的局数 */
  games: number;
  /** 其中赢的局数 */
  wins: number;
  winRate: number;
  /** 最近一次同队时间 */
  lastSeen: number;
  /** 同队时**我**用的英雄表现（≥4 局才列） */
  myChampions?: Array<{ name: string; games: number; winRate: number }>;
}

export interface SocialReport {
  name: string;
  games: number;
  /** 有完整 10 人数据的局数（只有自己那行的对局无法统计队友） */
  gamesWithFullRoster: number;
  teammates: CoPlayer[];
  opponents: CoPlayer[];
  note: string;
}

function rank(entries: CoPlayer[], minGames: number, sortBy: "games" | "winRate"): CoPlayer[] {
  const filtered = entries.filter((e) => e.games >= minGames);
  return sortBy === "games"
    ? filtered.sort((a, b) => b.games - a.games || b.winRate - a.winRate)
    : filtered.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

export async function analyzeSocial(
  opts: { who?: string; games?: number; minGames?: number; puuid?: string; name?: string } = {}
): Promise<SocialReport> {
  // 查谁：默认自己；给了名字就先解析成 puuid
  let puuid: string | null = null;
  let name = "";
  if (opts.puuid) {
    // 调用方（例如报告）已经解析好了身份，直接用 —— 避免按名字再解析一次解析错人
    puuid = opts.puuid;
    name = opts.name ?? "";
  } else if (opts.who) {
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

  const d = loadData();
  const res = await loadLolGames(puuid, opts.games ?? 2000, name);
  const all = res.games.filter(isMayhemGame);

  const mates = new Map<string, CoPlayer>();
  const opps = new Map<string, CoPlayer>();
  /** 队友 puuid → 我玩的英雄 → 战绩（用来看「和他一起时我玩什么最好」） */
  const mateChamps = new Map<string, Map<string, { g: number; w: number }>>();
  let fullRoster = 0;

  for (const g of all) {
    const parts = g.participants ?? [];
    if (parts.length < 2) continue; // LCU 那种只有自己一行的，统计不了
    fullRoster++;
    const mePart = parts.find((p: any) => p.puuid === puuid);
    if (!mePart) continue;
    const myTeam = mePart.teamId;
    const win = mePart.stats?.win === true;
    for (const p of parts) {
      if (!p.puuid || p.puuid === puuid) continue;
      const target = p.teamId === myTeam ? mates : opps;
      const cur =
        target.get(p.puuid) ??
        ({ puuid: p.puuid, name: p.summonerName ?? p.name ?? "（未知名字）", games: 0, wins: 0, winRate: 0, lastSeen: 0 } as CoPlayer);
      cur.games++;
      if (win) cur.wins++;
      cur.lastSeen = Math.max(cur.lastSeen, g.gameCreation ?? 0);
      // 同队时我用的英雄（只对队友记）
      if (p.teamId === myTeam) {
        const myCid = d.championIds[String(mePart.championId)];
        const myName = myCid ? d.championById.get(myCid.id)?.name ?? myCid.name : null;
        if (myName) {
          const cm = mateChamps.get(p.puuid) ?? new Map<string, { g: number; w: number }>();
          const cc = cm.get(myName) ?? { g: 0, w: 0 };
          cc.g++;
          if (win) cc.w++;
          cm.set(myName, cc);
          mateChamps.set(p.puuid, cm);
        }
      }
      if (!cur.name || cur.name === "（未知名字）") cur.name = p.summonerName ?? p.name ?? cur.name;
      target.set(p.puuid, cur);
    }
  }
  for (const map of [mates, opps]) {
    for (const v of map.values()) v.winRate = v.games ? (v.wins / v.games) * 100 : 0;
  }
  // 同队时我用的英雄：只留 ≥4 局的，按胜率排
  for (const [puuid, cm] of mateChamps) {
    const m = mates.get(puuid);
    if (!m) continue;
    m.myChampions = [...cm.entries()]
      .filter(([, v]) => v.g >= 4)
      .map(([name, v]) => ({ name, games: v.g, winRate: (v.w / v.g) * 100 }))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
      .slice(0, 4);
  }

  return {
    name,
    games: all.length,
    gamesWithFullRoster: fullRoster,
    teammates: rank([...mates.values()], opts.minGames ?? SOCIAL_LIST_MIN_GAMES, "games"),
    opponents: rank([...opps.values()], opts.minGames ?? SOCIAL_LIST_MIN_GAMES, "games"),
    note:
      `${all.length} 把海斗里，${fullRoster} 把有完整 10 人数据可分析队友/对手` +
      (fullRoster < all.length ? `（其余 ${all.length - fullRoster} 把来自本地客户端，只记录了自己那一行）` : ""),
  };
}

/** 给人看的文本报告 */
export async function socialText(opts: { who?: string; games?: number; minGames?: number } = {}): Promise<string> {
  let r: SocialReport;
  try {
    r = await analyzeSocial(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const fmtDate = (t: number) => (t ? new Date(t).toLocaleDateString("zh-CN") : "—");
  const out: string[] = [];
  out.push(`${r.name} · 队友与对手分析`);
  out.push(r.note);
  out.push("");

  const minGames = opts.minGames ?? SOCIAL_VERDICT_MIN_GAMES;
  const mates = r.teammates.filter((m) => m.games >= minGames);
  out.push(`最常一起打的人（同队 ≥${minGames} 局，共 ${mates.length} 人）：`);
  for (const m of mates.slice(0, 12)) {
    out.push(
      `  · ${m.name}：同队 ${m.games} 局 · 共同胜率 ${m.winRate.toFixed(0)}%（${m.wins} 胜）· 最近 ${fmtDate(m.lastSeen)}`
    );
  }
  if (!mates.length) out.push("  （没有同队 ≥3 局的玩家）");

  // 这一栏是**从一起打过的账号里挑共同胜率最高的**，属于最大值统计量 ——
  // 而它原先没有任何噪声上下文。实测（npm run thresholds:sweep）：12 个候选时榜首是
  // 23 局 69.6%（2.0 倍），而 12 个候选的极值线是 √(2·ln 12) ≈ 2.2 —— **榜首刚好在线上**。
  // 所以候选数、噪声尺度、逐条倍数都要给出来。
  const goodPool = rank(mates.map((x) => ({ ...x })), Math.max(5, minGames), "winRate");
  const good = goodPool.slice(0, 5);
  const seOf = (x: { games: number; winRate: number }) =>
    Math.sqrt(Math.max(x.winRate * (100 - x.winRate), 1) / Math.max(x.games, 1));
  const kOf = (x: { games: number; winRate: number }) => (seOf(x) > 0 ? Math.abs(x.winRate - 50) / seOf(x) : 0);
  if (good.length) {
    const ses = goodPool.map(seOf).sort((a, b) => a - b);
    const med = ses.length ? ses[Math.floor(ses.length / 2)] : 0;
    const ceil = med * Math.sqrt(2 * Math.log(Math.max(goodPool.length, 2)));
    // 表头这句要用**证据最强的**那一条来判断，不能用列表第一行 ——
    // 列表是按共同胜率排的，而胜率最高 ≠ 倍数最高（局数不同）：
    // 这个号的首行是 23 局 70%（2.0 倍），而第三行是 50 局 66%（2.4 倍），
    // 后者才是真正过线的那个。用首行判断会漏掉它、把话说小。
    const strongest = good.reduce((a, b) => (kOf(b) > kOf(a) ? b : a));
    const anyOver = Math.abs(strongest.winRate - 50) >= ceil;
    out.push(
      "",
      `和这些人一起打最稳（≥5 局，候选 ${goodPool.length} 人）：` +
        (anyOver
          ? `其中${strongest.name}那条超过了噪声能造出的水平（约是噪声的 ${kOf(strongest).toFixed(1)} 倍），其余仍要逐条看倍数。`
          : `**都还在噪声范围内** —— 从 ${goodPool.length} 人里挑最高，光噪声就能造出约 ${ceil.toFixed(1)} 个百分点的差距，先当线索。`)
    );
    // 两个尺度不是一回事，不写清楚会看着自相矛盾（表头说「都在噪声内」，某条却标 2.4 倍）：
    //   · 逐条的「几倍」= 这一条比不比 0 大（单次比较，只看它自己的样本量）
    //   · 上面那个 X 个百分点 = 整份榜单的尺度（从 N 人里挑最高，最高本来就有这么大）
    out.push(
      `  （两个尺度不同：逐条的「几倍」是那一条比不比 0 大；` +
        `而 ${ceil.toFixed(1)} 个百分点是「从 ${goodPool.length} 人里挑最高」这个动作本身能造出的差距。` +
        `按前者判断哪个人真跟你合拍，别按排名。）`
    );
    for (const m of good) {
      out.push(`  · ${m.name}：${m.games} 局 ${m.winRate.toFixed(0)}%（约是噪声的 ${kOf(m).toFixed(1)} 倍）`);
    }
  }

  // 对手：海斗匹配随机性高，往往没有稳定对手 —— 如实说明，不硬凑样本
  const opps = r.opponents;
  const maxOpp = opps.length ? opps[0].games : 0;
  out.push("", `对手情况：共遇到 ${opps.length} 个不同对手，重复最多 ${maxOpp} 次`);
  if (maxOpp >= minGames) {
    out.push(`  反复遇到的（≥${minGames} 次）：`);
    for (const o of opps.filter((x) => x.games >= minGames).slice(0, 10)) {
      out.push(`    · ${o.name}：${o.games} 次 · 你对他们所在队的胜率 ${o.winRate.toFixed(0)}%`);
    }
  } else {
    out.push("  没有重复 ≥3 次的对手 —— 海斗匹配池很大，随机性强，这个维度没有可分析的稳定对手。");
    out.push(`  （遇到过的人里次数最多的：${opps.slice(0, 5).map((o) => `${o.name} ${o.games} 次`).join("、")}）`);
  }

  // 和常一起打的人配合时，我玩什么英雄最好
  const withChamps = mates.filter((m) => (m.myChampions?.length ?? 0) > 0).slice(0, 4);
  if (withChamps.length) {
    out.push("", "和他们同队时，我玩什么英雄打得最好（每个英雄 ≥4 局）：");
    for (const m of withChamps) {
      out.push(`  ${m.name}（同队 ${m.games} 局，共同胜率 ${m.winRate.toFixed(0)}%）：`);
      for (const c of m.myChampions!) {
        out.push(`    · ${c.name}：${c.games} 局 ${c.winRate.toFixed(0)}%`);
      }
    }
  }

  out.push("", "说明：同队/对手关系取自每局的 10 人名单（SGP 提供）；样本 <3 次的不列出。");
  return out.join("\n");
}
