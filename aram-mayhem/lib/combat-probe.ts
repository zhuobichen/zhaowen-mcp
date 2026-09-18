/** 手动跑「伤害以外的贡献」：npx tsx lib/combat-probe.ts [账号名] */
import { combatText } from "./combat-profile.js";

const who = process.argv[2] || undefined;
combatText(who ? { name: who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
