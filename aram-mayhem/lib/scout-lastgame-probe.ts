/**
 * 查「最近一局」里每个人的战绩。
 *
 * 用途：打完一局想知道队友/对手什么水平。人选从那局的完整 10 人名单里来（归档或 SGP 都带 puuid），
 * 再逐个用 SGP 拉他自己的最近 N 局 —— 这是**唯一**能看陌生人的路：
 *   · Live Client Data（对局中，端口 2999）只给 Riot ID，不给 puuid，拉不了历史
 *   · 客户端按名字反查（POST /lol-summoner/v2/summoners/names）只认已知的人，陌生人返回空
 *   · 对局记录里带全部参与者的 puuid —— 所以「先有那局，才有这些人的战绩」
 *
 * 跑：npm run scout:last         （最近一局）
 *     npm run scout:last -- 2    （往前数第 2 局）
 *     npm run scout:last -- 1 --games 50    （每人看最近 50 局）
 */
import { loadLolGames } from "./games.js";
import { isMayhemGame } from "./lcu.js";
import { fetchSgpHistory, getSgpContext, sgpToGame } from "./sgp.js";
import { resolveMe } from "./identity.js";
import { loadData } from "./store.js";

const idx = Math.max(1, Number(process.argv[2]) || 1);
const PER = Math.max(5, Number(process.argv[4]) || 20);

const me = await resolveMe();
if (!me) {
  console.error("读不到账号：先把客户端打开（或先在线跑一次 get_my_account_status）。");
  process.exit(1);
}

// 最近的对局（归档 ∪ 实时）
const res = await loadLolGames(me.puuid, 200, me.name);
const games = res.games
  .filter(isMayhemGame)
  .sort((a: any, b: any) => (b.gameCreation ?? 0) - (a.gameCreation ?? 0));

const g: any = games[idx - 1];
if (!g) {
  console.error(`往前数第 ${idx} 局不存在（归档+实时里共 ${games.length} 局）。`);
  process.exit(1);
}
const parts: any[] = g.participants ?? [];
if (parts.length < 4) {
  console.error("这一局没有完整 10 人名单（只有自己那行），统计不了。换一局试试。");
  process.exit(1);
}

const d = loadData();
const champName = (id: number) => {
  const cid = d.championIds[String(id)];
  return cid ? d.championById.get(cid.id)?.name ?? cid.name : `英雄#${id}`;
};
const mePart = parts.find((p) => p.puuid === me.puuid);
const myTeam = mePart?.teamId;

console.log(`最近第 ${idx} 局：${new Date(g.gameCreation).toLocaleString("zh-CN")} · ${champName(Number(mePart?.championId))}`);
console.log(`（每人看他自己最近 ${PER} 局，含非海斗模式）\n`);

const ctx = await getSgpContext();

/** 拉一个人最近 N 局的战绩 */
async function recordOf(puuid: string, name: string) {
  try {
    const raw = await fetchSgpHistory(ctx, puuid, { pageSize: Math.min(PER, 100), maxGames: PER, product: "lol" });
    const rows = raw.map((x) => sgpToGame(x, puuid)).filter((x: any) => x?.gameCreation);
    if (!rows.length) return { name, note: "（拉不到记录）" };
    const stat = rows
      .map((x: any) => (x.participants ?? []).find((q: any) => q.puuid === puuid))
      .filter(Boolean);
    const wins = stat.filter((s: any) => s.stats?.win === true).length;
    const n = stat.length;
    const kd = stat.reduce((s: any, x: any) => s + Number(x.stats?.kills ?? 0), 0);
    const dd = stat.reduce((s: any, x: any) => s + Number(x.stats?.deaths ?? 0), 0);
    const champs = new Map<string, number>();
    for (const s of stat) {
      const c = champName(Number(s.championId));
      champs.set(c, (champs.get(c) ?? 0) + 1);
    }
    const top = [...champs].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      name,
      note: `${n} 局 · 胜率 ${((wins / n) * 100).toFixed(0)}%（${wins}胜${n - wins}负）· KDA ${(kd / Math.max(dd, 1)).toFixed(2)} · 常玩 ${top.map(([c, k]) => `${c}${k}`).join("/")}`,
    };
  } catch (e: any) {
    return { name, note: `（查询失败：${String(e?.message ?? e).slice(0, 40)}）` };
  }
}

for (const side of [
  { label: "我方", mine: true },
  { label: "对面", mine: false },
]) {
  const list = parts.filter((p) => (p.teamId === myTeam) === side.mine);
  console.log(`【${side.label}】`);
  for (const p of list) {
    const nm = p.summonerName ?? p.name ?? "（未知）";
    if (p.puuid === me.puuid) {
      console.log(`  ${nm.padEnd(22)} ← 你`);
      continue;
    }
    const r = await recordOf(p.puuid, nm);
    console.log(`  ${r.name.padEnd(22)} ${r.note}`);
  }
  console.log("");
}

console.log(
  "口径：这是**每人自己最近 N 局的整体战绩**（含各种模式），不是海斗专场的 ——\n" +
    "SGP 的按玩家历史接口不按队列过滤，所以拿到的是全模式混合的胜率。看水平够用，别当成海斗胜率。"
);
