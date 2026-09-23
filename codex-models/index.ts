#!/usr/bin/env npx tsx
/**
 * Codex Models MCP Server
 *
 * 管理 Codex 的模型配置（~/.codex/models.json 与 config.toml）：
 * - list_models:      列出已配置的模型 + 当前选中
 * - list_available:   拉 one-hub 可用模型，标注哪些尚未配置
 * - add_model:        新增模型（从 one-hub 列表选 or 手动指定模板，自动生成字段 + 备份）
 * - remove_model:     删除模型
 * - set_model:        切换当前使用的模型
 *
 * 启动: npx tsx E:/CodeProject/mcp-server/codex-models/index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./lib/config.js";
import { readCatalog, addModel, removeModel, autoTemplate } from "./lib/models.js";
import { readConfigSummary, setModel } from "./lib/toml.js";
import { fetchAvailableModels } from "./lib/onehub.js";

async function main() {
  const server = new Server(
    { name: "codex-models", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_models",
        description:
          "列出 Codex 已配置的模型（~/.codex/models.json），并标出当前选中的模型（config.toml 的 model）。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "list_available",
        description:
          "拉取 one-hub 的可用模型列表（/v1/models），并标注哪些是 Codex 尚未配置的（可直接 add_model 加入）。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "add_model",
        description:
          "向 Codex 的 models.json 插入一个新模型。字段默认从「模板模型」深拷贝（自动按 slug 关键词匹配最相似的现有模型，也可用 template 显式指定），再覆盖 slug/display_name/context_window 等。写入前自动备份 models.json。",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "模型标识（须与 one-hub 的模型 id 一致，如 gpt-5.6-sol）" },
            template: { type: "string", description: "可选：用作字段模板的现有模型 slug（缺省自动匹配）" },
            display_name: { type: "string", description: "可选：显示名（缺省用 slug）" },
            context_window: { type: "integer", description: "可选：上下文窗口 token 数（同时覆盖 max_context_window）" },
            description: { type: "string", description: "可选：模型描述" },
            overrides: {
              type: "object",
              description: "可选：其它要覆盖的顶层字段（如 base_instructions、reasoning 级别等）",
            },
            dry_run: { type: "boolean", description: "可选：true 时只预览将要写入的条目，不落盘" },
          },
          required: ["slug"],
        },
      },
      {
        name: "remove_model",
        description: "从 Codex 的 models.json 删除一个模型（写入前自动备份）。",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", description: "要删除的模型 slug" } },
          required: ["slug"],
        },
      },
      {
        name: "set_model",
        description:
          "切换 Codex 当前使用的模型（修改 ~/.codex/config.toml 的顶层 model）。写入前备份 config.toml。可选 check_catalog 校验该模型是否已在 models.json 中。",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "目标模型 slug" },
            check_catalog: { type: "boolean", description: "可选：true 时若模型不在 models.json 中则拒绝（默认 true）" },
          },
          required: ["slug"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const cfg = loadConfig();

    try {
      switch (name) {
        case "list_models": {
          const cat = readCatalog(cfg.modelsFile);
          const conf = readConfigSummary(cfg.configFile);
          const lines = [
            `Codex 模型目录：${cfg.modelsFile}`,
            `当前选中：${conf.model || "(未设置)"}  provider=${conf.modelProvider || "-"}`,
            "",
            `已配置 ${cat.models.length} 个模型：`,
          ];
          for (const m of cat.models) {
            const cur = m.slug === conf.model ? " ← 当前" : "";
            const ctx = m.context_window ? `  ctx=${m.context_window}` : "";
            lines.push(`  ${m.slug.padEnd(30)}${(m.display_name || "").padEnd(24)}${ctx}${cur}`);
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "list_available": {
          const cat = readCatalog(cfg.modelsFile);
          const configured = new Set(cat.models.map((m) => m.slug));
          const res = await fetchAvailableModels(cfg.apiUrl, cfg.apiKey);
          if (!res.ok) {
            return { content: [{ type: "text", text: `拉取可用模型失败：${res.error}` }] };
          }
          const notConfigured = res.ids.filter((id) => !configured.has(id));
          const lines = [
            `one-hub 可用模型 ${res.ids.length} 个（已配置 ${res.ids.length - notConfigured.length}，未配置 ${notConfigured.length}）`,
            "",
            "【未配置 —— 可 add_model 加入】",
            ...(notConfigured.length ? notConfigured.map((id) => `  ${id}`) : ["  (无)"]),
            "",
            "【已配置】",
            ...res.ids
              .filter((id) => configured.has(id))
              .map((id) => `  ${id}`),
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "add_model": {
          const slug = String(args.slug || "").trim();
          if (!slug) return { content: [{ type: "text", text: "错误: 请提供 slug" }] };
          const cat0 = readCatalog(cfg.modelsFile);

          if (args.dry_run === true || args.dry_run === "true") {
            const tpl = args.template
              ? cat0.models.find((m) => m.slug === String(args.template))
              : autoTemplate(cat0, slug);
            if (!tpl) return { content: [{ type: "text", text: "错误: 找不到可用模板" }] };
            const preview: any = JSON.parse(JSON.stringify(tpl));
            preview.slug = slug;
            preview.display_name = args.display_name ? String(args.display_name) : slug;
            if (typeof args.context_window === "number") {
              preview.context_window = args.context_window;
              if ("max_context_window" in preview) preview.max_context_window = args.context_window;
            }
            const already = cat0.models.some((m) => m.slug === slug);
            return {
              content: [
                {
                  type: "text",
                  text: `[dry-run] 将基于模板「${tpl.slug}」${already ? "**覆盖**" : "新增"}模型 ${slug}\n写入条目预览（前 600 字符）：\n${JSON.stringify(preview, null, 2).slice(0, 600)}`,
                },
              ],
            };
          }

          const res = addModel(cfg.modelsFile, {
            slug,
            template: args.template ? String(args.template) : undefined,
            displayName: args.display_name ? String(args.display_name) : undefined,
            contextWindow: typeof args.context_window === "number" ? args.context_window : undefined,
            description: args.description ? String(args.description) : undefined,
            overrides: args.overrides && typeof args.overrides === "object" ? args.overrides : undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: [
                  `${res.replaced ? "已覆盖" : "✅ 已新增"}模型：${res.added.slug}`,
                  `模板来源：${res.templateSlug}`,
                  `显示名：${res.added.display_name}`,
                  `context_window：${res.added.context_window ?? "(继承模板)"}`,
                  `备份：${res.backupPath}`,
                  "",
                  `提示：要用它请执行 set_model slug=${res.added.slug}`,
                ].join("\n"),
              },
            ],
          };
        }

        case "remove_model": {
          const slug = String(args.slug || "").trim();
          if (!slug) return { content: [{ type: "text", text: "错误: 请提供 slug" }] };
          const conf = readConfigSummary(cfg.configFile);
          if (conf.model === slug) {
            return {
              content: [
                { type: "text", text: `拒绝删除：${slug} 是当前正在使用的模型。请先用 set_model 切换到别的模型。` },
              ],
            };
          }
          const res = removeModel(cfg.modelsFile, slug);
          return {
            content: [
              {
                type: "text",
                text: `✅ 已删除模型：${res.removed.slug}\n备份：${res.backupPath}`,
              },
            ],
          };
        }

        case "set_model": {
          const slug = String(args.slug || "").trim();
          if (!slug) return { content: [{ type: "text", text: "错误: 请提供 slug" }] };
          const checkCatalog = args.check_catalog !== false && args.check_catalog !== "false";
          if (checkCatalog) {
            const cat = readCatalog(cfg.modelsFile);
            if (!cat.models.some((m) => m.slug === slug)) {
              return {
                content: [
                  {
                    type: "text",
                    text: `拒绝：模型 ${slug} 不在 models.json 中。先用 add_model 添加，或传 check_catalog=false 强制设置。`,
                  },
                ],
              };
            }
          }
          const res = setModel(cfg.configFile, slug);
          return {
            content: [
              {
                type: "text",
                text: `✅ 当前模型：${res.previous || "(未设置)"} → ${res.current}\n备份：${res.backupPath}\n（重启 Codex 会话后生效）`,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
