import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { loadConfig } from "./lib/config.js";
import {
  fetchTree,
  isImagePath,
  repoInfo,
  searchRepos,
  splitRepo,
  toReachableUrl,
  type RepoInfo,
  type TreeEntry,
} from "./lib/github.js";
import { packId, queryPacks, removePack, upsertPack } from "./lib/registry.js";
import { MEGA_REPOS, QUERY_SUFFIXES } from "./lib/sources.js";

// ---------------------------------------------------------------- 工具实现

function stars(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

async function toolSearchPacks(args: any): Promise<string> {
  const keyword = String(args.keyword ?? "").trim();
  if (!keyword) return "错误: 需要 keyword（想找什么主题的表情包，如「丁真」「蓝色大肥鱼」）";
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 30);
  const includeMega = args.include_mega !== false;

  const out: string[] = [];
  out.push(`# 搜「${keyword}」的表情包合集\n`);

  // 1) 仓库搜索。
  //
  // 顺序很重要：**必须先搜裸关键词**。GitHub 的仓库搜索对多个词是 AND 关系，
  // 而仓库名/简介里未必同时出现「蓝色大肥鱼」和「表情包」——实测
  // 「蓝色大肥鱼」给 10 个结果，「蓝色大肥鱼 表情包」只给 1 个。
  // 所以后缀只当补充，命中不了就算了，不能让它决定结果集。
  const seen = new Map<string, RepoInfo>();
  const queries: string[] = [keyword];
  for (const suf of QUERY_SUFFIXES) queries.push(`${keyword} ${suf}`);

  let bareHits = 0;
  for (let qi = 0; qi < queries.length; qi++) {
    const found = await searchRepos(queries[qi], limit);
    if (qi === 0) bareHits = found.length;
    for (const r of found) {
      if (!r.fullName || seen.has(r.fullName.toLowerCase())) continue;
      seen.set(r.fullName.toLowerCase(), r);
    }
  }

  const repos = [...seen.values()].sort((a, b) => b.stars - a.stars).slice(0, limit);
  if (repos.length) {
    out.push(`## 一、仓库（按 star 排，共 ${repos.length} 个；裸词「${keyword}」命中 ${bareHits} 个）\n`);
    for (const r of repos) {
      const size = r.sizeKB >= 1024 ? `${(r.sizeKB / 1024 / 1024).toFixed(1)} GB` : `${r.sizeKB} KB`;
      out.push(`- **${r.fullName}**  ★${stars(r.stars)}  ${size}  更新 ${r.updatedAt.slice(0, 10)}`);
      if (r.description) out.push(`  ${r.description}`);
      out.push(`  → 列目录: \`list_pack\` 传 repo="${r.fullName}"`);
    }
    out.push("");
  } else {
    out.push("## 一、仓库\n（没搜到。换更短的词，或者用英文/拼音再试一次。）\n");
  }

  // 2) 巨型图集仓库里按目录名匹配——很多主题没有独立仓库，但巨型仓库里有目录
  if (includeMega) {
    out.push("## 二、巨型图集仓库里的目录匹配\n");
    let any = false;
    for (const m of MEGA_REPOS) {
      const info = await repoInfo(m.repo);
      if (!info) {
        out.push(`- ${m.repo} — 取不到（可能已删除或改名）`);
        continue;
      }
      const tree = await fetchTree(m.repo, info.defaultBranch);
      const dirs = tree.filter((t) => t.type === "tree").map((t) => t.path);
      const hits = dirs.filter((d) => d.toLowerCase().includes(keyword.toLowerCase()));
      if (!hits.length) continue;
      any = true;
      out.push(`- **${m.repo}**  ★${stars(info.stars)} — 命中 ${hits.length} 个目录:`);
      for (const h of hits.slice(0, 12)) {
        out.push(`  - \`${h}\`  → \`list_pack\` repo="${m.repo}" path="${h}"`);
      }
      if (hits.length > 12) out.push(`  - …另有 ${hits.length - 12} 个`);
    }
    if (!any) out.push("（以上巨型仓库里没有目录名命中。这不代表没有——目录名可能是英文或拼音。）");
  }

  out.push("\n---\n找到之后用 `save_pack` 把位置记下来，下次 `list_saved` 就能翻出来。");
  return out.join("\n");
}

async function collectImages(
  repo: string,
  path: string,
  limit: number
): Promise<{ ok: boolean; msg?: string; info?: RepoInfo; images?: TreeEntry[] }> {
  const parts = splitRepo(repo);
  if (!parts) return { ok: false, msg: `错误: repo 要写成 owner/repo，收到的是 "${repo}"` };
  const info = await repoInfo(repo);
  if (!info) return { ok: false, msg: `错误: 取不到仓库 ${repo}（不存在、改名了、或 gh 未登录）` };

  const tree = await fetchTree(repo, info.defaultBranch);
  if (!tree.length) return { ok: false, msg: `错误: 取不到 ${repo} 的文件树（仓库可能太大，或 gh 报错）` };

  const prefix = path.replace(/^\/+|\/+$/g, "");
  let images = tree.filter((t) => t.type === "blob" && isImagePath(t.path));
  if (prefix) {
    images = images.filter((t) => t.path.startsWith(prefix + "/"));
  }
  images.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, info, images: images.slice(0, limit) };
}

async function toolListPack(args: any): Promise<string> {
  const repo = String(args.repo ?? "").trim();
  if (!repo) return "错误: 需要 repo（owner/repo）";
  const path = String(args.path ?? "").trim();
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), loadConfig().maxImages);

  const r = await collectImages(repo, path, limit);
  if (!r.ok) return r.msg!;
  const info = r.info!;
  const images = r.images!;

  const head: string[] = [];
  head.push(`# ${repo}${path ? ` / ${path}` : ""}`);
  head.push(`★${stars(info.stars)}  ${info.description || "(无简介)"}`);
  head.push(`分支 ${info.defaultBranch}  默认分支上的图片共 ${images.length} 张（这里最多显示 ${limit} 张）\n`);

  if (!images.length) {
    head.push("这个路径下没找到图片。用 `list_pack` 不带 path 看仓库根，或者换一个目录。");
    return head.join("\n");
  }

  const { owner, repo: name } = splitRepo(info.fullName)!;
  head.push("## 可直接用的链接（jsdelivr，本机实测可直连）\n");
  for (const img of images) {
    const url = toReachableUrl({ owner, repo: name, ref: info.defaultBranch, path: img.path });
    head.push(`- \`${img.path}\`  ${url}`);
  }
  head.push("");
  head.push("提示：`raw.githubusercontent.com` 在本机时通时不通，所以默认给 jsdelivr 改写地址。");
  head.push("想存下这个位置就用 `save_pack`。");
  return head.join("\n");
}

async function toolSavePack(args: any): Promise<string> {
  const repo = String(args.repo ?? "").trim();
  if (!repo) return "错误: 需要 repo（owner/repo）";
  if (!splitRepo(repo)) return `错误: repo 要写成 owner/repo，收到的是 "${repo}"`;
  const path = String(args.path ?? "").trim();
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);

  const r = await collectImages(repo, path, limit);
  if (!r.ok) return r.msg!;

  const info = r.info!;
  const images = r.images!;
  const parts = splitRepo(info.fullName)!;
  const sampleUrls = images.map((img) =>
    toReachableUrl({ owner: parts.owner, repo: parts.repo, ref: info.defaultBranch, path: img.path })
  );

  const action = upsertPack({
    repo: info.fullName,
    path: path.replace(/^\/+|\/+$/g, ""),
    title: String(args.title ?? "").trim() || `${info.fullName}${path ? " / " + path : ""}`,
    note: String(args.note ?? "").trim() || info.description,
    imageCount: images.length,
    sampleUrls,
  });

  const id = packId(info.fullName, path);
  const cfg = loadConfig();
  return [
    `已登记（${action === "created" ? "新增" : "更新"}）: ${id}`,
    `  标题: ${String(args.title ?? "").trim() || "(自动)"}`,
    `  仓库: ${info.fullName}  ★${stars(info.stars)}`,
    `  路径: ${path || "(根目录)"}`,
    `  示例链接: ${sampleUrls.length} 条`,
    `  清单文件: ${cfg.registryPath}`,
  ].join("\n");
}

async function toolListSaved(args: any): Promise<string> {
  const packs = queryPacks(args.keyword ? String(args.keyword) : undefined);
  const cfg = loadConfig();
  if (!packs.length) {
    return `清单里没有记录（${cfg.registryPath}）。用 \`save_pack\` 登记找到的合集。`;
  }
  const out: string[] = [`# 已登记的表情包合集（${packs.length} 条）`, `清单: ${cfg.registryPath}`, ""];
  for (const p of packs) {
    out.push(`- **${p.id}**`);
    out.push(`  ${p.title}`);
    if (p.note && p.note !== p.title) out.push(`  ${p.note}`);
    out.push(`  登记于 ${p.savedAt.slice(0, 10)}`);
    if (p.sampleUrls[0]) out.push(`  示例: ${p.sampleUrls[0]}`);
  }
  return out.join("\n");
}

async function toolRemoveSaved(args: any): Promise<string> {
  const id = String(args.id ?? "").trim();
  if (!id) return "错误: 需要 id（用 list_saved 看到的那个，如 owner/repo#子目录）";
  return removePack(id) ? `已从清单移除: ${id}` : `清单里没有: ${id}`;
}

async function toolFetchPack(args: any): Promise<string> {
  const repo = String(args.repo ?? "").trim();
  if (!repo) return "错误: 需要 repo（owner/repo）";
  const path = String(args.path ?? "").trim();
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), loadConfig().maxImages);
  const cfg = loadConfig();
  const outDir = String(args.out_dir ?? "").trim() || join(cfg.downloadDir, basename(repo));

  const r = await collectImages(repo, path, limit);
  if (!r.ok) return r.msg!;
  const info = r.info!;
  const images = r.images!;
  if (!images.length) return "这个路径下没有图片，什么都没下载。";

  const parts = splitRepo(info.fullName)!;
  mkdirSync(outDir, { recursive: true });

  let okCount = 0;
  const failures: string[] = [];
  for (const img of images) {
    const url = toReachableUrl({ owner: parts.owner, repo: parts.repo, ref: info.defaultBranch, path: img.path });
    const name = img.path.split("/").pop() || "image";
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error("0 字节");
      writeFileSync(join(outDir, name), buf);
      okCount++;
    } catch (e: any) {
      failures.push(`${name}: ${e?.message ?? e}`);
    }
  }

  const out: string[] = [
    `下载完成: 成功 ${okCount} / 共 ${images.length} 张`,
    `落地目录: ${outDir}`,
  ];
  if (failures.length) {
    out.push("");
    out.push(`失败 ${failures.length} 张（如实列出，不掩盖）:`);
    for (const f of failures.slice(0, 20)) out.push(`  - ${f}`);
    if (failures.length > 20) out.push(`  - …另有 ${failures.length - 20} 条`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- MCP 装配

async function main() {
  const server = new Server(
    { name: "meme-finder", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_packs",
        description:
          "按主题词找表情包合集。会搜 GitHub 仓库（同一词配「表情包/memes/sticker/BQB」多个后缀），" +
          "并在几个巨型图集仓库里按目录名匹配。只返回位置，不下图。例如 keyword=\"丁真\"、\"蓝色大肥鱼\"。",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "主题词，如 丁真 / 蓝色大肥鱼 / DeepSeek" },
            limit: { type: "number", description: "可选：最多返回多少个仓库（默认 8，上限 30）" },
            include_mega: { type: "boolean", description: "可选：是否同时扫巨型图集仓库的目录名（默认 true）" },
          },
          required: ["keyword"],
        },
      },
      {
        name: "list_pack",
        description:
          "列出一个仓库（或其中某个子目录）里的图片，返回可直接用的链接。" +
          "链接会从 raw.githubusercontent.com 改写成 cdn.jsdelivr.net——本机实测 raw 时通时不通。",
        inputSchema: {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/repo，如 zhaoolee/ChineseBQB" },
            path: { type: "string", description: "可选：仓库内子目录，不传=整个仓库" },
            limit: { type: "number", description: "可选：最多列多少张（默认 30）" },
          },
          required: ["repo"],
        },
      },
      {
        name: "save_pack",
        description:
          "把找到的表情包合集登记到本地清单（记下路径、标题、备注、示例链接），以后用 list_saved 翻出来。同 id 覆盖。",
        inputSchema: {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/repo" },
            path: { type: "string", description: "可选：子目录" },
            title: { type: "string", description: "可选：给这个合集起个名，默认用仓库名/目录名" },
            note: { type: "string", description: "可选：备注，默认用仓库简介" },
            limit: { type: "number", description: "可选：记几条示例链接（默认 5）" },
          },
          required: ["repo"],
        },
      },
      {
        name: "list_saved",
        description: "列出本地清单里已登记的表情包合集，可传关键词过滤。",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "可选：过滤词（匹配仓库、路径、标题、备注）" },
          },
        },
      },
      {
        name: "remove_saved",
        description: "从本地清单移除一条已登记记录。",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "记录 id，形如 owner/repo 或 owner/repo#子目录" },
          },
          required: ["id"],
        },
      },
      {
        name: "fetch_pack",
        description:
          "把合集里的图片下载到本地目录。会如实报告成功/失败张数，失败的不掩盖。",
        inputSchema: {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/repo" },
            path: { type: "string", description: "可选：子目录" },
            limit: { type: "number", description: "可选：最多下载多少张（默认 20）" },
            out_dir: { type: "string", description: "可选：落地目录，默认 ~/.meme-finder/downloads/<repo名>" },
          },
          required: ["repo"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {
        case "search_packs":
          return { content: [{ type: "text", text: await toolSearchPacks(args) }] };
        case "list_pack":
          return { content: [{ type: "text", text: await toolListPack(args) }] };
        case "save_pack":
          return { content: [{ type: "text", text: await toolSavePack(args) }] };
        case "list_saved":
          return { content: [{ type: "text", text: await toolListSaved(args) }] };
        case "remove_saved":
          return { content: [{ type: "text", text: await toolRemoveSaved(args) }] };
        case "fetch_pack":
          return { content: [{ type: "text", text: await toolFetchPack(args) }] };
        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      return { content: [{ type: "text", text: `错误: ${e?.message ?? e}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
