/**
 * 本机固定下来的账号信息（data/profile.json）。
 *
 * 只有名字/puuid/等级/时间，不含任何凭据；已被 .gitignore 排除。
 * 客户端没开时，靠它才能知道「我是谁」，从而用本地归档出分析。
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LcuSummoner } from "./lcu.js";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
export const PROFILE_FILE = path.join(DATA_DIR, "profile.json");

export interface Profile {
  summonerName: string;
  puuid: string | null;
  summonerId: number | null;
  level: number | null;
  updatedAt: string;
}

export function loadProfile(): Profile | null {
  if (!existsSync(PROFILE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PROFILE_FILE, "utf8")) as Profile;
  } catch {
    return null;
  }
}

export async function saveProfile(s: LcuSummoner): Promise<Profile> {
  const p: Profile = {
    summonerName: s.displayName || s.gameName || "(未命名)",
    puuid: s.puuid ?? null,
    summonerId: s.summonerId ?? null,
    level: s.summonerLevel ?? null,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PROFILE_FILE, JSON.stringify(p, null, 2), "utf8");
  return p;
}

/** 当前账号（在线时刷新并保存，离线时读上次保存的） */
export async function ensureProfile(): Promise<Profile | null> {
  const { clientStatus, getSummoner } = await import("./lcu.js");
  const status = await clientStatus();
  if (status.reachable) {
    try {
      const s = await getSummoner();
      return await saveProfile(s);
    } catch {
      return loadProfile();
    }
  }
  return loadProfile();
}
