import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";

/** 一条已找到的表情包合集记录。 */
export interface PackRecord {
  /** 唯一键：owner/repo 或 owner/repo#子目录 */
  id: string;
  repo: string;
  /** 仓库内的子目录；根目录为空串 */
  path: string;
  title: string;
  note: string;
  imageCount: number;
  /** 几条可直接用的示例链接，便于以后一眼认出来 */
  sampleUrls: string[];
  savedAt: string;
}

interface RegistryFile {
  version: 1;
  packs: PackRecord[];
}

export function readRegistry(): PackRecord[] {
  const cfg = loadConfig();
  if (!existsSync(cfg.registryPath)) return [];
  try {
    const raw = readFileSync(cfg.registryPath, "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    return Array.isArray(parsed?.packs) ? parsed.packs : [];
  } catch {
    // 清单坏了不能让整个服务挂掉——当作空清单，但不静默丢文件
    return [];
  }
}

function writeRegistry(packs: PackRecord[]): void {
  const cfg = loadConfig();
  mkdirSync(dirname(cfg.registryPath), { recursive: true });
  const body: RegistryFile = { version: 1, packs };
  // 先写临时文件再改名，避免写一半被杀留下坏 JSON
  const tmp = cfg.registryPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
  renameSync(tmp, cfg.registryPath);
}

export function packId(repo: string, path: string): string {
  const p = (path || "").replace(/^\/+|\/+$/g, "");
  return p ? `${repo}#${p}` : repo;
}

/** 新增或更新一条记录（同 id 覆盖）。返回是"新增"还是"更新"。id 由 repo+path 推出。 */
export function upsertPack(rec: Omit<PackRecord, "savedAt" | "id">): "created" | "updated" {
  const packs = readRegistry();
  const id = packId(rec.repo, rec.path);
  const existing = packs.findIndex((p) => p.id === id);
  const full: PackRecord = { ...rec, id, savedAt: new Date().toISOString() };
  if (existing >= 0) {
    full.savedAt = packs[existing].savedAt; // 保留首次登记时间
    packs[existing] = full;
    writeRegistry(packs);
    return "updated";
  }
  packs.push(full);
  writeRegistry(packs);
  return "created";
}

export function removePack(id: string): boolean {
  const packs = readRegistry();
  const next = packs.filter((p) => p.id !== id);
  if (next.length === packs.length) return false;
  writeRegistry(next);
  return true;
}

/** 按关键词过滤（匹配 id / repo / path / title / note）。无关键词则全返回。 */
export function queryPacks(keyword?: string): PackRecord[] {
  const packs = readRegistry();
  const k = (keyword || "").trim().toLowerCase();
  if (!k) return packs;
  return packs.filter((p) =>
    [p.id, p.repo, p.path, p.title, p.note].join(" ").toLowerCase().includes(k)
  );
}
