/** 手动跑单局详情：npx tsx lib/game-detail-probe.ts [最近第N把|日期|英雄名|gameId] */
import { gameDetailText } from "./game-detail.js";

const arg = process.argv[2];
const opts: any = {};
if (arg) {
  // 长数字串是 gameId，短数字才是「最近第 N 把」—— 否则 gameId 会被当成超大的 index
  if (/^\d{6,}$/.test(arg)) opts.which = arg;
  else if (/^\d+$/.test(arg)) opts.index = Number(arg);
  else opts.which = arg;
} else {
  opts.index = 1;
}
gameDetailText(opts)
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
