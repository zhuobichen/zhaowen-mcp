#!/usr/bin/env node
/**
 * MiniMax 生图 MCP server。
 *
 * 三个工具：
 *   generate_image      文生图 / 图生图 → 落盘，返回绝对路径
 *   generate_image_url  同上 → 只回 URL，不落盘
 *   image_config        看当前用的 key 来自哪、baseUrl、默认比例（排障用）
 *
 * **图生图怎么传**：
 *   - 给 `images`（1~16 张；本地路径 / http(s) URL / data: URL 都行）
 *   - 默认走新模型 MiniMax-H3-Image 的 /images/edits，多张可用
 *   - 只有显式 `model: 'image-01'` 才走老模型；它也支持参考图，但 `subject_reference`
 *     只收**一张**（多张报 image_reference must be one）
 *
 * 三个坑（踩过，写在这里省得再踩）：
 *   1. 给老模型塞 `image: [...]` 这种不存在的字段，接口**吞掉照常 200**，
 *      参考图一张没进 —— 参数错了不报错，只静静失效。
 *   2. 老模型只能一张参考图，要传多张必须换新模型。
 *   3. HTTP 200 也可能是业务失败，必须看 base_resp.status_code；
 *      返回的 base64 实测是 JPEG，落盘按 magic 判扩展名。
 *
 * 与豆包那条路的区别：纯 HTTP，无 GUI、无窗口、可并发、能指定比例，
 * 产物不带「豆包 AI 生成」水印。
 *
 * 通过 stdio 与 MCP 客户端通信；日志一律走 stderr，stdout 只留给协议。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { config } from './config.js'
import {
  NEW_MODEL,
  OLD_MODEL,
  downloadImages,
  errText,
  extractBase64,
  extractUrls,
  requestImage,
  saveImages,
  stampName,
} from './client.js'

const server = new McpServer({ name: 'minimax-image', version: '0.2.0' })

const ASPECTS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'] as const

function log(msg: string): void {
  process.stderr.write(`[minimax-image] ${msg}\n`)
}

/** 参考图入参：单个 image 与数组 images 都接受，合并去重。 */
function collectRefs(args: { image?: string; images?: string[] }): string[] {
  const refs: string[] = []
  if (args.image) refs.push(args.image)
  for (const p of args.images ?? []) if (p) refs.push(p)
  return [...new Set(refs)]
}

/**
 * 把接口返回变成落盘文件：
 *   老接口可能给 base64，新接口可能只给 URL —— 两条都收，统一存成本地文件。
 */
async function materialize(
  json: Record<string, unknown>,
  outDir: string,
  stem: string,
): Promise<{ saved: { path?: string; bytes?: number }[]; via: string }> {
  const b64 = extractBase64(json as never)
  if (b64.length) return { saved: saveImages(b64, outDir, stem), via: 'base64' }
  const urls = extractUrls(json as never)
  if (urls.length) return { saved: await downloadImages(urls, outDir, stem), via: 'url 下载' }
  throw new Error('接口返回里既没有 base64 也没有 URL：' + JSON.stringify(json).slice(0, 400))
}

const IMAGE_ARGS = {
  image: z
    .string()
    .optional()
    .describe('单张参考图路径 / URL / dataURL。等价于 images 只传一项'),
  images: z
    .array(z.string())
    .optional()
    .describe(
      '参考图（图生图）。本地绝对路径、http(s) URL、data: URL 都行。' +
        `1~16 张走新模型 ${NEW_MODEL}；只有显式 model=${OLD_MODEL} 时才限 1 张`,
    ),
} as const

server.registerTool(
  'generate_image',
  {
    title: 'MiniMax 生图（落盘，支持图生图）',
    description:
      '用 MiniMax 生成图片并保存到本地，返回绝对路径。纯 HTTP、可并发，产物无水印。' +
      '不给参考图就是文生图（image-01，可指定比例）；' +
      '给 `images` 就是图生图——1~16 张走 MiniMax-H3-Image 的图片编辑，多张可以同时参考。' +
      '单次 1–4 张，约 10–60 秒。需要文字时别指望模型写对汉字，标题类建议后期叠。',
    inputSchema: {
      prompt: z.string().min(1).describe('画面描述。越具体越好：主体、构图、色彩、风格、留白'),
      ...IMAGE_ARGS,
      aspect_ratio: z.enum(ASPECTS).default('1:1').describe('画面比例（仅文生图与老模型可用）'),
      width: z.number().int().positive().optional().describe('像素宽（新模型图生图用，优先于比例）'),
      height: z.number().int().positive().optional().describe('像素高（新模型图生图用）'),
      n: z.number().int().min(1).max(4).default(1).describe('生成张数，1–4'),
      model: z.string().optional().describe(`模型名；省略时：无参考图用 ${OLD_MODEL}，有参考图用 ${NEW_MODEL}`),
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
      const refs = collectRefs(args)
      const { json, base, note } = await requestImage(
        {
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          n: args.n,
          model: args.model,
          promptOptimizer: args.prompt_optimizer,
          images: refs,
          width: args.width,
          height: args.height,
        },
        'base64',
      )
      const { saved, via } = await materialize(
        json as never,
        args.out_dir || config.outDir,
        args.name || stampName(),
      )
      log(`${note} → ${saved.length} 张（${via}）`)
      const lines = saved.map(
        (s, i) => `${i + 1}. ${s.path}（${((s.bytes ?? 0) / 1024).toFixed(0)} KB）`,
      )
      return {
        content: [
          {
            type: 'text',
            text: [
              `已生成 ${saved.length} 张（${base}｜${note}｜落盘方式 ${via}）` +
                (refs.length ? `｜参考图 ${refs.length} 张` : ''),
              ...lines,
            ].join('\n'),
          },
        ],
      }
    } catch (e) {
      log('generate_image 失败：' + errText(e))
      return { isError: true, content: [{ type: 'text', text: errText(e) }] }
    }
  },
)

server.registerTool(
  'generate_image_url',
  {
    title: 'MiniMax 生图（只回 URL，支持图生图）',
    description:
      '同上，但只返回图片 URL、不写本地文件。适合把图直接交给别的服务，或不想占磁盘时用。' +
      `参考图规则一致：1~16 张走 ${NEW_MODEL}，显式 ${OLD_MODEL} 时只能 1 张。`,
    inputSchema: {
      prompt: z.string().min(1).describe('画面描述'),
      ...IMAGE_ARGS,
      aspect_ratio: z.enum(ASPECTS).default('1:1').describe('画面比例'),
      width: z.number().int().positive().optional().describe('像素宽（新模型用）'),
      height: z.number().int().positive().optional().describe('像素高（新模型用）'),
      n: z.number().int().min(1).max(4).default(1).describe('生成张数'),
      model: z.string().optional().describe('模型名'),
      prompt_optimizer: z.boolean().default(true).describe('是否自动改写提示词'),
    },
  },
  async (args) => {
    try {
      const refs = collectRefs(args)
      const { json, base, note } = await requestImage(
        {
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          n: args.n,
          model: args.model,
          promptOptimizer: args.prompt_optimizer,
          images: refs,
          width: args.width,
          height: args.height,
        },
        'url',
      )
      // 即便要 URL，接口也可能只回 base64：那种情况落盘再回路径，别撒谎说给了 URL
      const urls = extractUrls(json as never)
      if (urls.length) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `${urls.length} 张（${base}｜${note}）` +
                  (refs.length ? `｜参考图 ${refs.length} 张` : ''),
                ...urls.map((u, i) => `${i + 1}. ${u}`),
              ].join('\n'),
            },
          ],
        }
      }
      const { saved } = await materialize(json as never, config.outDir, stampName())
      return {
        content: [
          {
            type: 'text',
            text:
              `接口这次只给了 base64，没有 URL，已落盘：\n` +
              saved.map((s, i) => `${i + 1}. ${s.path}`).join('\n'),
          },
        ],
      }
    } catch (e) {
      log('generate_image_url 失败：' + errText(e))
      return { isError: true, content: [{ type: 'text', text: errText(e) }] }
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
            `默认模型：${config.model}（文生图）；${NEW_MODEL}（图生图）`,
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
