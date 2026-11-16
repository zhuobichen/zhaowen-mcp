/**
 * MiniMax 生图 API 客户端。
 *
 *   提交  POST {base}/image_generation
 *   body  { model, prompt, aspect_ratio, n, response_format, prompt_optimizer }
 *
 * 注意两点（都是踩过的）：
 *   1. HTTP 200 也可能是业务失败，必须看 base_resp.status_code === 0；
 *   2. 返回的 base64 实测是 JPEG，不能按扩展名写 .png（下游按 magic 判类型会拒读）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from './config.js'

export interface GenerateParams {
  prompt: string
  aspectRatio?: string
  n?: number
  model?: string
  promptOptimizer?: boolean
}

export interface GeneratedImage {
  /** 落盘的绝对路径（response_format=base64 时才有） */
  path?: string
  /** 远程 URL（response_format=url 时才有） */
  url?: string
  bytes?: number
}

interface ApiResponse {
  base_resp?: { status_code?: number; status_msg?: string }
  data?: {
    image_base64?: string[]
    image_urls?: string[]
    images?: unknown[]
  }
  [k: string]: unknown
}

async function callOnce(
  base: string,
  params: GenerateParams,
  format: 'base64' | 'url',
): Promise<ApiResponse> {
  const res = await fetch(`${base}/image_generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model || config.model,
      prompt: params.prompt,
      aspect_ratio: params.aspectRatio || config.defaultAspect,
      n: Math.max(1, Math.min(4, params.n ?? 1)),
      response_format: format,
      prompt_optimizer: params.promptOptimizer ?? true,
    }),
    signal: AbortSignal.timeout(180_000),
  })

  const text = await res.text()
  let json: ApiResponse
  try {
    json = JSON.parse(text) as ApiResponse
  } catch {
    throw new Error(`HTTP ${res.status} 返回不是 JSON：${text.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`)
  return json
}

/**
 * 调接口；主域名失败会退到备用域名（国内站与 minimax.chat 是两套网关）。
 */
export async function requestImage(
  params: GenerateParams,
  format: 'base64' | 'url' = 'base64',
): Promise<{ json: ApiResponse; base: string }> {
  if (!config.apiKey) {
    throw new Error(
      `没有 MiniMax API Key。请在 ${config.configPath} 里填 apiKey，或设置环境变量 MINIMAX_API_KEY。`,
    )
  }
  const errors: string[] = []
  for (const base of config.bases) {
    try {
      const json = await callOnce(base, params, format)
      const status = json?.base_resp?.status_code
      if (status !== undefined && status !== 0) {
        // 业务错误：换域名通常也没用，但换一下能区分"key 不对"和"网关不对"
        throw new Error(`MiniMax 业务错误 ${status}: ${json?.base_resp?.status_msg ?? ''}`)
      }
      return { json, base }
    } catch (e) {
      errors.push(`${base} → ${(e as Error).message.slice(0, 160)}`)
    }
  }
  throw new Error(`全部域名都失败：\n${errors.join('\n')}`)
}

const EXT_BY_MAGIC = (buf: Buffer): string => {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.slice(0, 4).toString('hex') === '89504e47') return 'png'
  if (buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return 'bin'
}

/**
 * 把 base64 图片写盘。文件名 stem 由调用方给，多张自动加序号。
 */
export function saveImages(
  b64List: string[],
  outDir: string,
  stem: string,
): GeneratedImage[] {
  const dir = resolve(outDir || config.outDir)
  mkdirSync(dir, { recursive: true })
  const saved: GeneratedImage[] = []
  b64List.forEach((b64, i) => {
    const buf = Buffer.from(b64, 'base64')
    const ext = EXT_BY_MAGIC(buf)
    const file = join(dir, b64List.length > 1 ? `${stem}-${i + 1}.${ext}` : `${stem}.${ext}`)
    writeFileSync(file, buf)
    saved.push({ path: file, bytes: buf.length })
  })
  return saved
}

export function stampName(prefix = 'mm'): string {
  const s = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${prefix}-${s}`
}
