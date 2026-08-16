#!/usr/bin/env node
/**
 * MiniMax H3 生视频 MCP server。
 *
 * 三个工具：
 *   submit_video   提交文生视频/图生视频任务 → task_id
 *   query_video    轮询任务状态 → 视频下载 URL
 *   download_video 下载视频到本地
 *
 * 通过 stdio 与 MCP 客户端通信。日志一律走 stderr，stdout 只用于 MCP 协议。
 */
import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { submitVideo, queryVideo, downloadVideo } from './client.js'
import { config } from './config.js'

const server = new McpServer({ name: 'minimax-video', version: '0.1.0' })

server.registerTool(
  'submit_video',
  {
    title: '提交视频生成任务',
    description:
      '提交 MiniMax H3 视频生成任务（文生视频 t2v / 图生视频 i2v），返回 task_id。之后用 query_video 轮询状态直到完成。',
    inputSchema: {
      prompt: z.string().min(1).describe('视频描述文本，支持运镜指令如 [左摇] [推进] [跟随]'),
      mode: z.enum(['t2v', 'i2v']).default('t2v').describe('生成模式：t2v 文生视频，i2v 图生视频'),
      resolution: z.enum(['512p', '768p', '1080p', '2K']).default('2K').describe('分辨率'),
      duration: z.number().int().min(4).max(15).default(6).describe('时长（秒），H3 支持 4–15'),
      ratio: z.string().default('16:9').describe('画面比例，如 16:9 / 9:16 / 1:1 / 21:9'),
      first_frame_image: z.string().optional().describe('图生视频首帧：图片 URL 或 base64'),
      last_frame_image: z.string().optional().describe('图生视频尾帧：图片 URL 或 base64'),
    },
  },
  async (args) => {
    try {
      const taskId = await submitVideo(args)
      return {
        content: [
          {
            type: 'text',
            text: `✅ 任务已提交\ntask_id: ${taskId}\n\n下一步：调用 query_video（task_id=${taskId}）轮询状态，完成后取 video_url 再 download_video 下载。`,
          },
        ],
      }
    } catch (e) {
      return { content: [{ type: 'text', text: `❌ 提交失败：${(e as Error).message}` }], isError: true }
    }
  },
)

server.registerTool(
  'query_video',
  {
    title: '查询视频任务',
    description: '按 task_id 查询 MiniMax H3 视频生成任务状态，完成后返回视频下载 URL。',
    inputSchema: {
      task_id: z.string().min(1).describe('提交任务时返回的 task_id'),
    },
  },
  async ({ task_id }) => {
    try {
      const s = await queryVideo(task_id)
      const lines = [`状态：${s.status}`, `task_id: ${s.taskId}`]
      if (s.videoUrl) {
        lines.push(`视频 URL：${s.videoUrl}\n\n用 download_video 下载到本地（URL 有效期约 24h，请尽快保存）。`)
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }
      if (['succeeded', 'success', 'completed', 'failed', 'error'].includes(s.status)) {
        lines.push('（任务已结束但未解析到视频 URL，原始返回见下）\n')
        lines.push(JSON.stringify(s.raw, null, 2))
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }
      lines.push('（未解析到视频 URL，原始返回见下）\n')
      lines.push(JSON.stringify(s.raw, null, 2))
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `❌ 查询失败：${(e as Error).message}` }], isError: true }
    }
  },
)

server.registerTool(
  'download_video',
  {
    title: '下载视频到本地',
    description: '下载视频 URL 到本地文件，返回保存路径。',
    inputSchema: {
      url: z.string().min(1).describe('视频 URL（来自 query_video 的 video_url）'),
      output_path: z.string().min(1).describe('本地保存路径，如 D:/videos/out.mp4'),
    },
  },
  async ({ url, output_path }) => {
    try {
      const p = await downloadVideo(url, output_path)
      return { content: [{ type: 'text', text: `✅ 已下载到：${p}` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `❌ 下载失败：${(e as Error).message}` }], isError: true }
    }
  },
)

async function main(): Promise<void> {
  if (!config.apiKey) {
    console.error('[minimax-video] 未设置 MINIMAX_API_KEY 环境变量，请先在 .env 或 shell 中配置后重试。')
    process.exit(1)
  }
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[minimax-video] MCP server 已启动（base=${config.baseUrl}，model=${config.model}）`)
}

main().catch((e) => {
  console.error('[minimax-video] 启动失败：', e)
  process.exit(1)
})
