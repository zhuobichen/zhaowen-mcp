/**
 * 手动跑双账号对比报告。
 *   npx tsx lib/report-compare-probe.ts <账号B> [账号A] [--out 路径]
 * 账号 A 不传就是自己。
 */
import { reportCompareText } from "./report-compare.js";

const argv = process.argv.slice(2);
const flag = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((x, i) => !x.startsWith("--") && !(i > 0 && argv[i - 1]?.startsWith("--")));

const b = flag("--b") ?? positional[0];
const a = flag("--a") ?? positional[1];
if (!b) {
  console.error("用法: npx tsx lib/report-compare-probe.ts <账号B> [账号A] [--out 路径]");
  process.exit(1);
}

reportCompareText({ a, b, out: flag("--out") })
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
