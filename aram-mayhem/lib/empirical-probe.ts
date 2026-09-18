/** 手动跑实证统计：npx tsx lib/empirical-probe.ts [augments|pairs|synergy|all] */
import { empiricalAugmentsText, empiricalPairsText, synergyCheckText } from "./empirical.js";

const which = process.argv[2] ?? "all";
const run = async () => {
  if (which === "augments" || which === "all") {
    console.log(await empiricalAugmentsText({ top: 15 }));
    console.log("\n" + "=".repeat(70) + "\n");
  }
  if (which === "pairs" || which === "all") {
    console.log(await empiricalPairsText({ top: 12 }));
    console.log("\n" + "=".repeat(70) + "\n");
  }
  if (which === "synergy" || which === "all") {
    console.log(await synergyCheckText({}));
  }
};
run().catch((e) => {
  console.error("失败：", e?.message ?? e);
  process.exit(1);
});
