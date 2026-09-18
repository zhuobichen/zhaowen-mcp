/** 手动跑对面阵容构成：npx tsx lib/comps-probe.ts [账号名] */
import { compsText } from "./comps.js";

const who = process.argv[2] || undefined;
compsText(who ? { name: who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
