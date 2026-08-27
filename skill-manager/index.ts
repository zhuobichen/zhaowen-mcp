#!/usr/bin/env npx tsx
/**
 * Skill Manager MCP Server
 *
 * 盘点本地 skill + 一键发布到 GitHub（zhaowen-skill 仓库）。
 * - list_skills: 盘点本地所有 skill 及位置/状态
 * - check_sensitive: 检测敏感信息（密码/内网IP/API key/token 等）
 * - publish_skill: 显式触发时把指定 skill 规范化命名后推送到 GitHub（唯一 push 入口）
 * - get_config: 查看当前配置
 *
 * 启动: npx tsx E:/CodeProject/mcp-server/skill-manager/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "path";
import { loadConfig } from "./lib/config.js";
import { scanAll } from "./lib/skills.js";
import { scanPath } from "./lib/sensitive.js";
import { publishSkill } from "./lib/publish.js";

async function main() {
  const server = new Server(
    { name: "skill-manager", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_skills",
        description:
          "盘点本地所有 skill：扫描配置的 skills 根目录，返回每个 skill 的绝对路径、目录名、是否有 SKILL.md、是否已在 GitHub 仓库中、是否已注册 INDEX.md。可选按根目录过滤。",
        inputSchema: {
          type: "object",
          properties: {
            root: {
              type: "string",
              description: "可选：只列出该根目录下的 skill（绝对路径）",
            },
          },
        },
      },
      {
        name: "check_sensitive",
        description:
          "对指定文件或目录做敏感信息检测（密码/账号/API key/token/内网 IP/域名/凭据文件名等）。返回命中项：类别、规则、文件、行号、内容样例。",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "要检测的文件或目录绝对路径",
            },
            pattern: {
              type: "string",
              description: "可选：追加一条自定义检测正则（PCRE 语法）",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "publish_skill",
        description:
          "把指定的本地 skill 规范化命名后发布到 GitHub 仓库 zhaowen-skill：复制到仓库工作副本 → 敏感检查/脱敏 → 更新 README 表格 → git add + commit + push。只有显式调用本工具才会执行 push。",
        inputSchema: {
          type: "object",
          properties: {
            skill_dir: {
              type: "string",
              description: "本地 skill 目录绝对路径（须含 SKILL.md）",
            },
            new_name: {
              type: "string",
              description:
                "可选：规范化后的目录名（如 ylx_pm25_analysis）。缺省自动生成 ylx_<清洗后目录名>",
            },
            check_sensitive: {
              type: "boolean",
              description: "可选，默认 true：是否做敏感检查",
            },
            sensitive_action: {
              type: "string",
              enum: ["abort", "mask"],
              description:
                "可选，默认 abort：abort=命中敏感项即中止并返回清单；mask=上传版本将命中值替换为 <占位符>，本地文件不动",
            },
          },
          required: ["skill_dir"],
        },
      },
      {
        name: "get_config",
        description:
          "查看 skill-manager 当前配置（skills 根目录列表、仓库路径/地址、INDEX.md 路径、命名前缀）。",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const config = loadConfig();

    try {
      switch (name) {
        case "list_skills": {
          const rootFilter = args.root ? String(args.root) : undefined;
          const all = await scanAll(config);
          const infos = rootFilter
            ? all.filter((i) => path.resolve(i.root) === path.resolve(rootFilter))
            : all;
          if (infos.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: rootFilter
                    ? `该根目录下未发现 skill: ${rootFilter}`
                    : "未发现任何 skill",
                },
              ],
            };
          }
          const lines: string[] = [];
          const byRoot = new Map<string, typeof infos>();
          for (const info of infos) {
            const arr = byRoot.get(info.root) || [];
            arr.push(info);
            byRoot.set(info.root, arr);
          }
          let total = 0;
          for (const [root, list] of byRoot) {
            lines.push(`【${root}】（${list.length} 个）`);
            for (const info of list) {
              total++;
              const flags = [
                info.hasSkillMd ? "✓SKILL" : "✗无SKILL",
                info.inRepo ? "✓已入仓库" : "✗未入仓库",
                info.inIndex ? "✓已注册INDEX" : "✗未注册INDEX",
                info.isSymlink ? "🔗符号链接" : "",
              ]
                .filter(Boolean)
                .join(" ");
              lines.push(
                `  ${info.name} — ${flags}\n    路径: ${info.dir}${
                  info.frontmatterName && info.frontmatterName !== info.name
                    ? `（frontmatter name: ${info.frontmatterName}）`
                    : ""
                }`
              );
            }
          }
          lines.push(
            `\n共 ${total} 个 skill。`,
            `配置: roots=${config.roots.length} 个根目录 | repo=${config.repoDir} | INDEX=${config.indexPath} | namespace=${config.namespace}`
          );
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "check_sensitive": {
          const target = String(args.path);
          let scan;
          try {
            scan = await scanPath(target, args.pattern ? String(args.pattern) : undefined);
          } catch (e: any) {
            return { content: [{ type: "text", text: `错误: ${e.message}` }] };
          }
          if (scan.hits.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `✅ 未发现敏感信息。检查文件 ${scan.filesChecked} 个，跳过二进制 ${scan.binarySkipped} 个。`,
                },
              ],
            };
          }
          const lines = [
            `⚠️ 检测到 ${scan.hits.length} 处敏感信息（检查文件 ${scan.filesChecked} 个，跳过二进制 ${scan.binarySkipped} 个）：`,
          ];
          for (const h of scan.hits.slice(0, 50)) {
            lines.push(`- [${h.category}] ${h.label}（${h.ruleId}） @ ${h.file}:${h.line}`);
            lines.push(`  ${h.sample}`);
          }
          if (scan.hits.length > 50) lines.push(`  ... 其余 ${scan.hits.length - 50} 处`);
          lines.push("提示: 发布 skill 时默认 abort；传 sensitive_action='mask' 可自动脱敏上传版。");
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "publish_skill": {
          const skillDir = String(args.skill_dir || "");
          if (!skillDir) {
            return { content: [{ type: "text", text: "错误: 缺少 skill_dir（本地 skill 目录绝对路径）" }] };
          }
          const result = await publishSkill(config, {
            skill_dir: skillDir,
            new_name: args.new_name ? String(args.new_name) : undefined,
            check_sensitive: args.check_sensitive !== undefined ? Boolean(args.check_sensitive) : undefined,
            sensitive_action: args.sensitive_action === "mask" ? "mask" : undefined,
          });
          const lines = [result.message];
          if (result.sensitive) {
            lines.push(
              `敏感检查: ${result.sensitive.checked ? "已执行" : "跳过"}，命中 ${result.sensitive.hits} 项，动作 ${result.sensitive.action}`
            );
          }
          if (result.commitMessage) lines.push(`commit 信息:\n${result.commitMessage}`);
          if (result.warnings?.length) lines.push(`⚠️ 警告:\n${result.warnings.join("\n")}`);
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "get_config": {
          return {
            content: [
              {
                type: "text",
                text: [
                  `skill-manager 配置:`,
                  `- 命名前缀: ${config.namespace}`,
                  `- 仓库: ${config.repoUrl}`,
                  `- 仓库工作副本: ${config.repoDir}`,
                  `- INDEX.md: ${config.indexPath}`,
                  `- 扫描根目录 (${config.roots.length}):`,
                  ...config.roots.map((r) => `  - ${r}`),
                ].join("\n"),
              },
            ],
          };
        }

        default:
          return { content: [{ type: "text", text: `未知工具: ${name}` }] };
      }
    } catch (e: any) {
      return { content: [{ type: "text", text: `错误: ${e.message}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
