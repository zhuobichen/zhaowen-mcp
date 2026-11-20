/**
 * MiniMax 生图 API 客户端。
 *
 * 两条路（2026-11 校正，别再搞错）：
 *
 *   ① 老模型 image-01
 *      文生图     POST {base}/image_generation   { model, prompt, aspect_ratio, n }
 *      单图参考   POST {base}/image_generation   + subject_reference: [{ type: 'character', image_file: <dataURL> }]
 *                 —— 只能一张，多张报 `image_reference must be one`
 *
 *   ② 新模型 MiniMax-H3-Image
 *      文生图     POST {base}/images/generations  { model, prompt, n, width, height }
 *      图片编辑   POST {base}/images/edits        { model, prompt, n, images: [{ image_url: <dataURL> }, …] }
 *                 —— 1~16 张
 *
 * 三个坑（都踩过，写在这里省得再踩）：
 *   1. 给 image-01 传 `image: [a, b]` 这种字段，接口**吞掉未知字段照常 200**，
 *      图看着"像"，其实参考图一张没进。参数错了不会报错，只会静静失效。
 *   2. image-01 的 subject_reference 只收一张；要传多张必须换新模型。
 *   3. HTTP 200 也可能是业务失败，必须看 base_resp.status_code === 0。
 *      另外返回的 base64 实测是 JPEG，不能按扩展名写 .png（下游按 magic 判类型会拒读）。
 *
 * 两种返回形状都要认：
 *   老 image-01 → { data: { image_base64: [...] } } 或 { data: { image_urls: [...] } }
 *   新 H3       → { created, data: [{ url, size, revised_prompt }] }
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { config } from './config.js'

/** 老模型：只做文生图 + 单图主体参考 */
export const OLD_MODEL = 'image-01'
/** 新模型：支持 1~16 张图片编辑 */
export const NEW_MODEL = 'MiniMax-H3-Image'

export interface GenerateParams {
  prompt: string
  aspectRatio?: string
  n?: number
  model?: string
  promptOptimizer?: boolean
  /** 参考图：本地绝对路径、http(s) URL 或 data: URL 都行 */
  images?: string[]
  width?: number
  height?: number
}

export interface GeneratedImage {
  /** 落盘的绝对路径 */
  path?: string
  /** 远程 URL */
  url?: string
  bytes?: number
}

interface ApiResponse {
  base_resp?: { status_code?: number; status_msg?: string }
  data?: unknown
  [k: string]: unknown
}

/** 错误对象不一定有 message（曾把 [object Object] 直接抛给用户），统一转成可读字符串。 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

/** 路径 / URL / dataURL → dataURL（新老接口都收 dataURL）。 */
export function toDataUrl(src: string): string {
  if (/^data:/i.test(src)) return src
  if (/^https?:\/\//i.test(src)) return src // 公网 URL 直接交给接口
  const abs = resolve(src)
  if (!existsSync(abs)) throw new Error(`参考图不存在：${abs}`)
  const mime = MIME_BY_EXT[extname(abs).toLowerCase()] ?? 'image/png'
  return `data:${mime};base64,${readFileSync(abs).toString('base64')}`
}

/** 从两种返回形状里取 URL 列表。 */
export function extractUrls(json: ApiResponse): string[] {
  const d = json?.data as any
  const out: string[] = []
  if (Array.isArray(d?.image_urls)) out.push(...d.image_urls)
  if (Array.isArray(d)) {
    for (const item of d) {
      const u = typeof item === 'string' ? item : item?.url
      if (typeof u === 'string' && u) out.push(u)
    }
  }
  const top = (json as any)?.image_urls
  if (Array.isArray(top)) out.push(...top)
  return out
}

/**
 * 从返回里取 base64 列表。实测三种形状，都要认：
 *   老接口 base64 → { data: { image_base64: [ ... ] } }
 *   老接口单值   → { data: { image_base64: "..." } }
 *   新接口       → { data: [ { b64_json: "..." } ] }
 */
export function extractBase64(json: ApiResponse): string[] {
  const d = json?.data as any
  const out: string[] = []
  if (Array.isArray(d?.image_base64)) out.push(...d.image_base64)
  else if (typeof d?.image_base64 === 'string') out.push(d.image_base64)
  if (Array.isArray(d)) {
    for (const item of d) {
      if (typeof item === 'string') continue // 纯 URL 字符串归 extractUrls
      const b = item?.b64_json ?? item?.image_base64
      if (typeof b === 'string' && b) out.push(b)
    }
  }
  const top = (json as any)?.b64_json
  if (typeof top === 'string' && top) out.push(top)
  return out
}

interface Plan {
  endpoint: string
  body: Record<string, unknown>
  note: string
}

function planRequest(params: GenerateParams, format: 'base64' | 'url'): Plan {
  const refs = params.images ?? []
  const explicitModel = params.model
  const useOld = explicitModel === OLD_MODEL || (!explicitModel && refs.length === 0)

  if (useOld) {
    if (refs.length > 1) {
      throw new Error(
        `${OLD_MODEL} 的 subject_reference 只收一张（多张会报 image_reference must be one）。` +
          `要传 ${refs.length} 张请改用默认的 ${NEW_MODEL}。`,
      )
    }
    return {
      endpoint: '/image_generation',
      note: `${OLD_MODEL} 文生图${refs.length ? ' + 单图主体参考' : ''}`,
      body: {
        model: OLD_MODEL,
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio || config.defaultAspect,
        n: Math.max(1, Math.min(4, params.n ?? 1)),
        // 老接口用 'base64'，新接口用 'b64_json' —— 名字不一样，传错报
        // invalid params, response_format must be url or b64_json
        response_format: format,
        prompt_optimizer: params.promptOptimizer ?? true,
        ...(refs.length
          ? { subject_reference: [{ type: 'character', image_file: toDataUrl(refs[0]) }] }
          : {}),
      },
    }
  }

  const model = explicitModel || NEW_MODEL
  // 新接口 /images/generations 与 /images/edits 只接受 'url' | 'b64_json'
  const newFormat = format === 'base64' ? 'b64_json' : 'url'
  if (refs.length === 0) {
    return {
      endpoint: '/images/generations',
      note: `${model} 文生图`,
      body: {
        model,
        prompt: params.prompt,
        n: Math.max(1, Math.min(4, params.n ?? 1)),
        response_format: newFormat,
        ...(params.width ? { width: params.width } : {}),
        ...(params.height ? { height: params.height } : {}),
      },
    }
  }
  if (refs.length > 16) throw new Error(`参考图最多 16 张，你给了 ${refs.length} 张`)
  return {
    endpoint: '/images/edits',
    note: `${model} 图片编辑（${refs.length} 张参考图）`,
    body: {
      model,
      prompt: params.prompt,
      n: Math.max(1, Math.min(4, params.n ?? 1)),
      response_format: newFormat,
      images: refs.map((p) => ({ image_url: toDataUrl(p) })),
      ...(params.width ? { width: params.width } : {}),
      ...(params.height ? { height: params.height } : {}),
    },
  }
}

async function callOnce(
  base: string,
  plan: Plan,
  timeoutMs = 300_000,
): Promise<ApiResponse> {
  const res = await fetch(`${base}${plan.endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(plan.body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const text = await res.text()
  let json: ApiResponse
  try {
    json = JSON.parse(text) as ApiResponse
  } catch {
    throw new Error(`HTTP ${res.status} 返回不是 JSON：${text.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`)
  // MiniMax 用 HTTP 200 + base_resp 表达业务失败
  const status = json?.base_resp?.status_code
  if (status !== undefined && status !== 0) {
    throw new Error(`MiniMax 业务错误 ${status}: ${json?.base_resp?.status_msg ?? ''}`)
  }
  return json
}

/**
 * 调接口；主域名失败会退到备用域名（国内站与 minimax.chat 是两套网关）。
 */
export async function requestImage(
  params: GenerateParams,
  format: 'base64' | 'url' = 'base64',
): Promise<{ json: ApiResponse; base: string; note: string }> {
  if (!config.apiKey) {
    throw new Error(
      `没有 MiniMax API Key。请在 ${config.configPath} 里填 apiKey，或设置环境变量 MINIMAX_API_KEY。`,
    )
  }
  const plan = planRequest(params, format)
  const errors: string[] = []
  for (const base of config.bases) {
    try {
      const json = await callOnce(base, plan)
      return { json, base, note: plan.note }
    } catch (e) {
      errors.push(`${base} → ${errText(e).slice(0, 160)}`)
    }
  }
  throw new Error(`全部域名都失败（${plan.note}）：\n${errors.join('\n')}`)
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

/**
 * 新模型只回 URL 时，下载后同样落盘（扩展名按 magic 判，不信 URL 后缀）。
 */
export async function downloadImages(
  urls: string[],
  outDir: string,
  stem: string,
  timeoutMs = 120_000,
): Promise<GeneratedImage[]> {
  const dir = resolve(outDir || config.outDir)
  mkdirSync(dir, { recursive: true })
  const saved: GeneratedImage[] = []
  for (let i = 0; i < urls.length; i += 1) {
    const res = await fetch(urls[i], { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`下载第 ${i + 1} 张失败：HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = EXT_BY_MAGIC(buf)
    const file = join(dir, urls.length > 1 ? `${stem}-${i + 1}.${ext}` : `${stem}.${ext}`)
    writeFileSync(file, buf)
    saved.push({ path: file, url: urls[i], bytes: buf.length })
  }
  return saved
}

export function stampName(prefix = 'mm'): string {
  const s = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${prefix}-${s}`
}
