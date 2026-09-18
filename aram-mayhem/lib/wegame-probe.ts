/** WeGame/Pallas 战绩接口探针 CLI：npm run wegame:probe -- 你的昵称 */
import { wegameProbe } from "./wegame.js";
console.log(await wegameProbe(process.argv[2]));
