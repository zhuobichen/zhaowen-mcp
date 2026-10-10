/**
 * write_docs：批量原子写入 + 单次 commit + push。
 *
 * 设计要点：
 *   - 全部校验（路径、撞库、敏感、规范）在**落盘前**完成，保证"要么全成、要么全不成"；
 *   - 一次调用只产生一个 commit —— 避免 index.md 指向尚不存在的卡片的"幻链"；
 *   - 只 `git add` 本批文件，绝不 `-A`，避免卷进仓库里无关的未提交改动；
 *   - 提交前认领会话来源，便于追溯这批卡片是哪次对话沉淀的。
 */
import { promises as fs } from "fs";
import * as path from "path";
import type { MemoryPushConfig } from "./config.js";
import {
  ensureRepo,
  gitAdd,
  gitCommit,
  gitCurrentBranch,
  gitPullRebase,
  gitPush,
  gitRemoteUrl,
  gitRevParseHead,
} from "./git.js";
import { maskContent, scanContent } from "./sensitive.js";
import {
  normalizeRelPath,
  resolveInside,
  validateEvergreenCard,
} from "./vault.js";

export interface WriteFileSpec {
  /** 仓库内相对路径，如 OUTPUT/Evergreen/概念卡片/Morlet小波.md */
  path: string;
  content: string;
  /** create（默认，撞库即失败）/ overwrite / append */
  mode?: "create" | "overwrite" | "append";
}

export interface WriteDocsOptions {
  files: WriteFileSpec[];
  message?: string;
  sensitiveAction?: "abort" | "mask";
  /** 要豁免的敏感规则 id 前缀，如 ["ip-2"] */
  sensitiveIgnore?: string[];
  /** 对 OUTPUT/Evergreen/ 下的文件强制卡片规范校验（默认 true） */
  strictEvergreen?: boolean;
  pullRebase?: boolean;
  dryRun?: boolean;
}

export interface WrittenFile {
  path: string;
  action: "created" | "overwritten" | "appended" | "unchanged";
  bytes: number;
}

export interface WriteDocsResult {
  ok: boolean;
  message: string;
  dryRun?: boolean;
  files: WrittenFile[];
  commitHash?: string;
  pushed?: boolean;
  branch?: string;
  pulled?: boolean;
  warnings: string[];
  sensitiveHits?: Array<{ file: string; ruleId: string; category: string; line: number; sample: string }>;
  validationErrors?: Array<{ path: string; errors: string[]; warnings: string[] }>;
  sessionId?: string;
}

/** 归一化 git remote 地址以便比较（SSH / HTTPS / 带不带 .git 都算同一仓库） */
function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/^git@([^:]+):/i, "https://$1/")
    .replace(/^ssh:\/\/git@([^/]+)\//i, "https://$1/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function currentSessionId(): string {
  return process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_SESSION_ID || "";
}

/**
 * 展开内容里的占位符，让 AI 无需自己知道会话号/日期：
 *   {{TODAY}}      → 本地日期 YYYY-MM-DD
 *   {{SESSION_ID}} → 会话短 id；**拿不到会话 id 时整行删除**（如 Codex CLI 不注入会话 id，
 *                    若替换成空串会在卡片里留下空的 `` 残留，反而逼 AI 再改一轮）
 */
function expandPlaceholders(content: string, sessionId: string, today: string): string {
  const out = content.replace(/\{\{TODAY\}\}/g, today);
  if (sessionId) {
    return out.replace(/\{\{SESSION_ID\}\}/g, sessionId.slice(0, 8));
  }
  return out
    .split("\n")
    .filter((line) => !line.includes("{{SESSION_ID}}"))
    .join("\n");
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function writeDocs(
  config: MemoryPushConfig,
  opts: WriteDocsOptions
): Promise<WriteDocsResult> {
  const warnings: string[] = [];
  const specs = Array.isArray(opts.files) ? opts.files : [];
  if (!specs.length) {
    return { ok: false, message: "files 不能为空", files: [], warnings };
  }

  // 1. 确保仓库存在，并校验 remote 指向预期仓库
  try {
    await ensureRepo(config.repoDir, config.repoUrl, config.gitBin);
  } catch (e: any) {
    return { ok: false, message: `仓库不可用：${e.message}`, files: [], warnings };
  }
  try {
    const actual = await gitRemoteUrl(config.repoDir, config.gitBin);
    if (normalizeRemote(actual) !== normalizeRemote(config.repoUrl)) {
      return {
        ok: false,
        message:
          `工作副本 remote 与配置不一致，拒绝写入以防写错副本：\n` +
          `  实际：${actual}\n  期望：${config.repoUrl}\n` +
          `请确认 MEMORY_REPO_DIR 指向正确的工作副本。`,
        files: [],
        warnings,
      };
    }
  } catch (e: any) {
    warnings.push(`remote 校验跳过（${e.message}）`);
  }

  const sessionId = currentSessionId();
  const today = localToday();
  const strict = opts.strictEvergreen !== false;
  const ignore = opts.sensitiveIgnore;

  // 2. 归一化路径 + 越界校验 + 撞库检查（全部在落盘前）
  interface Prepared {
    rel: string;
    abs: string;
    mode: "create" | "overwrite" | "append";
    finalContent: string;
    existed: boolean;
    unchanged: boolean;
  }
  const prepared: Prepared[] = [];
  const validationErrors: WriteDocsResult["validationErrors"] = [];
  const sensitiveHits: NonNullable<WriteDocsResult["sensitiveHits"]> = [];

  for (const spec of specs) {
    const check = normalizeRelPath(spec.path);
    if (!check.ok) {
      return { ok: false, message: `路径非法（${spec.path}）：${check.error}`, files: [], warnings };
    }
    const abs = resolveInside(config.repoDir, check.rel);
    if (!abs) {
      return { ok: false, message: `路径越界，拒绝写入：${check.rel}`, files: [], warnings };
    }

    const mode = spec.mode ?? "create";
    let existed = false;
    let previous = "";
    try {
      previous = await fs.readFile(abs, "utf8");
      existed = true;
    } catch {
      existed = false;
    }

    // 硬护栏：create 撞库 → 整批中止（防止未读旧卡就覆盖）
    if (mode === "create" && existed) {
      return {
        ok: false,
        message:
          `目标已存在：${check.rel}\n` +
          `create 模式不会覆盖既有文件。若确要更新，请先用 read_doc 读全文、合并改写后改用 mode="overwrite"。`,
        files: [],
        warnings,
      };
    }

    let body = expandPlaceholders(String(spec.content ?? ""), sessionId, today);
    if (mode === "append" && existed) {
      const sep = previous.endsWith("\n") ? "" : "\n";
      body = previous + sep + body;
    }

    // 敏感扫描（内存，写盘前）
    const hits = scanContent(body, check.rel, ignore);
    if (hits.length) {
      if (opts.sensitiveAction === "mask") {
        const masked = maskContent(body, ignore);
        body = masked.content;
        warnings.push(`${check.rel}：mask 模式替换 ${masked.masked} 处敏感内容`);
      } else {
        sensitiveHits.push(...hits);
      }
    }

    // 规范校验
    if (strict && /(^|\/)Evergreen\//.test(check.rel)) {
      const v = validateEvergreenCard(check.rel, body);
      if (!v.ok) validationErrors.push({ path: check.rel, errors: v.errors, warnings: v.warnings });
      else if (v.warnings.length) validationErrors.push({ path: check.rel, errors: [], warnings: v.warnings });
    }

    prepared.push({
      rel: check.rel,
      abs,
      mode,
      finalContent: body,
      existed,
      unchanged: existed && previous === body,
    });
  }

  if (sensitiveHits.length) {
    const preview = sensitiveHits
      .slice(0, 8)
      .map((h) => `  - [${h.category}] ${h.ruleId} @ ${h.file}:${h.line}  ${h.sample}`)
      .join("\n");
    return {
      ok: false,
      message: `敏感检查命中 ${sensitiveHits.length} 处，未写入任何文件：\n${preview}\n提示：确认无泄露后重试，或 sensitive_action="mask"，或用 sensitive_ignore 豁免规则。`,
      files: [],
      warnings,
      sensitiveHits,
    };
  }

  const hardErrors = (validationErrors ?? []).filter((v) => v.errors.length);
  if (hardErrors.length) {
    const preview = hardErrors
      .map((v) => `  - ${v.path}：${v.errors.join("；")}`)
      .join("\n");
    return {
      ok: false,
      message: `Evergreen 卡片规范校验未通过，未写入任何文件：\n${preview}`,
      files: [],
      warnings,
      validationErrors,
    };
  }

  const soft = (validationErrors ?? []).flatMap((v) => v.warnings.map((w) => `${v.path}：${w}`));
  warnings.push(...soft);

  const changed = prepared.filter((p) => !p.unchanged);
  if (!changed.length) {
    return {
      ok: true,
      message: "所有文件内容与现状一致，无需变更。",
      files: prepared.map((p) => ({
        path: p.rel,
        action: "unchanged" as const,
        bytes: Buffer.byteLength(p.finalContent, "utf8"),
      })),
      warnings,
      sessionId: sessionId || undefined,
    };
  }

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      message:
        `[dry-run] 将写入 ${changed.length} 个文件，未落盘、未提交：\n` +
        changed
          .map((p) => `  - ${p.mode === "create" ? "新建" : p.mode === "append" ? "追加" : "覆盖"} ${p.rel}`)
          .join("\n"),
      files: prepared.map((p) => ({
        path: p.rel,
        action: (p.unchanged
          ? "unchanged"
          : p.mode === "create"
            ? "created"
            : p.mode === "append"
              ? "appended"
              : "overwritten") as WrittenFile["action"],
        bytes: Buffer.byteLength(p.finalContent, "utf8"),
      })),
      warnings,
      sessionId: sessionId || undefined,
    };
  }

  // 3. 落盘
  for (const p of changed) {
    try {
      await fs.mkdir(path.dirname(p.abs), { recursive: true });
      await fs.writeFile(p.abs, p.finalContent, "utf8");
    } catch (e: any) {
      return {
        ok: false,
        message: `写入失败（${p.rel}）：${e.message}。可能有部分文件已落盘但未提交。`,
        files: [],
        warnings,
      };
    }
  }

  // 4. pull --rebase（脏树自动 stash），失败降级为警告
  const branch = await gitCurrentBranch(config.repoDir, config.gitBin).catch(() => "main");
  let pulled = false;
  if (opts.pullRebase !== false) {
    try {
      const pull = await gitPullRebase(config.repoDir, config.gitBin, branch);
      pulled = pull.code === 0;
      if (!pulled) warnings.push(`pull --rebase 未成功（已跳过）：${(pull.stderr || pull.stdout).trim()}`);
    } catch (e: any) {
      warnings.push(`pull --rebase 失败（已跳过）：${e.message}`);
    }
  }

  // 5. 只 add 本批文件（相对仓库根的 POSIX 路径）
  const relPaths = changed.map((p) => p.rel);
  const commitMessage =
    opts.message ||
    [
      `docs: 更新 ${relPaths.length} 个文件`,
      "",
      sessionId ? `来源会话: ${sessionId.slice(0, 8)}` : "",
      "（由 memory-push MCP write_docs 写入）",
      "",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ]
      .filter((s) => s !== "")
      .join("\n");

  try {
    const add = await gitAdd(config.repoDir, config.gitBin, relPaths);
    if (add.code !== 0) throw new Error(add.stderr || add.stdout);
    const commit = await gitCommit(config.repoDir, config.gitBin, commitMessage);
    if (commit.code !== 0) {
      const out = (commit.stdout + commit.stderr).trim();
      if (/nothing to commit/i.test(out)) {
        return {
          ok: true,
          message: "内容与已提交版本一致，无新增变更。",
          files: prepared.map((p) => ({
            path: p.rel,
            action: "unchanged" as const,
            bytes: Buffer.byteLength(p.finalContent, "utf8"),
          })),
          warnings,
          sessionId: sessionId || undefined,
        };
      }
      throw new Error(out);
    }
  } catch (e: any) {
    return {
      ok: false,
      message: `git add/commit 失败：${e.message}。文件已落盘但未提交。`,
      files: [],
      warnings,
    };
  }

  const commitHash = await gitRevParseHead(config.repoDir, config.gitBin).catch(() => "");

  // 6. push，失败则 pull --rebase 后重试一次
  let pushed = false;
  try {
    let push = await gitPush(config.repoDir, config.gitBin, branch);
    if (push.code !== 0) {
      warnings.push(`首次 push 失败，尝试 pull --rebase 后重试：${(push.stderr || push.stdout).trim()}`);
      const retryPull = await gitPullRebase(config.repoDir, config.gitBin, branch);
      if (retryPull.code === 0) {
        push = await gitPush(config.repoDir, config.gitBin, branch);
        pulled = true;
      }
    }
    pushed = push.code === 0;
    if (!pushed) {
      return {
        ok: false,
        message:
          `已本地提交 ${commitHash.slice(0, 7)} 但 push 失败。\n` +
          `可手动执行：git -C "${config.repoDir}" push origin ${branch}`,
        files: prepared.map((p) => ({
          path: p.rel,
          action: (p.mode === "create" ? "created" : p.mode === "append" ? "appended" : "overwritten") as WrittenFile["action"],
          bytes: Buffer.byteLength(p.finalContent, "utf8"),
        })),
        commitHash,
        pushed: false,
        branch,
        pulled,
        warnings,
        sessionId: sessionId || undefined,
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      message: `push 异常：${e.message}`,
      files: [],
      commitHash,
      pushed: false,
      branch,
      warnings,
    };
  }

  return {
    ok: true,
    message:
      `✅ 已写入 ${changed.length} 个文件并推送（commit ${commitHash.slice(0, 7)}，分支 ${branch}）\n` +
      changed
        .map((p) => `  - ${p.mode === "create" ? "新建" : p.mode === "append" ? "追加" : "覆盖"} ${p.rel}`)
        .join("\n"),
    files: prepared.map((p) => ({
      path: p.rel,
      action: (p.unchanged
        ? "unchanged"
        : p.mode === "create"
          ? "created"
          : p.mode === "append"
            ? "appended"
            : "overwritten") as WrittenFile["action"],
      bytes: Buffer.byteLength(p.finalContent, "utf8"),
    })),
    commitHash,
    pushed: true,
    branch,
    pulled,
    warnings,
    sessionId: sessionId || undefined,
  };
}
