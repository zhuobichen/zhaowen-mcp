/**
 * MiniMax H3 视频生成 API 客户端。
 *
 * 官方 v2 端点（异步流程）：
 *   提交  POST {base}/v2/video_generation
 *   查询  GET  {base}/v2/query/video_generation/{task_id}
 *
 * 提交返回 task_id，轮询查询直到 status 为 success/completed，取视频 URL 下载。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config } from './config.js'

export interface SubmitParams {
  prompt: string
  mode: 't2v' | 'i2v'
  resolution: string
  duration: number
  ratio: string
  firstFrameImage?: string
  lastFrameImage?: string
}

export interface TaskStatus {
  status: string
  taskId: string
  videoUrl?: string
  raw: unknown
}

/** 提交视频生成任务，返回 task_id。 */
export async function submitVideo(params: SubmitParams): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.model,
    content: [{ type: 'text', text: params.prompt }],
    resolution: params.resolution,
    duration: params.duration,
    ratio: params.ratio,
  }
  if (params.mode === 'i2v') {
    if (params.firstFrameImage) body.first_frame_image = params.firstFrameImage
    if (params.lastFrameImage) body.last_frame_image = params.lastFrameImage
  }

  const res = await fetch(`${config.baseUrl}/v2/video_generation`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as any
  const taskId = json?.task_id ?? json?.data?.task_id
  if (!taskId) {
    throw new Error(`提交失败（HTTP ${res.status}）：${JSON.stringify(json)}`)
  }
  return taskId
}

/** 查询任务状态，成功后解析出视频 URL。 */
export async function queryVideo(taskId: string): Promise<TaskStatus> {
  const res = await fetch(`${config.baseUrl}/v2/query/video_generation/${taskId}`, {
    headers: authHeaders(),
  })
  const json = (await res.json()) as any
  const data = json?.task ?? json?.data ?? json
  const status = data?.status ?? 'unknown'
  return { status, taskId, videoUrl: extractUrl(data), raw: json }
}

/** 下载视频到本地文件，返回绝对路径。 */
export async function downloadVideo(url: string, outputPath: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const full = resolve(outputPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, buf)
  return full
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }
}

/** 宽松提取视频 URL：不同平台/版本的返回字段命名不一致，这里兜底。 */
function extractUrl(data: any): string | undefined {
  const direct = [
    data?.content?.url,
    data?.video_url,
    data?.url,
    data?.download_url,
    data?.videos?.[0]?.url,
    data?.video?.url,
    data?.result?.url,
    data?.output?.url,
    data?.outputs?.[0]?.url,
  ]
  for (const c of direct) {
    if (typeof c === 'string' && c.length > 0) return c
  }
  return deepFindUrl(data)
}

function deepFindUrl(obj: any, depth = 0): string | undefined {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined
  for (const [key, value] of Object.entries(obj)) {
    if ((key === 'url' || key === 'video_url' || key === 'download_url') && typeof value === 'string' && value.length > 0) {
      return value
    }
    if (typeof value === 'object') {
      const found = deepFindUrl(value, depth + 1)
      if (found) return found
    }
  }
  return undefined
}
