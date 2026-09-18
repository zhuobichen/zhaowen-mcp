/**
 * SGP 探针：实测**能翻到多少历史**（这条路上唯一只能靠实机验证的未知数）。
 *
 * 用法：
 *   npm run sgp:probe                      # 自己：每页 20、上限 300（够看出深浅）
 *   npm run sgp:probe -- 100 1000          # 自己：页大小 100、上限 1000
 *   npm run sgp:probe -- --friend 丁ding    # 好友（用你的登录态查 TA 的 puuid）
 *
 * 说明：SGP 的查询是按 puuid 的，所以**好友的历史一样能翻**（只要你在线、且知道 TA 的 puuid）；
 * 探针只读、低频；不写任何文件（除 stdout）。
 */
import { clientStatus, isMayhemGame } from "./lcu.js";
import { fetchSgpHistory, getSgpContext, queueIdFromTags, unwrapSgp, type SgpSummary } from "./sgp.js";
import { queueName } from "./queues.js";

const fmt = (t?: number) => (t ? new Date(t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "short" }) : "?");

async function main() {
  const status = await clientStatus();
  if (!status.reachable) {
    console.log(`客户端没开，读不到 SGP 凭据（${String(status.error).slice(0, 80)}）。`);
    console.log("SGP 用的是本机客户端的登录态，所以必须先开客户端并登录到大厅。");
    return;
  }

  const ctx = await getSgpContext();
  console.log("=== SGP 探针 ===");
  console.log(`大区 ${ctx.platformId} · 服务器 ${ctx.host}`);
  console.log(`账号 ${ctx.summonerName ?? "(未命名)"} · puuid ${ctx.puuid}`);
  console.log(`token 长度 ${ctx.accessToken.length} 字符（本机客户端签发，未落盘）`);
  if (!ctx.puuid) {
    console.log("拿不到 puuid，无法查询。");
    return;
  }

  // 支持 --friend <名字>：用本机登录态查好友的 puuid
  const fi = process.argv.indexOf("--friend");
  let targetPuuid = ctx.puuid;
  let targetName = ctx.summonerName ?? "(未命名)";
  if (fi >= 0) {
    const who = process.argv[fi + 1];
    if (!who) {
      console.log("--friend 后面要跟好友名字（部分匹配即可）");
      return;
    }
    const { resolveAccountByName } = await import("./identity.js");
    const r = await resolveAccountByName(who);
    if (!r.matches.length) {
      console.log(`没找到好友「${who}」——${r.note}`);
      return;
    }
    if (r.matches.length > 1) {
      console.log(`「${who}」匹配到多个：${r.matches.map((m) => m.name).join("、")}`);
      return;
    }
    targetPuuid = r.matches[0].puuid;
    targetName = `好友 ${r.matches[0].name}`;
  }
  const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  const pageSize = Number(nums[0] ?? 20) || 20;
  const maxGames = Number(nums[1] ?? 300) || 300;
  console.log(`查询对象：${targetName}`);
  console.log(`\n开始翻页：每页 ${pageSize}，上限 ${maxGames}\n`);

  const all: SgpSummary[] = [];
  let emptyAt: number | null = null;
  try {
    await fetchSgpHistory(ctx, targetPuuid!, {
      pageSize,
      maxGames,
      onPage: (p) => {
        console.log(`  startIndex=${p.startIndex} → ${p.count} 条`);
        if (!p.count) emptyAt = p.startIndex;
      },
    });
  } catch (e: any) {
    console.log(`\n请求失败：${e?.message ?? e}`);
    console.log("可能原因：客户端未登录 / token 过期 / 该大区不接受此接口 / 网络到 SGP 不通。");
    return;
  }

  // 重新拉一遍完整数据用于统计（探针里简单起见再跑一次，页数不大）
  const games = await fetchSgpHistory(ctx, targetPuuid!, { pageSize, maxGames });
  all.push(...games);

  if (!games.length) {
    console.log("SGP 返回 0 条。要么这个接口对该账号不返回数据，要么参数/鉴权还有问题。");
    return;
  }

  const gamesPlain = games.map((g) => ({ item: g, j: unwrapSgp(g) ?? {}, q: queueIdFromTags(g) ?? unwrapSgp(g)?.queueId ?? 0 }));
  const mayhem = gamesPlain.filter((g) => g.q === 2400 || /KIWI/.test(String(g.j.gameMode ?? "")));
  const times = gamesPlain.map((g) => Number(g.j.gameCreation ?? 0)).filter(Boolean).sort((a, b) => a - b);
  const byQueue = new Map<number, number>();
  for (const g of gamesPlain) byQueue.set(g.q, (byQueue.get(g.q) ?? 0) + 1);

  console.log("\n=== 实测结果 ===");
  console.log(
    `共取到 ${games.length} 局${emptyAt != null || games.length % pageSize !== 0 ? "（翻到底了，这就是 SGP 保留的深度）" : `（达到本次上限 ${maxGames}，还能继续翻）`}`
  );
  console.log(`时间跨度：${times.length ? fmt(times[0]) + " ~ " + fmt(times[times.length - 1]) : "未知"}`);
  console.log(`其中海斗：${mayhem.length} 局`);
  console.log("队列分布：");
  for (const [id, c] of [...byQueue.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  · ${await queueName(id)}（${id}）：${c} 局`);
  }
  const first = games[0];
  const j0 = unwrapSgp(first) ?? {};
  console.log("\n首条记录的字段（用于写解析）：");
  console.log("  metadata.tags = " + JSON.stringify(first.metadata?.tags));
  console.log("  json keys = " + Object.keys(j0).join(", "));
  const ps = j0.participants ?? [];
  const me = ps.find((p: any) => p.puuid === targetPuuid) ?? ps[0] ?? {};
  console.log(`  participants = ${ps.length} 人；我这行：championId=${me.championId} win=${me.win} 符文=${[
    1, 2, 3, 4, 5, 6,
  ].map((i) => me["playerAugment" + i]).filter(Boolean).join("/")}`);
  console.log("\n对比：本地客户端上限是海斗 200 局 / 云顶 20 局，且只有自己那一行数据（SGP 有全部 10 人）。");

  // 详情接口：拿第一局的 DETAILS 看看能不能取到更多
  const firstId = j0.gameId;
  if (firstId) {
    try {
      const detail: any = await (await import("./sgp.js")).sgpGet<any>(
        `/match-history-query/v1/products/lol/HN1_${firstId}/DETAILS`,
        ctx
      );
      const keys = Object.keys(detail ?? {});
      console.log(`
DETAILS 接口可用：字段 ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? " …" : ""}`);
    } catch (e: any) {
      console.log(`
DETAILS 接口未通：${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
}

main().catch((e) => {
  console.error("探针失败:", e?.message ?? e);
  process.exit(1);
});
