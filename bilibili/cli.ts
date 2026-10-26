/**
 * bili-cli —— 把 bilibili-mcp 的数据函数暴露成命令行（便于 Ember 等下游调用）
 *
 * 复用 sources.ts，不重复实现接口与 WBI 签名。
 * 用 tsx 运行：npx tsx cli.ts <command> [args]
 *
 * 登录态（可选）：环境变量 BILI_COOKIE，形如 "SESSDATA=xxx; bili_jct=yyy"。
 * 不提供时，只读的 popular / ranking / search / video 仍可用；history / favorites / watchtime 会报错。
 */

import {
  getVideo,
  searchVideos,
  listPopular,
  getHistory,
  listFavorites,
  getRanking,
  getWatchTime,
  checkLogin
} from './sources.js';

const cookie = process.env.BILI_COOKIE || '';
const opts = { cookie };

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const num = (name: string, def: number) => Number(arg(name, String(def)));

function out(payload: unknown) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

const cmd = process.argv[2];

try {
  switch (cmd) {
    case 'popular':
      out({ source: 'bilibili', kind: 'popular', items: await listPopular(num('limit', 20), opts) });
      break;

    case 'ranking':
      out({ source: 'bilibili', kind: 'ranking', items: await getRanking(num('limit', 20), opts, num('rid', 0)) });
      break;

    case 'search': {
      const kw = arg('kw');
      if (!kw) throw new Error('缺少 --kw <关键词>');
      out({ source: 'bilibili', kind: 'search', keyword: kw, items: await searchVideos(kw, num('limit', 20), opts) });
      break;
    }

    case 'video': {
      const bvid = arg('bvid');
      if (!bvid) throw new Error('缺少 --bvid BV...');
      out({ source: 'bilibili', kind: 'video', items: [await getVideo(bvid, opts)] });
      break;
    }

    case 'history':
      out({ source: 'bilibili', kind: 'history', items: await getHistory(num('limit', 50), opts) });
      break;

    case 'favorites':
      out({ source: 'bilibili', kind: 'favorites', items: await listFavorites(num('limit', 50), opts) });
      break;

    case 'watchtime':
      out({ source: 'bilibili', kind: 'watchtime', data: await getWatchTime(num('days', 30), opts) });
      break;

    case 'whoami':
      out(await checkLogin(opts));
      break;

    default:
      process.stdout.write(`bili-cli — B站数据命令行（复用 bilibili-mcp 的 sources.ts）

用法:
  npx tsx cli.ts popular   [--limit 20]
  npx tsx cli.ts ranking   [--limit 20] [--rid 0]
  npx tsx cli.ts search    --kw 关键词 [--limit 20]
  npx tsx cli.ts video     --bvid BV1xx411c7mD
  npx tsx cli.ts history   [--limit 50]     # 需 BILI_COOKIE
  npx tsx cli.ts favorites [--limit 50]     # 需 BILI_COOKIE
  npx tsx cli.ts watchtime [--days 30]      # 需 BILI_COOKIE
  npx tsx cli.ts whoami                     # 看登录态

登录态: set BILI_COOKIE=SESSDATA=xxx; bili_jct=yyy
`);
      process.exit(cmd ? 1 : 0);
  }
} catch (e: any) {
  process.stderr.write(`错误: ${e?.message || e}\n`);
  process.exit(1);
}
