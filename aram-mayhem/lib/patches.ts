/**
 * 补丁维度：自己在每个版本里打得怎么样。
 *
 * 版本号来自对局记录的 `gameVersion`（形如 "16.18.817.4437"，取前两段即 16.18 —— 注意不是 26.18，见下），
 * **只有 SGP 会给**；本地客户端的历史摘要没有这个字段，所以：
 *   · 老数据可能没有版本号 —— 这类对局会被单独计成「版本未知」，不混进任何补丁；
 *   · 跑一次 npm run archive:sync 会用 SGP 把已有对局的版本号补回来（见 mergeIntoArchive）。
 *
 * 只读；数据来自 loadLolGames / loadTftGames（客户端 ∪ SGP ∪ 归档）。
 */
import { loadLolGames, loadTftGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

export interface PatchBucket {
  /** 对局记录里的原始版本号（前两段），如 "16.18"；没有版本号的记为 null */
  patch: string | null;
  /** 玩家习惯的补丁号（原始大版本 +10），如 "26.18"；推不出来时为 null */
  playerPatch: string | null;
  games: number;
  wins: number;
  winRate: number;
  kda: number;
  /** 海斗：场均伤害；云顶：平均名次 */
  avgDamage: number | null;
  avgPlacement: number | null;
  avgMinutes: number;
  /** 玩过的不同英雄数 */
  champions: number;
  firstPlayed: number | null;
  lastPlayed: number | null;
  /** 样本是否够下结论 */
  enough: boolean;
  /** 该补丁里玩得最多的几个英雄 */
  topChampions: Array<{ name: string; games: number; winRate: number }>;
}

export interface PatchReport {
  name: string;
  kind: "mayhem" | "tft";
  buckets: PatchBucket[];
  /** 有版本号 / 没有版本号 的局数 */
  withVersion: number;
  withoutVersion: number;
  /** 当前补丁 vs 上一个补丁 的一句话结论 */
  verdict: string;
  note: string;
}

/**
 * 对局记录里的 `gameVersion` 形如 `16.18.817.4437`，取前两段。
 *
 * ⚠ 这里有个容易踩的坑：**游戏写的 16.18 就是玩家说的 26.18**。
 * Riot 的赛季号比客户端版本号大 10（2025 赛季 = 25.x = 客户端 15.x；2026 赛季 = 26.x = 客户端 16.x）。
 * 本机数据的佐证：当前游戏内版本是 16.18，而社区站此时标的补丁号是 26.18 —— minor 一致；
 * 且 15.24 那批局都在 2026-01-01~03，正好是 25.24 的末尾。
 * 所以两个号都留着展示，但排序与判断一律用原始版本号（不做可能出错的猜测）。
 */
function patchOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{2,4}\.\d{1,2})\./.exec(v.trim());
  return m ? m[1] : null;
}

/** 原始版本号 → 玩家习惯的补丁号（赛季号 = 客户端大版本 + 10） */
function playerPatch(raw: string | null): string | null {
  if (!raw) return null;
  const [a, b] = raw.split(".").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `${a + 10}.${b}`;
}

export async function analyzePatches(
  opts: { who?: string; kind?: "mayhem" | "tft"; minGames?: number; verdictMinGames?: number } = {}
): Promise<PatchReport> {
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
  const d = loadData();

  interface Row {
    t: number;
    patch: string | null;
    win: boolean;
    champ: string;
    k: number;
    dd: number;
    a: number;
    dmg: number;
    place: number | null;
    minutes: number;
  }
  const rows: Row[] = [];

  if (kind === "tft") {
    const res = await loadTftGames(puuid, name);
    for (const g of res.games) {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      if (!p?.placement) continue;
      rows.push({
        t: g.gameCreation ?? 0,
        patch: patchOf(g.gameVersion),
        win: Number(p.placement) === 1,
        champ: "",
        k: 0,
        dd: 0,
        a: 0,
        dmg: 0,
        place: Number(p.placement),
        minutes: Math.round((g.gameDuration ?? 0) / 60),
      });
    }
  } else {
    const res = await loadLolGames(puuid, 2000, name);
    for (const g of res.games.filter(isMayhemGame)) {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      const s: any = p?.stats ?? {};
      if (s.win === undefined) continue;
      const cid = d.championIds[String(p?.championId)];
      rows.push({
        t: g.gameCreation ?? 0,
        patch: patchOf(g.gameVersion),
        win: s.win === true,
        champ: cid ? d.championById.get(cid.id)?.name ?? cid.name : "",
        k: Number(s.kills ?? 0),
        dd: Number(s.deaths ?? 0),
        a: Number(s.assists ?? 0),
        dmg: Number(s.totalDamageDealtToChampions ?? 0),
        place: null,
        minutes: Math.round((g.gameDuration ?? 0) / 60),
      });
    }
  }

  const withVersion = rows.filter((r) => r.patch).length;
  const withoutVersion = rows.length - withVersion;

  const map = new Map<string, Row[]>();
  let unknown: Row[] = [];
  for (const r of rows) {
    if (!r.patch) {
      unknown.push(r);
      continue;
    }
    const arr = map.get(r.patch) ?? [];
    arr.push(r);
    map.set(r.patch, arr);
  }

  const minGames = opts.minGames ?? 3;
  const build = (patch: string | null, rs: Row[]): PatchBucket => {
    const wins = rs.filter((r) => r.win).length;
    const places = rs.map((r) => r.place).filter((x): x is number => x != null);
    const champMap = new Map<string, { g: number; w: number }>();
    for (const r of rs) {
      if (!r.champ) continue;
      const c = champMap.get(r.champ) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      champMap.set(r.champ, c);
    }
    return {
      patch,
      playerPatch: playerPatch(patch),
      games: rs.length,
      wins,
      winRate: rs.length ? (wins / rs.length) * 100 : 0,
      kda: rs.reduce((s, r) => s + r.k + r.a, 0) / Math.max(rs.reduce((s, r) => s + r.dd, 0), 1),
      avgDamage: rs.length ? rs.reduce((s, r) => s + r.dmg, 0) / rs.length : null,
      avgPlacement: places.length ? places.reduce((a, b) => a + b, 0) / places.length : null,
      avgMinutes: rs.length ? rs.reduce((s, r) => s + r.minutes, 0) / rs.length : 0,
      champions: champMap.size,
      firstPlayed: rs.length ? Math.min(...rs.map((r) => r.t)) : null,
      lastPlayed: rs.length ? Math.max(...rs.map((r) => r.t)) : null,
      enough: rs.length >= minGames,
      topChampions: [...champMap.entries()]
        .map(([n, v]) => ({ name: n, games: v.g, winRate: (v.w / v.g) * 100 }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 3),
    };
  };

  // 补丁号按数值排序（26.9 要排在 26.10 前面，不能按字符串比）
  const verKey = (p: string) => {
    const [a, b] = p.split(".").map(Number);
    return a * 1000 + b;
  };
  const buckets: PatchBucket[] = [...map.entries()]
    .map(([p, rs]) => build(p, rs))
    .sort((a, b) => verKey(a.patch as string) - verKey(b.patch as string));
  if (unknown.length) buckets.push(build(null, unknown));

  // 跨版本下结论的门槛要比「列出来」高得多：一个补丁只打十来把，
  // 胜率差几十个百分点是噪声，不能当「变强了/变弱了」来讲。
  const verdictMin = opts.verdictMinGames ?? 15;
  const usable = buckets.filter((b) => b.games >= verdictMin && b.patch);
  const pn = (b: PatchBucket) => (b.playerPatch ? `${b.patch}=${b.playerPatch}` : String(b.patch));
  let verdict: string;
  if (usable.length >= 2) {
    const cur = usable[usable.length - 1];
    const prev = usable[usable.length - 2];
    const diff = cur.winRate - prev.winRate;
    verdict =
      `当前补丁 ${pn(cur)}：${cur.games} 局 ${cur.winRate.toFixed(1)}%；` +
      `上一个补丁 ${pn(prev)}：${prev.games} 局 ${prev.winRate.toFixed(1)}% —— ` +
      (Math.abs(diff) < 3
        ? "基本持平。"
        : diff > 0
          ? `新版好 ${diff.toFixed(1)} 个百分点。`
          : `新版差 ${Math.abs(diff).toFixed(1)} 个百分点，这个版本还没找到手感。`);
  } else if (buckets.filter((b) => b.games >= verdictMin && b.patch).length < 2) {
    const thin = [...buckets].filter((b) => b.patch).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)).slice(0, 2);
    verdict =
      `比不出跨版本变化：没有一个补丁攒到 ${verdictMin} 局（要比较的这个补丁得先有足够样本）。` +
      (thin.length
        ? `最近两个补丁目前是 ` +
          thin.map((b) => `${pn(b)} ${b.games} 局 ${b.winRate.toFixed(1)}%`).join("、") +
          " —— 数字可以看，但别当成「变强了」。"
        : "");
  } else if (usable.length === 1) {
    verdict = `只有 ${usable[0].patch} 一个补丁的样本够（${usable[0].games} 局），比不出跨版本变化。`;
  } else {
    verdict = withoutVersion
      ? "没有带版本号的对局 —— 跑一次 npm run archive:sync 用 SGP 把版本号补回来再看。"
      : "样本不够，暂时比不出跨版本变化。";
  }

  return {
    name,
    kind,
    buckets,
    withVersion,
    withoutVersion,
    verdict,
    note:
      `${rows.length} 局里 ${withVersion} 局带版本号、${withoutVersion} 局没有。` +
      `版本号来自对局记录的 gameVersion（只有 SGP 会给，本地客户端的历史摘要没有这个字段）。` +
      `注意 Riot 的赛季号比客户端版本号大 10：游戏写 16.18、玩家说的是 26.18，所以两个号都标出来。` +
      `没有版本号的局单独列成「版本未知」，不混进任何补丁。` +
      `样本 <${minGames} 局的补丁照样列出；跨版本结论的门槛更高（≥${opts.verdictMinGames ?? 15} 局），` +
      `够不上就直说比不出来，不拿十几把的胜率差当趋势。`,
  };
}

/** 文本输出 */
export async function patchesText(
  opts: { who?: string; kind?: "mayhem" | "tft"; minGames?: number; verdictMinGames?: number } = {}
): Promise<string> {
  let r: PatchReport;
  try {
    r = await analyzePatches(opts);
  } catch (e: any) {
    return `读取失败：${e?.message ?? e}`;
  }
  const fmtDate = (t: number | null) =>
    t ? new Date(t).toLocaleDateString("zh-CN", { year: "2-digit", month: "2-digit", day: "2-digit" }) : "—";

  const out: string[] = [];
  out.push(`${r.name} · 按补丁看${r.kind === "tft" ? "云顶" : "海斗"}`);
  out.push(r.note);
  out.push("");
  out.push(`结论：${r.verdict}`);
  out.push("");

  if (!r.buckets.length) return out.join("\n");

  const maxGames = Math.max(1, ...r.buckets.map((b) => b.games));
  for (const b of r.buckets) {
    const bar = "▇".repeat(Math.max(1, Math.round((b.games / maxGames) * 12)));
    const label = b.patch
      ? b.playerPatch && b.playerPatch !== b.patch
        ? `${b.patch}（${b.playerPatch}）`
        : b.patch
      : "版本未知";
    const metric =
      b.avgPlacement != null
        ? `平均名次 ${b.avgPlacement.toFixed(2)}`
        : `胜率 ${b.winRate.toFixed(1)}% · KDA ${b.kda.toFixed(2)} · 场均伤害 ${Math.round((b.avgDamage ?? 0) / 1000)}k`;
    out.push(`${label.padEnd(10)} ${String(b.games).padStart(3)} 局  ${bar}`);
    out.push(`    ${metric} · 平均时长 ${b.avgMinutes.toFixed(0)} 分 · ${b.champions} 个英雄`);
    if (b.topChampions.length) {
      out.push(`    常玩：${b.topChampions.map((c) => `${c.name}(${c.games}把${c.winRate.toFixed(0)}%)`).join("、")}`);
    }
    out.push(`    ${fmtDate(b.firstPlayed)} ~ ${fmtDate(b.lastPlayed)}${b.enough ? "" : "   ← 样本少，不作结论"}`);
  }
  return out.join("\n");
}
