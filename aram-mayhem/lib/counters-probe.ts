/** 手动跑「对面阵容 → 出装」：npx tsx lib/counters-probe.ts */
import { countersText } from "./counters.js";
countersText()
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
