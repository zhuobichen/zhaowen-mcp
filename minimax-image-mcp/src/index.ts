#!/usr/bin/env node
/**
 * MiniMax 生图 MCP server（image-01）。
 *
 * 三个工具：
 *   generate_image      文生图 → 落盘，返回绝对路径
 *   generate_image_url  文生图 → 只回 URL，不落盘
 *   image_config        看当前用的 key 来自哪、baseUrl、默认比例（排障用）
 *
 * 与豆包那条路的区别：纯 HTTP，无 GUI、无窗口、可并发、能指定比例、
 * 产物不带「豆包 AI 生成」水印。
 *
 * 通过 stdio 与 MCP 客户端通信；日志一律走 stderr，stdout 只留给协议。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { config } from './config.js'
import { requestImage, saveImages, stampName } from './client.js'

const server = new McpServer({ name: 'minimax-image', version: '0.1.0' })

const ASPECTS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'] as const

function log(msg: string): void {
  process.stderr.write(`[minimax-image] ${msg}\n`)
}

server.registerTool(
  'generate_image',
  {
    title: 'MiniMax 文生图（落盘）',
    description:
      '用 MiniMax image-01 生成图片并保存到本地，返回绝对路径。纯 HTTP、可并发，产物无水印。' +
      '单次 1–4 张，约 10–30 秒。提示词里要写清楚画面主体、风格、配色；' +
      '需要文字时别指望模型写对汉字，标题类文字建议后期叠。',
    inputSchema: {
      prompt: z.string().min(1).describe('画面描述。越具体越好：主体、构图、色彩、风格、留白'),
      aspect_ratio: z.enum(ASPECTS).default('1:1').describe('画面比例，默认 1:1'),
      n: z.number().int().min(1).max(4).default(1).describe('生成张数，1–4'),
      model: z.string().optional().describe('模型名，默认 image-01'),
      prompt_optimizer: z
        .boolean()
        .default(true)
        .describe('是否让 MiniMax 自动改写提示词。做标志/字标类要精确控制的图建议关掉'),
      out_dir: z.string().optional().describe('输出目录（绝对路径），默认用配置里的 outDir'),
      name: z.string().optional().describe('文件名主干；省略则用时间戳'),
    },
  },
  async (args) => {
    try {
      const { json, base } = await requestImage(
        {
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          n: args.n,
          model: args.model,
          promptOptimizer: args.prompt_optimizer,
        },
        'base64',
      )
      const b64 = json?.data?.image_base64 ?? []
      if (!b64.length) {
        const urls = json?.data?.image_urls ?? []
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `接口没回 base64。${urls.length ? `只有 URL：\n${urls.join('\n')}` : '返回内容：' + JSON.stringify(json).slice(0, 400)}`,
            },
          ],
        }
      }
      const saved = saveImages(b64, args.out_dir || config.outDir, args.name || stampName())
      log(`生成 ${saved.length} 张 → ${saved[0]?.path}`)
      const lines = saved.map(
        (s, i) => `${i + 1}. ${s.path}（${((s.bytes ?? 0) / 1024).toFixed(0)} KB）`,
      )
      return {
        content: [
          {
            type: 'text',
            text: [`已生成 ${saved.length} 张（${base}，${args.aspect_ratio}）：`, ...lines].join('\n'),
          },
        ],
      }
    } catch (e) {
      log('generate_image 失败：' + (e as Error).message)
      return { isError: true, content: [{ type: 'text', text: (e as Error).message }] }
    }
  },
)

server.registerTool(
  'generate_image_url',
  {
    title: 'MiniMax 文生图（只回 URL）',
    description:
      '同上，但只返回图片 URL、不写本地文件。适合把图直接交给别的服务，或不想占磁盘时用。',
    inputSchema: {
      prompt: z.string().min(1).describe('画面描述'),
      aspect_ratio: z.enum(ASPECTS).default('1:1').describe('画面比例'),
      n: z.number().int().min(1).max(4).default(1).describe('生成张数'),
      model: z.string().optional().describe('模型名，默认 image-01'),
      prompt_optimizer: z.boolean().default(true).describe('是否自动改写提示词'),
    },
  },
  async (args) => {
    try {
      const { json, base } = await requestImage(
        {
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          n: args.n,
          model: args.model,
          promptOptimizer: args.prompt_optimizer,
        },
        'url',
      )
      const urls = json?.data?.image_urls ?? []
      if (!urls.length) {
        return {
          isError: true,
          content: [{ type: 'text', text: '接口没有返回 URL：' + JSON.stringify(json).slice(0, 400) }],
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: [`${urls.length} 张（${base}）：`, ...urls.map((u, i) => `${i + 1}. ${u}`)].join('\n'),
          },
        ],
      }
    } catch (e) {
      log('generate_image_url 失败：' + (e as Error).message)
      return { isError: true, content: [{ type: 'text', text: (e as Error).message }] }
    }
  },
)

server.registerTool(
  'image_config',
  {
    title: '看当前生图配置',
    description: '只读：显示配置文件路径、key 是否就位（不打印 key）、baseUrl、默认模型与输出目录。排障时先看这个。',
    inputSchema: {},
  },
  async () => {
    const masked = config.apiKey
      ? `${config.apiKey.slice(0, 6)}…（${config.apiKey.length} 字符）`
      : '（未配置）'
    return {
      content: [
        {
          type: 'text',
          text: [
            `配置文件：${config.configPath}`,
            `API Key ：${masked}`,
            `baseUrl ：${config.bases.join('  |  ')}`,
            `模型    ：${config.model}`,
            `默认比例：${config.defaultAspect}`,
            `输出目录：${config.outDir}`,
          ].join('\n'),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
log(`ready (model=${config.model}, base=${config.bases[0]})`)
