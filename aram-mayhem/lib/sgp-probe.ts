/**
 * SGP 探针：实测**你的账号**能翻到多少历史（这是这条路上唯一只能靠实机验证的未知数）。
 *
 * 用法：npm run sgp:probe            # 默认每页 20，最多翻 300 条（够看出深浅）
 *      npm run sgp:probe -- 100 1000  # 自定义：页大小 100、上限 1000
 *
 * 只读、低频、只查自己账号；不写任何文件（除 stdout）。
 */
import { clientStatus, isMayhemGame } from "./lcu.js";
import { fetchSgpHistory, getSgpContext, type SgpSummary } from "./sgp.js";
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

  const pageSize = Number(process.argv[2] ?? 20) || 20;
  const maxGames = Number(process.argv[3] ?? 300) || 300;
  console.log(`\n开始翻页：每页 ${pageSize}，上限 ${maxGames}\n`);

  const all: SgpSummary[] = [];
  let emptyAt: number | null = null;
  try {
    await fetchSgpHistory(ctx, ctx.puuid, {
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
  const games = await fetchSgpHistory(ctx, ctx.puuid, { pageSize, maxGames });
  all.push(...games);

  if (!games.length) {
    console.log("SGP 返回 0 条。要么这个接口对该账号不返回数据，要么参数/鉴权还有问题。");
    return;
  }

  const mayhem = games.filter((g) => isMayhemGame({ gameMode: g.gameMode ?? "", queueId: g.queueId ?? 0 } as any));
  const times = games.map((g) => g.gameCreation ?? 0).filter(Boolean).sort((a, b) => a - b);
  const byQueue = new Map<number, number>();
  for (const g of games) byQueue.set(g.queueId ?? 0, (byQueue.get(g.queueId ?? 0) ?? 0) + 1);

  console.log("\n=== 实测结果 ===");
  console.log(`共取到 ${games.length} 局${emptyAt != null ? `（翻到 startIndex=${emptyAt} 时为空，说明到底了）` : `（达到本次上限 ${maxGames}，还能继续翻）`}`);
  console.log(`时间跨度：${fmt(times[0])} ~ ${fmt(times[times.length - 1])}`);
  console.log(`其中海斗：${mayhem.length} 局`);
  console.log("队列分布：");
  for (const [id, c] of [...byQueue.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  · ${await queueName(id)}（${id}）：${c} 局`);
  }
  const first = games[0];
  console.log("\n首条记录的字段（用于写解析）：");
  console.log("  " + Object.keys(first).join(", "));
  console.log("  " + JSON.stringify(first).slice(0, 500));
  console.log("\n对比：本地客户端上限是海斗 200 局 / 云顶 20 局。");

  // 首条游戏的详情接口（确认 DETAILS 是否可用）
  const firstId = first.gameId;
  if (firstId) {
    const idStr = `${(first as any).gameId}`;
    try {
      const detail = await (await import("./sgp.js")).sgpGet<any>(
        `/match-history-query/v1/products/lol/${idStr}/DETAILS`,
        ctx
      );
      const keys = Object.keys(detail ?? {});
      console.log(`\nDETAILS 接口可用：字段 ${keys.slice(0, 14).join(", ")}${keys.length > 14 ? " …" : ""}`);
    } catch (e: any) {
      console.log(`\nDETAILS 接口未通：${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
}

main().catch((e) => {
  console.error("探针失败:", e?.message ?? e);
  process.exit(1);
});
