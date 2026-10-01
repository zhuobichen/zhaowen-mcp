import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config.js";

const pExecFile = promisify(execFile);

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** 调 gh CLI。gh 已登录（zhuobichen），所以不需要自己管 token。 */
export async function gh(args: string[]): Promise<GhResult> {
  const cfg = loadConfig();
  try {
    const { stdout, stderr } = await pExecFile(cfg.ghPath, args, {
      timeout: cfg.ghTimeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
    });
    return { ok: true, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (e: any) {
    return {
      ok: false,
      stdout: (e && e.stdout) || "",
      stderr: (e && e.stderr) || String(e && e.message ? e.message : e),
    };
  }
}

export async function ghJson<T = any>(args: string[]): Promise<T | null> {
  const r = await gh(args);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return null;
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

export function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p);
}

/**
 * 把 GitHub 的 raw 直链改写成这台机器真正连得上的地址。
 *
 * 背景：api.github.com 返回的 download_url 全是 raw.githubusercontent.com。
 * 该域名在本机「有时通、有时 20 秒超时」（两次实测结论相反），所以默认走
 * cdn.jsdelivr.net —— 它无需认证、有 CDN、对中文/emoji 路径做 URL 编码后正常。
 * 注意 jsdelivr 需要 owner/repo@ref/path 三段，ref 用分支名。
 */
export function toReachableUrl(args: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  prefer?: "jsdelivr" | "raw" | "ghfast";
}): string {
  const { owner, repo, ref, path } = args;
  const encodedPath = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encodedPath}`;
  switch (args.prefer ?? "jsdelivr") {
    case "raw":
      return raw;
    case "ghfast":
      return `https://ghfast.top/${raw}`;
    case "jsdelivr":
    default:
      return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${encodedPath}`;
  }
}

/** 把 "owner/repo" 拆开；拿不到就返回 null。 */
export function splitRepo(fullName: string): { owner: string; repo: string } | null {
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(fullName.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export interface RepoInfo {
  fullName: string;
  description: string;
  stars: number;
  defaultBranch: string;
  sizeKB: number;
  updatedAt: string;
}

/**
 * 搜仓库。
 *
 * ⚠️ 字段名是 gh 的坑之一：`gh search repos --json` 和 `gh repo view --json`
 * **用的不是同一套字段**——
 *   - search：`defaultBranch`（字符串）、有 `stargazersCount` / `size`
 *   - view  ：`defaultBranchRef`（对象）、**没有** `stargazersCount` / `size`
 * 写错一个，整条 --json 请求会直接失败并返回**空数组**（不是报错），
 * 表现为"搜不到任何东西"，很容易误判成搜索词不好。
 */
export async function searchRepos(query: string, limit: number): Promise<RepoInfo[]> {
  const raw = await ghJson<any[]>([
    "search", "repos", query,
    "--limit", String(limit),
    "--json", "fullName,description,stargazersCount,size,updatedAt,defaultBranch",
  ]);
  if (!raw) return [];
  return raw.map((r) => ({
    fullName: String(r.fullName ?? ""),
    description: String(r.description ?? ""),
    stars: Number(r.stargazersCount ?? 0),
    sizeKB: Number(r.size ?? 0),
    updatedAt: String(r.updatedAt ?? ""),
    defaultBranch: String(r.defaultBranch ?? "main"),
  }));
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

/**
 * 一次拿全仓库文件树（recursive=1）。比 contents API 好：
 * 后者单目录最多 1000 条、大仓库要一层层递归。
 */
export async function fetchTree(fullName: string, ref: string): Promise<TreeEntry[]> {
  const raw = await ghJson<{ tree?: any[]; truncated?: boolean }>([
    "api", `repos/${fullName}/git/trees/${ref}?recursive=1`,
  ]);
  if (!raw || !Array.isArray(raw.tree)) return [];
  return raw.tree.map((e) => ({
    path: String(e.path ?? ""),
    type: e.type === "tree" ? "tree" : "blob",
    size: typeof e.size === "number" ? e.size : undefined,
  }));
}

/**
 * 取单个仓库的信息。
 *
 * 注意：**不要用 `gh repo view --json stargazersCount,size`** —— 它不支持这两个字段
 * （会直接报 "Unknown JSON field"）。`gh search repos --json` 支持，所以搜索路径不会
 * 暴露这个问题，只有单仓库路径会挂。这里走 REST API，字段是 snake_case。
 */
export async function repoInfo(fullName: string): Promise<RepoInfo | null> {
  const r = await ghJson<any>(["api", `repos/${fullName}`]);
  if (!r || !r.full_name) return null;
  return {
    fullName: String(r.full_name),
    description: String(r.description ?? ""),
    stars: Number(r.stargazers_count ?? 0),
    sizeKB: Number(r.size ?? 0),
    updatedAt: String(r.updated_at ?? ""),
    defaultBranch: String(r.default_branch ?? "main"),
  };
}
