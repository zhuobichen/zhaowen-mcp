/** 手动跑跨时间对比：npx tsx lib/report-self-probe.ts [账号] [每段把数] [--out 路径] */
import { reportSelfCompareText } from "./report-compare.js";

const argv = process.argv.slice(2);
const flag = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const pos = argv.filter((x, i) => !x.startsWith("--") && !(i > 0 && argv[i - 1]?.startsWith("--")));

reportSelfCompareText({
  who: pos[0],
  window: pos[1] ? Number(pos[1]) : undefined,
  out: flag("--out"),
})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
