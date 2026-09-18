/** WeGame 接口枚举器 CLI：npm run wegame:enum [-- --cookie] [Service Method ...] */
import { wegameEnum } from "./wegame-enum.js";
const args = process.argv.slice(2);
const useCookie = args.includes("--cookie");
const extra = args.filter((a) => a !== "--cookie");
console.log(await wegameEnum(extra, useCookie));
