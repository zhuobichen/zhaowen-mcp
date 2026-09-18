/**
 * 对面阵容构成分析：对面有几个坦克 / 刺客 / 射手…… 时，你的胜率如何。
 *
 * 定位标签来自 Riot 官方 `champion-summary.json` 的 roles
 * （mage / support / fighter / tank / marksman / assassin），**粒度很粗**：
 * 一名英雄可挂多个标签（亚索是 fighter+assassin，提莫是 marksman+mage），
 * 所以这里算的是「对面有几个人带这个标签」，不是「对面有几个纯刺客」。
 * 输出里会写明这一点，并且只对样本够的档位下结论。
 *
 * 数据来源：归档里带完整 10 人名单的海斗对局（SGP 提供）。
 * 只读。
 */
import { archivedGamesFor } from "./archive.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export const ROLE_CN: Record<string, string> = {
  fighter: "战士",
  tank: "坦克",
  mage: "法师",
  marksman: "射手",
  assassin: "刺客",
  support: "辅助",
};

export interface RoleCountStat {
  role: string;
  roleCn: string;
  /** 对面有几个带这个标签的人 */
  count: number;
  games: number;
  wins: number;
  winRate: number;
  /** 相对你的整体胜率（百分点） */
  delta: number;
  enough: boolean;
}

export interface RoleStat {
  role: string;
  roleCn: string;
  games: number;
  wins: number;
  winRate: number;
  delta: number;
  enough: boolean;
}

export interface CompReport {
  playerName: string | null;
  puuid: string;
  games: number;
  baseWinRate: number;
  /** 按「对面有几个 X」的分布（只列样本够的档） */
  byCount: RoleCountStat[];
  /** 对面是否有人带该标签 → 你的胜率 */
  present: RoleStat[];
  /** 对面阵容里人数最多的标签（主导类型）→ 你的胜率 */
  dominant: RoleStat[];
  /** 一句话结论：对面构成到底有没有明显影响 */
  verdict: string;
  note: string;
}

const ROLE_ORDER = ["tank", "fighter", "assassin", "mage", "marksman", "support"];

export async function analyzeComps(
  opts: { puuid?: string; name?: string; minGames?: number } = {}
): Promise<CompReport> {
  const d = loadData();
  const games = (await archivedGamesFor("lol")).filter(isMayhemGame);

  // 数字英雄 id → roles
  const rolesOf = (championId: number): string[] => {
    const cid = d.championIds[String(championId)];
    if (!cid) return [];
    return d.championById.get(cid.id)?.roles ?? [];
  };

  // 只看归档里「这个账号自己打过」的局：优先用显式 puuid，否则取出现次数最多的那个账号
  let puuid = opts.puuid ?? null;
  if (!puuid) {
    const tally = new Map<string, number>();
    for (const g of games) for (const p of g.participants ?? []) if (p.puuid) tally.set(p.puuid, (tally.get(p.puuid) ?? 0) + 1);
    puuid = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  if (!puuid) {
    return {
      playerName: null,
      puuid: "",
      games: 0,
      baseWinRate: 0,
      byCount: [],
      present: [],
      dominant: [],
      verdict: "归档里没有可用对局。",
      note: "归档里没有可用对局。",
    };
  }

  interface Acc {
    games: number;
    wins: number;
  }
  const bump = (m: Map<string, Acc>, k: string, win: boolean) => {
    const c = m.get(k) ?? { games: 0, wins: 0 };
    c.games++;
    if (win) c.wins++;
    m.set(k, c);
  };

  const countMap = new Map<string, Acc>(); // `${role}|${count}`
  const presentMap = new Map<string, Acc>(); // role
  const dominantMap = new Map<string, Acc>(); // role
  let total = 0;
  let totalWins = 0;
  let playerName: string | null = null;

  for (const g of games) {
    const parts = g.participants ?? [];
    if (parts.length < 2) continue;
    const me = parts.find((p: any) => p.puuid === puuid);
    if (!me?.stats) continue;
    if (!playerName && (g as any).puuidName) playerName = (g as any).puuidName;
    const win = (me as any).stats.win === true;
    total++;
    if (win) totalWins++;

    const counts: Record<string, number> = {};
    for (const p of parts) {
      if (p.teamId === me.teamId || !p.championId) continue;
      for (const r of new Set(rolesOf(Number(p.championId)))) counts[r] = (counts[r] ?? 0) + 1;
    }
    for (const role of ROLE_ORDER) {
      const n = counts[role] ?? 0;
      bump(countMap, `${role}|${n}`, win);
      if (n > 0) bump(presentMap, role, win);
    }
    // 主导类型：人数最多的那个（并列时都记一次）
    const max = Math.max(0, ...Object.values(counts));
    if (max > 0) {
      for (const [r, n] of Object.entries(counts)) if (n === max) bump(dominantMap, r, win);
    }
  }

  const base = total ? (totalWins / total) * 100 : 0;
  const minGames = opts.minGames ?? 60;

  const toStat = (role: string, a: Acc): RoleStat => {
    const wr = a.games ? (a.wins / a.games) * 100 : 0;
    return {
      role,
      roleCn: ROLE_CN[role] ?? role,
      games: a.games,
      wins: a.wins,
      winRate: wr,
      delta: wr - base,
      enough: a.games >= minGames,
    };
  };

  const byCount: RoleCountStat[] = [...countMap.entries()]
    .map(([k, a]) => {
      const [role, cnt] = k.split("|");
      const s = toStat(role, a);
      return { ...s, count: Number(cnt) };
    })
    .filter((x) => x.games >= 30) // 具体档位门槛低一些，但至少 30 局
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.count - b.count);

  const presentStats = ROLE_ORDER.map((r) => presentMap.get(r))
    .map((a, i) => (a ? toStat(ROLE_ORDER[i], a) : null))
    .filter((x): x is RoleStat => !!x)
    .sort((a, b) => a.winRate - b.winRate);
  const strong = presentStats.filter((x) => x.enough);

  let verdict: string;
  if (strong.length < 3) {
    verdict = `样本不够：只有 ${strong.length} 类标签攒到 ${minGames} 局以上，看不出对面构成的影响。`;
  } else {
    const spread = strong[strong.length - 1].winRate - strong[0].winRate;
    // 二项比例在这个样本量下的粗噪声线：4 个标准误（≈95% 区间宽）
    const se = (p: number, n: number) => Math.sqrt((p * (100 - p)) / Math.max(n, 1));
    const noise = 2 * (se(base, strong[0].games) + se(base, strong[strong.length - 1].games));
    if (spread <= noise) {
      verdict =
        `对面阵容构成对你**没有明显影响**：六类标签之间的胜率极差只有 ${spread.toFixed(1)} 个百分点，` +
        `而样本噪声本身就有 ±${(noise / 2).toFixed(1)} 个百分点左右 —— 这个差距解释不了什么。` +
        `也就是说你不太挑对手阵容，胜负更多取决于别的东西。`;
    } else {
      const worst = strong[0];
      const best = strong[strong.length - 1];
      verdict =
        `对面阵容构成**有影响**：对面有${worst.roleCn}时你最低（${worst.games} 局 ${worst.winRate.toFixed(1)}%，` +
        `比基准 ${worst.delta >= 0 ? "+" : ""}${worst.delta.toFixed(1)}），有${best.roleCn}时最高（${best.games} 局 ${best.winRate.toFixed(1)}%，` +
        `${best.delta >= 0 ? "+" : ""}${best.delta.toFixed(1)}），极差 ${spread.toFixed(1)} 个百分点，超过样本噪声（±${(noise / 2).toFixed(1)}）。`;
    }
  }

  return {
    playerName,
    puuid,
    games: total,
    baseWinRate: base,
    verdict,
    byCount,
    present: presentStats,
    dominant: ROLE_ORDER.map((r) => dominantMap.get(r))
      .map((a, i) => (a ? toStat(ROLE_ORDER[i], a) : null))
      .filter((x): x is RoleStat => !!x)
      .sort((a, b) => a.winRate - b.winRate),
    note:
      `样本：归档里 ${total} 把有完整 10 人名单的海斗对局，你的整体胜率 ${base.toFixed(1)}%。` +
      `定位标签取自 Riot 官方数据，一名英雄可挂多个标签，所以「对面有 2 个坦克」是` +
      `「对面有 2 个人的标签里有坦克」，不是「2 个纯坦克」。` +
      `这也是观察数据：对面阵容强本来就会压低你的胜率，两边都在变，不能只归因到你这边。` +
      `单个档位样本 <30 局的不列，标签级 <${minGames} 局的不下结论。`,
  };
}

/** 文本输出 */
export async function compsText(opts: { puuid?: string; name?: string; minGames?: number } = {}): Promise<string> {
  let r: CompReport;
  try {
    r = await analyzeComps(await resolveTargetPuuid(opts));
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const out: string[] = [];
  out.push(`${r.playerName ?? "（归档里出现最多的账号）"} · 对面阵容构成`);
  out.push(r.note);
  out.push("");

  if (!r.games) return out.join("\n");

  out.push(`结论：${r.verdict}`, "");

  out.push("对面带某个标签的人越多，你的胜率如何（按标签分组）：");
  let curRole = "";
  for (const x of r.byCount) {
    if (x.role !== curRole) {
      curRole = x.role;
      out.push(`  ${x.roleCn}：`);
    }
    out.push(
      `    对面 ${x.count} 个：${x.games} 局 ${x.winRate.toFixed(1)}%` +
        `（比基准 ${x.delta >= 0 ? "+" : ""}${x.delta.toFixed(1)}）${x.enough ? "" : " ← 样本少"}`
    );
  }

  out.push("", "对面只要有该标签的人，你的胜率（按净影响排，样本够的才下结论）：");
  for (const x of r.present) {
    out.push(
      `  · 对面有${x.roleCn}：${x.games} 局 ${x.winRate.toFixed(1)}%（${x.delta >= 0 ? "+" : ""}${x.delta.toFixed(1)}）` +
        (x.enough ? "" : " ← 样本少")
    );
  }

  out.push("", "对面阵容的主导类型（人数最多的那一类）：");
  for (const x of r.dominant) {
    out.push(
      `  · 对面主打${x.roleCn}：${x.games} 局 ${x.winRate.toFixed(1)}%（${x.delta >= 0 ? "+" : ""}${x.delta.toFixed(1)}）` +
        (x.enough ? "" : " ← 样本少")
    );
  }
  out.push(
    "",
    "⚠ 读法：「对面坦克多我胜率低」不等于「坦克克我」—— 坦克多往往说明对面整体更肉更稳，",
    "这是阵容强度的差别，不是单一英雄的克制关系。要精确到英雄请看 get_my_matchups。"
  );
  return out.join("\n");
}

/** 解析要分析谁：给了名字就解析，否则交给 analyzeComps 自己挑归档里出现最多的账号 */
async function resolveTargetPuuid(opts: { puuid?: string; name?: string }): Promise<{ puuid?: string; name?: string }> {
  if (opts.puuid) return { puuid: opts.puuid, name: opts.name };
  if (opts.name) {
    const { resolveAccountByName } = await import("./identity.js");
    const r = await resolveAccountByName(opts.name);
    if (!r.matches.length) throw new Error(`没找到「${opts.name}」——${r.note}`);
    return { puuid: r.matches[0].puuid, name: r.matches[0].name };
  }
  const { resolveMe } = await import("./identity.js");
  const me = await resolveMe();
  return me ? { puuid: me.puuid, name: me.name } : {};
}
