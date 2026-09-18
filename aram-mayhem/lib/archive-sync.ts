/**
 * 归档同步：把当前账号（可选连同好友）的联盟/云顶对局一次性并进本地归档。
 *
 * 用法：
 *   npm run archive:sync              # 同步自己
 *   npm run archive:sync -- --friends # 连好友一起（按好友列表逐个拉）
 *
 * 为什么要单独跑：平常查询只会顺带并入「那次查询涉及到的账号」，跑一次同步能把
 * 所有关心的账号一次性补齐，攒得更快（归档只增不减，攒久了覆盖时间能超过接口窗口）。
 */
import { archiveStats, mergeIntoArchive } from "./archive.js";
import { clientStatus, getMatchHistory } from "./lcu.js";
import { listFriends } from "./friends.js";
import { getTftGames } from "./tft.js";
import { resolveMe } from "./identity.js";

const fmt = (t: number | null) => (t ? new Date(t).toLocaleDateString("zh-CN") : "—");

async function syncOne(name: string, puuid: string) {
  const out: string[] = [];
  try {
    const { games } = await getMatchHistory(200, puuid);
    const r = await mergeIntoArchive("lol", games, puuid, name);
    out.push(`  联盟：读到 ${games.length} 局，新并入 ${r.added} 局（归档共 ${r.total} 局）`);
  } catch (e: any) {
    out.push(`  联盟：读取失败 —— ${e?.message ?? e}`);
  }
  try {
    const tft = await getTftGames(puuid);
    const r = await mergeIntoArchive("tft", tft, puuid, name);
    out.push(`  云顶：读到 ${tft.length} 局，新并入 ${r.added} 局（归档共 ${r.total} 局）`);
  } catch (e: any) {
    out.push(`  云顶：读取失败 —— ${e?.message ?? e}`);
  }
  console.log(`· ${name}\n${out.join("\n")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const withFriends = args.includes("--friends");

  const status = await clientStatus();
  if (!status.reachable) {
    console.log(`客户端没开，无法同步（${status.error}）。`);
    console.log("归档仍可用：现有覆盖情况见 npm run report 或 get_archive_info。");
    return;
  }

  const me = await resolveMe();
  if (!me) {
    console.log("拿不到当前账号身份，无法同步。");
    return;
  }
  console.log(`开始同步（客户端在线）：`);
  await syncOne(me.name, me.puuid);

  if (withFriends) {
    const friends = (await listFriends()).filter((f) => f.puuid);
    console.log(`\n好友 ${friends.length} 个：`);
    for (const f of friends) {
      await syncOne(`${f.gameName}#${f.gameTag}`, f.puuid as string);
    }
  }

  const lol = await archiveStats("lol");
  const tft = await archiveStats("tft");
  console.log("\n=== 归档现状 ===");
  console.log(`联盟：${lol.total} 局（${fmt(lol.from)} ~ ${fmt(lol.to)}），账号 ${lol.accounts.length} 个`);
  console.log(`云顶：${tft.total} 局（${fmt(tft.from)} ~ ${fmt(tft.to)}），账号 ${tft.accounts.length} 个`);
  console.log(`提示：${withFriends ? "" : "加 --friends 可把好友的一并同步；"}归档只增不减，定期跑一次就能越攒越全。`);
}

main().catch((e) => {
  console.error("同步失败:", e?.message ?? e);
  process.exit(1);
});
