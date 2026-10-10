#!/usr/bin/env npx tsx
/**
 * kb-cli —— 知识库读写的命令行入口。
 *
 * 与 MCP（index.ts）共用同一套 lib/ 逻辑，供**不支持 MCP 工具的环境**通过 shell 调用。
 * 背景：Codex CLI 的 exec 模式存在已知 bug —— MCP 服务器能正常启动、能握手，
 * 但 tools/list 的结果不注入模型工具集（openai/codex #17904、#38689）。
 * 而 shell 是 Codex 的内置能力，因此提供这条通道作为兜底。
 *
 * 用法:
 *   kb-cli search <关键词> [--path OUTPUT] [--limit 20] [--mode name|content|both]
 *   kb-cli read <仓库内相对路径>
 *   kb-cli write [--message "提交说明"] [--dry-run] < files.json
 *
 * 运行:
 *   node E:/CodeProject/node_modules/tsx/dist/cli.mjs E:/CodeProject/mcp-server/memory-push/kb-cli.ts <子命令>
 */
import { loadConfig } from "./lib/config.js";
import { readDoc, searchDocs } from "./lib/search.js";
import { writeDocs } from "./lib/write.js";
import type { WriteFileSpec } from "./lib/write.js";

function parseArgs(argv: string[]): { pos: string[]; flags: Record<string, string | boolean> } {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let d = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => resolve(d));
  });
}

const USAGE = `kb-cli —— 知识库读写命令行入口

用法:
  kb-cli search <关键词> [--path OUTPUT] [--limit 20] [--mode name|content|both]
  kb-cli read <仓库内相对路径>
  kb-cli write [--message "提交说明"] [--dry-run] < files.json

write 从 stdin 读 JSON:
  { "files": [ { "path": "...", "content": "...", "mode": "create|overwrite|append" } ], "message": "..." }

mode 缺省为 create（目标已存在则整批失败，防止未读旧卡就覆盖）。
内容里的 {{TODAY}} / {{SESSION_ID}} 占位符会被自动展开。`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const config = loadConfig();
  const { pos, flags } = parseArgs(rest);

  switch (cmd) {
    case "search": {
      const query = pos.join(" ").trim();
      if (!query) {
        console.error("用法: kb-cli search <关键词> [--path OUTPUT] [--limit 20]");
        process.exitCode = 2;
        return;
      }
      const r = await searchDocs(config, {
        query,
        scope: typeof flags.path === "string" ? flags.path : undefined,
        mode: flags.mode === "name" || flags.mode === "content" ? flags.mode : "both",
        limit: typeof flags.limit === "string" ? Number(flags.limit) : undefined,
      });
      console.log(`范围: ${r.scope}  关键词: ${r.query}  已扫描 ${r.filesScanned} 个文件`);
      if (r.candidates.length) {
        console.log("\n[!] 可能同一概念的既有卡片（判重依据，须先 read 读全文再决定是否合并）：");
        for (const c of r.candidates) {
          const tp = c.topics.length ? `  topics: ${c.topics.join(" / ")}` : "";
          console.log(`  - [${c.score}] ${c.path}  「${c.title}」  ${c.reason}${tp}`);
        }
      } else {
        console.log("\n[OK] 未发现同一概念的既有卡片 -> 可新建。");
      }
      if (r.hits.length) {
        console.log(`\n关键词命中 ${r.hits.length} 处${r.truncated ? "（已截断）" : ""}:`);
        for (const h of r.hits) console.log(`  - ${h.path}:${h.line} [${h.kind}] ${h.snippet}`);
      }
      return;
    }

    case "read": {
      const p = pos.join(" ").trim();
      if (!p) {
        console.error("用法: kb-cli read <仓库内相对路径>");
        process.exitCode = 2;
        return;
      }
      const r = await readDoc(config, p);
      if (!r.ok || r.content === undefined) {
        console.error(`错误: ${r.message}`);
        process.exitCode = 1;
        return;
      }
      console.log(r.message);
      if (r.frontmatter) console.log("\nfrontmatter:\n" + JSON.stringify(r.frontmatter, null, 2));
      if (r.validation?.errors.length) console.log("\n[X] 规范问题: " + r.validation.errors.join("；"));
      if (r.validation?.warnings.length) console.log("[!] 提示: " + r.validation.warnings.join("；"));
      console.log("\n---- 全文 ----\n" + r.content);
      return;
    }

    case "write": {
      const raw = await readStdin();
      if (!raw.trim()) {
        console.error("stdin 为空。用法: kb-cli write [--message \"...\"] < files.json");
        process.exitCode = 2;
        return;
      }
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch (e: any) {
        console.error("stdin 不是合法 JSON: " + e.message);
        process.exitCode = 2;
        return;
      }
      const files: WriteFileSpec[] = Array.isArray(payload?.files) ? payload.files : [];
      if (!files.length) {
        console.error("JSON 里缺少 files 数组");
        process.exitCode = 2;
        return;
      }
      const r = await writeDocs(config, {
        files,
        message: typeof flags.message === "string" ? flags.message : payload.message,
        dryRun: flags["dry-run"] === true,
        strictEvergreen: flags["no-strict"] !== true,
        sensitiveAction: flags.mask === true ? "mask" : "abort",
      });
      console.log(r.message);
      if (r.commitHash) console.log("commit: " + r.commitHash.slice(0, 7) + (r.pushed ? "（已 push）" : "（未 push）"));
      if (r.warnings.length) console.log("警告:\n" + r.warnings.join("\n"));
      console.log("---JSON---");
      console.log(JSON.stringify(r));
      process.exitCode = r.ok ? 0 : 1;
      return;
    }

    default:
      console.log(USAGE);
      process.exitCode = cmd ? 2 : 0;
      return;
  }
}

main().catch((e) => {
  console.error("错误: " + e.message);
  process.exitCode = 1;
});
