/**
 * WeGame 战绩拉取 CLI：npm run wegame:history -- <昵称|openid> [选项]
 *
 *   --detail        连同每局详情一起拉（10 人 × 115 字段）。请求数 = 局数，慢
 *   --out <path>    输出 JSON 文件（不指定则只打摘要）
 *   --max-pages N   最多翻多少页（每页 10 局，默认 60）
 *
 * 例：
 *   npm run wegame:history -- 自己的丁ding
 *   npm run wegame:history -- 自己的丁ding --detail --out data/wegame-dump.json
 *
 * 注意：WeGame 历史深度上限约 500 局（offset 到 520 附近连续返回空即到底），
 * 比 SGP 路线浅得多。要长历史用 SGP；要官方评分/MVP/SVP/组队人数用这条。
 */
import { writeFileSync } from "node:fs";
import { loadWegameCookie, wgBattleDetail, wgCheckCookie, wgFindPlayer, wgPullAll } from "./wegame.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const USAGE = "用法：npm run wegame:history -- <昵称|openid> [--detail] [--out <path>] [--max-pages N]";

async function run(): Promise<number> {
  const target = process.argv[2];
  if (!target || target.startsWith("--")) {
    console.log(USAGE);
    return 0;
  }

  const { cookie, source } = loadWegameCookie();
  if (!cookie) {
    console.log("没有 WeGame cookie。获取方式见 lib/wegame.ts 文件头。");
    return 1;
  }
  console.log(`Cookie 来源：${source}（${cookie.length} 字符）`);

  // 先确认 cookie 还能用 —— 否则会把「登录过期」误报成「查不到这个玩家」
  const health = await wgCheckCookie(cookie);
  if (!health.ok) {
    console.log(`Cookie 不可用：${health.detail}`);
    console.log("→ 浏览器重新登录 https://www.wegame.com.cn 后重新取一份（见 lib/wegame.ts 文件头）。");
    return 1;
  }
  console.log("Cookie 状态：可用");

  // openid 是 base64（形如 xsyJ7Yj7YTMxrc733LSRyw==），否则当昵称去查
  let openid = target;
  if (!target.endsWith("==")) {
    const p = await wgFindPlayer(target, cookie);
    if (!p) {
      console.log(`查不到「${target}」—— SearchPlayer 需要游戏内完整昵称（可能要带 #tag）。`);
      console.log("（cookie 已确认可用，所以是真的没查到这个人，不是登录问题。）");
      return 1;
    }
    openid = p.openid;
    console.log(`玩家：${target} → openid ${openid}${p.level ? `（等级 ${p.level}）` : ""}`);
  }

  console.log("拉取战绩列表…");
  const t0 = Date.now();
  const { battles, pages, stopped } = await wgPullAll(openid, {
    maxPages: Number(arg("--max-pages") || 60),
    cookie,
  });
  console.log(
    `列表：${battles.length} 局（翻 ${pages} 页，${stopped}，${((Date.now() - t0) / 1000).toFixed(1)}s）`
  );
  if (!battles.length) return 1;

  const byQueue = new Map<number, number>();
  for (const b of battles) byQueue.set(b.game_queue_id, (byQueue.get(b.game_queue_id) ?? 0) + 1);
  console.log(
    "队列分布：" +
      [...byQueue.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([q, n]) => `${q}:${n}`)
        .join("  ")
  );
  const ts = battles.map((b) => Number(b.game_start_time)).filter(Boolean);
  if (ts.length) {
    console.log(
      `时间跨度：${new Date(Math.min(...ts)).toLocaleString("zh-CN")} ~ ${new Date(Math.max(...ts)).toLocaleString("zh-CN")}`
    );
  }
  console.log(
    `MVP ${battles.filter((b) => b.was_mvp).length} 次 · SVP ${battles.filter((b) => b.was_svp).length} 次`
  );

  const out: any = { target, openid, pulledAt: new Date().toISOString(), battles };

  if (process.argv.includes("--detail")) {
    console.log("拉取每局详情（耗时与局数成正比）…");
    const details: Record<string, any> = {};
    let done = 0;
    for (const b of battles) {
      const d = await wgBattleDetail(openid, b.game_id, cookie);
      if (d) details[String(b.game_id)] = d;
      if (++done % 50 === 0) console.log(`  ${done}/${battles.length}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    out.details = details;
    console.log(`详情：${Object.keys(details).length}/${battles.length} 局`);
  }

  const outPath = arg("--out");
  if (outPath) {
    const text = JSON.stringify(out);
    writeFileSync(outPath, text, "utf8");
    console.log(`已写入：${outPath}（${(text.length / 1024 / 1024).toFixed(1)} MB）`);
  }
  return 0;
}

process.exitCode = await run();
