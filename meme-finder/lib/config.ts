import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** gh CLI 可执行文件。这台机器上装在 Program Files，且在 PATH 里。 */
  ghPath: string;
  /** 已找到的表情包合集的登记簿（本地 JSON 清单）。 */
  registryPath: string;
  /** 下载图片时的默认落地目录。 */
  downloadDir: string;
  /** 每次调 gh 的超时（毫秒）。 */
  ghTimeoutMs: number;
  /** 单次返回的图片条数上限，防止一次吐几千行。 */
  maxImages: number;
  /**
   * 下载单个文件的超时（毫秒）。
   *
   * 默认给得很宽（2 分钟）。**曾经硬编码 30 秒**，结果大 GIF（3 MB 级）走 jsdelivr
   * 经常超时被掐掉——实测 `deepseek-chan-emotes` 的两个 gif 就是这么失败的。
   * 图片文件大小差异极大，用一个偏紧的固定值必然误杀大文件。
   */
  fetchTimeoutMs: number;
}

const DEFAULT_GH = "C:\\Program Files\\GitHub CLI\\gh.exe";

function pickGh(): string {
  const fromEnv = process.env.GH_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(DEFAULT_GH)) return DEFAULT_GH;
  // 退回 PATH 查找
  return "gh";
}

export function loadConfig(): Config {
  const home = process.env.MEME_FINDER_HOME || join(homedir(), ".meme-finder");
  return {
    ghPath: pickGh(),
    registryPath: join(home, "packs.json"),
    downloadDir: process.env.MEME_FINDER_DOWNLOAD_DIR || join(home, "downloads"),
    ghTimeoutMs: Number(process.env.MEME_FINDER_GH_TIMEOUT_MS || 60000),
    maxImages: Number(process.env.MEME_FINDER_MAX_IMAGES || 200),
    fetchTimeoutMs: Number(process.env.MEME_FINDER_FETCH_TIMEOUT_MS || 120000),
  };
}
