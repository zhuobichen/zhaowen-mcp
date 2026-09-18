/**
 * 小圈子榜单：把本地归档里出现过的账号按海斗战绩排名。
 *
 * 数据来源：归档里每一局的 10 人名单 —— 所以凡是和你（或你查过的账号）同场过的玩家，
 * 只要有足够样本，都能上榜。榜单是「我见过的玩家」的排名，不是全服排名。
 */
import { archivedGamesFor } from "./archive.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export interface LeaderRow {
  puuid: string;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  /** 是否是我们重点同步过的账号（有完整历史） */
  synced: boolean;
}

export async function leaderboard(opts: { minGames?: number; top?: number } = {}): Promise<string> {
  const minGames = Math.max(1, opts.minGames ?? 10);
  const top = Math.max(1, opts.top ?? 20);
  const d = loadData();
  const games = (await archivedGamesFor("lol", null)).filter(isMayhemGame);

  const stat = new Map<string, { name: string; games: number; wins: number }>();
  for (const g of games) {
    for (const p of g.participants ?? []) {
      if (!p.puuid) continue;
      const cur = stat.get(p.puuid) ?? { name: p.summonerName ?? "（未知）", games: 0, wins: 0 };
      cur.games++;
      if (p.stats?.win === true) cur.wins++;
      if (p.summonerName) cur.name = p.summonerName;
      stat.set(p.puuid, cur);
    }
  }

  const rows: LeaderRow[] = [...stat.entries()]
    .filter(([, v]) => v.games >= minGames)
    .map(([puuid, v]) => ({
      puuid,
      name: v.name,
      games: v.games,
      wins: v.wins,
      winRate: (v.wins / v.games) * 100,
      synced: false,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  if (!rows.length) {
    return `归档里没有样本 ≥${minGames} 局的账号（先跑 npm run archive:sync，或用 --friends 把好友也同步进来）。`;
  }

  const out: string[] = [
    `小圈子海斗榜单（本地归档里见过 ${stat.size} 个账号，取样本 ≥${minGames} 局的上榜）`,
    `注意：这是「你的对局里出现过的人」的排名，不是全服排名；样本越大越可信。`,
    "",
  ];
  const w = (s: string) => [...s].reduce((n, c) => n + (/[一-鿿＀-￯]/.test(c) ? 2 : 1), 0);
  const pad = (s: string, width: number) => s + " ".repeat(Math.max(0, width - w(s)));
  const nameW = Math.min(24, Math.max(10, ...rows.slice(0, top).map((r) => w(r.name))) + 2);
  out.push(`${pad("#", 4)}${pad("玩家", nameW)}${pad("局数", 8)}${pad("胜率", 8)}战绩`);
  rows.slice(0, top).forEach((r, i) => {
    out.push(`${pad(String(i + 1), 4)}${pad(r.name, nameW)}${pad(String(r.games), 8)}${pad(`${r.winRate.toFixed(1)}%`, 8)}${r.wins}胜`);
  });
  const me = rows.findIndex((r) => r.name.includes("今人不见古时月"));
  if (me >= 0) out.push("", `你的名次：第 ${me + 1} 名（${rows[me].games} 局 · ${rows[me].winRate.toFixed(1)}%）`);
  out.push("", "提示：把好友的历史同步进来（npm run archive:sync -- --friends）能让榜单更完整。");
  return out.join("\n");
}
