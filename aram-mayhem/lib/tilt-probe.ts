/** 手动跑连败/连胜分析：npx tsx lib/tilt-probe.ts [账号名] */
import { tiltText } from "./tilt.js";

const who = process.argv[2] || undefined;
tiltText(who ? { who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
