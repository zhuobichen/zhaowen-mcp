#!/usr/bin/env npx tsx
/**
 * ima MCP Server — 腾讯 ima 知识库 / 笔记 官方 OpenAPI
 *
 * 启动: npx tsx ima-mcp/index.ts
 * 凭证: IMA_CLIENT_ID + IMA_API_KEY（见 README，或 ~/.config/ima/）
 * 申请: https://ima.qq.com/agent-interface
 *
 * 规格来源: 官方 skill 包 ima-skills-1.1.10
 *   knowledge-base/references/api.md -> /openapi/wiki/v1/*
 *   notes/references/api.md-> /openapi/note/v1/*
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'

const BASE_URL = process.env.IMA_BASE_URL || 'https://ima.qq.com'
const SKILL_VERSION = '1.1.10'
const SERVICE_DIR = import.meta.dirname || '.'

// ---------- 配置 ----------

function readTextSafe(file: string) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

/** 极简 .env 加载：只填补尚未存在的变量，不覆盖已有环境变量。 */
function loadDotEnv() {
  // 优先本服务目录的 .env，其次集合仓库根目录的 .env
  const candidates = [
    join(SERVICE_DIR, '.env'),
    resolve(join(SERVICE_DIR, '..', '..', '.env')),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    for (const line of readTextSafe(file).split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!m) continue
      const value = m[2].trim().replace(/^["']|["']$/g, '')
      if (value && process.env[m[1]] === undefined) process.env[m[1]] = value
    }
  }
}

function credentials() {
  const clientId =
    process.env.IMA_CLIENT_ID ||
    process.env.IMA_OPENAPI_CLIENTID ||
    readTextSafe(join(homedir(), '.config/ima/client_id'))
  const apiKey =
    process.env.IMA_API_KEY ||
    process.env.IMA_OPENAPI_APIKEY ||
    readTextSafe(join(homedir(), '.config/ima/api_key'))

  if (!clientId || !apiKey) {
    throw new Error(
      '缺少 ima 凭证。请设置 IMA_CLIENT_ID / IMA_API_KEY 环境变量，' +
        '或写入 ima-mcp/.env，' +
        '或放到 ~/.config/ima/client_id 与 ~/.config/ima/api_key。' +
        '申请入口: https://ima.qq.com/agent-interface',
    )
  }
  return { clientId, apiKey }
}

// ---------- API 调用 ----------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 可重试错误码: 下游网络错误 / 频控 / 服务器内部错误
const RETRYABLE = new Set([110010, 110021, 20002, 210003])

async function call(apiPath: string, body: unknown, attempt = 0): Promise<any> {
  const { clientId, apiKey } = credentials()

  let res
  try {
    res = await fetch(`${BASE_URL}/${apiPath}`, {
      method: 'POST',
      headers: {
        'ima-openapi-clientid': clientId,
        'ima-openapi-apikey': apiKey,
        'ima-openapi-ctx': `skill_version=${SKILL_VERSION}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(`网络请求失败 (${apiPath}): ${(e as any)?.message || e}`)
  }

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`HTTP ${res.status} 返回非 JSON 响应: ${text.slice(0, 300)}`)
  }

  const code = json.code ?? -1
  if (code === 0) return json.data ?? {}

  if (RETRYABLE.has(code) && attempt < 2) {
    await sleep(800 * (attempt + 1))
    return call(apiPath, body, attempt + 1)
  }
  throw new Error(`ima ${apiPath} 失败 (code=${code}): ${json.msg || '未知错误'}`)
}

// ---------- COS 直传 ----------
// create_media 拿到临时凭证后，用它把文件本体 PUT 到腾讯云 COS。
// 签名算法参考 https://cloud.tencent.com/document/product/436/7778

const hmacSha1 = (key: string, data: string) =>
  createHmac('sha1', key).update(data).digest('hex')
const sha1 = (data: string) => createHash('sha1').update(data).digest('hex')

async function cosUpload(cred: any, filePath: string, contentType: string) {
  const buf = readFileSync(filePath)
  const host = `${cred.bucket_name}.cos.${cred.region}.myqcloud.com`
  const pathname = `/${cred.cos_key}`
  const keyTime = `${cred.start_time};${cred.expired_time}`

  const signedHeaders: Record<string, string> = {
    'content-length': String(buf.length),
    host,
  }
  const headerKeys = Object.keys(signedHeaders).sort()
  const httpHeaders = headerKeys
    .map(k => `${k}=${encodeURIComponent(signedHeaders[k])}`)
    .join('&')
  const httpString = `put\n${pathname}\n\n${httpHeaders}\n`
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`
  const signature = hmacSha1(hmacSha1(cred.secret_key, keyTime), stringToSign)

  const authorization = [
    'q-sign-algorithm=sha1',
    `q-ak=${cred.secret_id}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerKeys.join(';')}`,
    'q-url-param-list=',
    `q-signature=${signature}`,
  ].join('&')

  const res = await fetch(`https://${host}${pathname}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      Authorization: authorization,
      'x-cos-security-token': cred.token,
    },
    body: buf,
  })
  if (!res.ok) {
    throw new Error(`COS 上传失败 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
}

// ---------- 类型映射 ----------

const MEDIA_TYPES: Record<string, { media_type: number; content_type: string }> = {
  pdf: { media_type: 1, content_type: 'application/pdf' },
  doc: { media_type: 3, content_type: 'application/msword' },
  docx: {
    media_type: 3,
    content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  ppt: { media_type: 4, content_type: 'application/vnd.ms-powerpoint' },
  pptx: {
    media_type: 4,
    content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  xls: { media_type: 5, content_type: 'application/vnd.ms-excel' },
  xlsx: {
    media_type: 5,
    content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  csv: { media_type: 5, content_type: 'text/csv' },
  md: { media_type: 7, content_type: 'text/markdown' },
  markdown: { media_type: 7, content_type: 'text/markdown' },
  png: { media_type: 9, content_type: 'image/png' },
  jpg: { media_type: 9, content_type: 'image/jpeg' },
  jpeg: { media_type: 9, content_type: 'image/jpeg' },
  webp: { media_type: 9, content_type: 'image/webp' },
  txt: { media_type: 13, content_type: 'text/plain' },
  xmind: { media_type: 14, content_type: 'application/x-xmind' },
  mp3: { media_type: 15, content_type: 'audio/mpeg' },
  m4a: { media_type: 15, content_type: 'audio/x-m4a' },
  wav: { media_type: 15, content_type: 'audio/wav' },
  aac: { media_type: 15, content_type: 'audio/aac' },
  html: { media_type: 20, content_type: 'text/html' },
  htm: { media_type: 20, content_type: 'text/html' },
  epub: { media_type: 21, content_type: 'application/epub+xml' },
}

// 上传大小上限（字节），来自官方文档
const SIZE_LIMIT: Record<number, number> = {
  5: 10 * 1024 * 1024,
  7: 10 * 1024 * 1024,
  13: 10 * 1024 * 1024,
  14: 10 * 1024 * 1024,
  20: 10 * 1024 * 1024,
  9: 30 * 1024 * 1024,
  21: 50 * 1024 * 1024,
}
const DEFAULT_SIZE_LIMIT = 200 * 1024 * 1024

function detectType(filePath: string) {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase()
  const hit = MEDIA_TYPES[ext]
  if (!hit) {
    throw new Error(
      `无法识别的文件类型 ".${ext}"。支持: ${Object.keys(MEDIA_TYPES).join(', ')}`,
    )
  }
  return hit
}

// ---------- 输出helper ----------

const out = (data: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
}) as { content: { type: 'text'; text: string }[]; isError?: boolean }

const str = (v: unknown, field: string) => {
  const s = String(v ?? '').trim()
  if (!s) throw new Error(`缺少必填参数: ${field}`)
  return s
}

function clampInt(v: unknown, min: number, max: number, dflt: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

const ts = (ms: number) => (ms ? new Date(ms).toISOString() : '')

function fmtNote(n: any) {
  return {
    note_id: n.note_id,
    title: n.title,
    summary: n.summary,
    notebook: n.note_ext_info?.folder_name,
    folder_id: n.note_ext_info?.folder_id,
    created: ts(n.create_time),
    modified: ts(n.modify_time),
  }
}

const WIKI = 'openapi/wiki/v1'
const NOTE = 'openapi/note/v1'

// ---------- 工具实现 ----------

const handlers: Record<string, (a: any) => Promise<any>> = {
  // ===== 知识库 =====

  async ima_search_knowledge_bases(a) {
    const data = await call(`${WIKI}/search_knowledge_base`, {
      query: str(a.query, 'query'),
      cursor: String(a.cursor ?? ''),
      limit: clampInt(a.limit, 1, 20, 20),
    })
    return out({
      results: (data.info_list || []).map((k: any) => ({
        id: k.id,
        name: k.name,
        cover_url: k.cover_url,
      })),
      is_end: data.is_end,
      next_cursor: data.next_cursor || '',
    })
  },

  async ima_list_addable_knowledge_bases(a) {
    const data = await call(`${WIKI}/get_addable_knowledge_base_list`, {
      cursor: String(a.cursor ?? ''),
      limit: clampInt(a.limit, 1, 50, 50),
    })
    return out({
      knowledge_bases: (data.addable_knowledge_base_list || []).map((k: any) => ({
        id: k.id,
        name: k.name,
      })),
      is_end: data.is_end,
      next_cursor: data.next_cursor || '',
    })
  },

  async ima_get_knowledge_base(a) {
    const raw: any[] = Array.isArray(a.ids) ? a.ids : [a.ids]
    const ids = raw.map((v: any) => str(v, 'ids')).slice(0, 20)
    if (!ids.length) throw new Error('缺少必填参数: ids')
    const data = await call(`${WIKI}/get_knowledge_base`, { ids })
    const infos = data.infos || {}
    const result: Record<string, unknown> = {}
    for (const [id, k] of Object.entries(infos) as [string, any][]) {
      result[id] = {
        id: k.id || id,
        name: k.name,
        description: k.description,
        cover_url: k.cover_url,
        recommended_questions: k.recommended_questions || [],
      }
    }
    return out(result)
  },

  async ima_list_knowledge(a) {
    const body: Record<string, unknown> = {
      knowledge_base_id: str(a.knowledge_base_id, 'knowledge_base_id'),
      cursor: String(a.cursor ?? ''),
      limit: clampInt(a.limit, 1, 50, 50),
    }
    if (a.folder_id) body.folder_id = String(a.folder_id)
    const data = await call(`${WIKI}/get_knowledge_list`, body)
    return out({
      path: (data.current_path || []).map((f: any) => f.name),
      knowledge_list: (data.knowledge_list || []).map((k: any) => ({
        media_id: k.media_id,
        title: k.title,
        parent_folder_id: k.parent_folder_id,
      })),
      is_end: data.is_end,
      next_cursor: data.next_cursor || '',
    })
  },

  async ima_search_knowledge(a) {
    const data = await call(`${WIKI}/search_knowledge`, {
      query: str(a.query, 'query'),
      knowledge_base_id: str(a.knowledge_base_id, 'knowledge_base_id'),
      cursor: String(a.cursor ?? ''),
    })
    return out({
      results: (data.info_list || []).map((k: any) => ({
        media_id: k.media_id,
        title: k.title,
        parent_folder_id: k.parent_folder_id,
        highlight: k.highlight_content || '',
      })),
      is_end: data.is_end,
      next_cursor: data.next_cursor || '',
    })
  },

  async ima_check_repeated_names(a) {
    const raw: any[] = Array.isArray(a.names) ? a.names : [{ name: a.name, media_type: a.media_type }]
    const params = raw
      .filter((x: any) => x?.name)
      .map((x: any) => ({ name: String(x.name), media_type: Number(x.media_type) || 1 }))
    if (!params.length) throw new Error('缺少必填参数: names（文件名列表）')
    const body: Record<string, unknown> = {
      knowledge_base_id: str(a.knowledge_base_id, 'knowledge_base_id'),
      params: params.slice(0, 2000),
    }
    if (a.folder_id) body.folder_id = String(a.folder_id)
    const data = await call(`${WIKI}/check_repeated_names`, body)
    return out({ results: data.results || [] })
  },

  async ima_import_urls(a) {
    const urls = (Array.isArray(a.urls) ? a.urls : [a.urls])
      .map((u: any) => String(u ?? '').trim())
      .filter(Boolean)
    if (!urls.length) throw new Error('缺少必填参数: urls')
    if (urls.length > 10) throw new Error('单次最多导入 10 个 URL')
    const kbId = str(a.knowledge_base_id, 'knowledge_base_id')
    const data = await call(`${WIKI}/import_urls`, {
      knowledge_base_id: kbId,
      // 根目录的 folder_id 等于 knowledge_base_id
      folder_id: str(a.folder_id, 'folder_id') || kbId,
      urls,
    })
    return out({ results: data.results || {} })
  },

  async ima_add_knowledge(a) {
    const mediaType = Number(a.media_type)
    const body: Record<string, any> = {
      media_type: mediaType,
      title: str(a.title, 'title'),
      knowledge_base_id: str(a.knowledge_base_id, 'knowledge_base_id'),
    }
    if (a.media_id) body.media_id = String(a.media_id)
    if (a.folder_id) body.folder_id = String(a.folder_id)
    if (a.content_id) {
      const key =
        mediaType === 11 ? 'note_info' : mediaType === 12 ? 'session_info' : 'web_info'
      body[key] = { content_id: String(a.content_id) }
    }
    if (a.file_info) body.file_info = a.file_info
    return out(await call(`${WIKI}/add_knowledge`, body))
  },

  async ima_get_media_info(a) {
    const data = await call(`${WIKI}/get_media_info`, {
      media_id: str(a.media_id, 'media_id'),
    })
    let hint = ''
    if (!data.url_info?.url) {
      hint =
        data.media_type === 11
          ? '这是笔记类型，用 ima_read_media 读取正文。'
          : '无可访问链接，请用 ima 客户端查看原文。'
    }
    return out({
      media_type: data.media_type,
      has_url: Boolean(data.url_info?.url),
      url: data.url_info?.url || '',
      headers: data.url_info?.headers || {},
      notebook_id: data.notebook_ext_info?.notebook_id || '',
      hint,
    })
  },

  // create_media + COS 直传 + add_knowledge 一步到位
  async ima_upload_file(a) {
    const filePath = resolve(str(a.file_path, 'file_path'))
    if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`)

    const { media_type, content_type } = detectType(filePath)
    const stat = statSync(filePath)
    const limit = SIZE_LIMIT[media_type] ?? DEFAULT_SIZE_LIMIT
    if (stat.size > limit) {
      throw new Error(
        `文件超限: ${(stat.size / 1048576).toFixed(1)}MB > ${(limit / 1048576).toFixed(0)}MB（media_type=${media_type}）`,
      )
    }

    const kbId = str(a.knowledge_base_id, 'knowledge_base_id')
    const fileName = String(a.file_name || basename(filePath))
    const title = String(a.title || fileName)
    const fileExt = extname(fileName).replace(/^\./, '').toLowerCase()

    const created = await call(`${WIKI}/create_media`, {
      file_name: fileName,
      file_size: stat.size,
      content_type,
      knowledge_base_id: kbId,
      file_ext: fileExt,
    })

    await cosUpload(created.cos_credential, filePath, content_type)

    const body: Record<string, any> = {
      media_type,
      media_id: created.media_id,
      title,
      knowledge_base_id: kbId,
      file_info: {
        cos_key: created.cos_credential.cos_key,
        file_size: stat.size,
        last_modify_time: Math.floor(stat.mtimeMs / 1000),
        file_name: fileName,
      },
    }
    if (a.folder_id) body.folder_id = String(a.folder_id)
    const added = await call(`${WIKI}/add_knowledge`, body)

    return out({ media_id: added.media_id || created.media_id, title, media_type })
  },

  // media_id -> 可读正文（原文链接抓取或笔记正文）
  async ima_read_media(a) {
    const mediaId = str(a.media_id, 'media_id')
    const maxChars = clampInt(a.max_chars, 200, 200000, 20000)
    const info = await call(`${WIKI}/get_media_info`, { media_id: mediaId })

    if (info.media_type === 11 && info.notebook_ext_info?.notebook_id) {
      const doc = await call(`${NOTE}/get_doc_content`, {
        note_id: info.notebook_ext_info.notebook_id,
        target_content_format: 0,
      })
      return out({ media_id: mediaId, source: 'note', content: doc.content || '' })
    }

    const url = info.url_info?.url
    if (!url) {
      return out({
        media_id: mediaId,
        media_type: info.media_type,
        content: null,
        hint: '该媒体无可访问链接，请使用 ima 客户端查看原文。',
      })
    }

    const res = await fetch(url, { headers: info.url_info?.headers || {} })
    if (!res.ok) {
      return out({
        media_id: mediaId,
        media_type: info.media_type,
        url,
        content: null,
        hint: `原文链接请求失败 (HTTP ${res.status})，请使用 ima 客户端查看。`,
      })
    }
    const raw = await res.text()
    return out({
      media_id: mediaId,
      media_type: info.media_type,
      url,
      truncated: raw.length > maxChars,
      content: raw.slice(0, maxChars),
    })
  },

  // ===== 笔记 =====

  async ima_list_notebooks(a) {
    const data = await call(`${NOTE}/list_notebook`, {
      cursor: String(a.cursor ?? '0'),
      limit: clampInt(a.limit, 1, 20, 20),
    })
    return out({
      notebooks: (data.note_folder_infos || []).map((f: any) => ({
        folder_id: f.folder_id,
        name: f.name,
        note_number: f.note_number,
        parent_folder_id: f.parent_folder_id,
        folder_type: f.folder_type,
        modified: ts(f.modify_time),
      })),
      is_end: data.is_end,
      next_cursor: data.next_cursor || '',
    })
  },

  async ima_list_notes(a) {
    const body: Record<string, any> = {
      cursor: String(a.cursor ?? ''),
      limit: clampInt(a.limit, 1, 20, 20),
      sort_type: Number(a.sort_type ?? 0),
    }
    if (a.folder_id) body.folder_id = String(a.folder_id)
    const data = await call(`${NOTE}/list_note`, body)
    return out({
      notes: (data.note_book_list || []).map(fmtNote),
      is_end: data.is_end,
    })
  },

  async ima_search_notes(a) {
    const limit = clampInt(a.limit, 1, 20, 20)
    const start = Math.max(0, Number(a.start) || 0)
    const query: Record<string, string> = {}
    if (a.title) query.title = String(a.title)
    if (a.content) query.content = String(a.content)
    if (!query.title && !query.content) {
      throw new Error('至少需要 title 或 content 其中一个搜索关键词')
    }
    const data = await call(`${NOTE}/search_note`, {
      search_type: a.content && !a.title ? 1 : Number(a.search_type ?? 0),
      sort_type: Number(a.sort_type ?? 0),
      query_info: query,
      start,
      end: start + limit,
    })
    return out({
      notes: (data.search_note_infos || []).map((s: any) => ({
        ...fmtNote(s.note_book_info || {}),
        highlight: s.highlightInfo || {},
      })),
      is_end: data.is_end,
      total: data.total_hit_num,
    })
  },

  async ima_get_note_content(a) {
    const noteId = str(a.note_id, 'note_id')
    const format = Number(a.format ?? 0)
    const data = await call(`${NOTE}/get_doc_content`, {
      note_id: noteId,
      target_content_format: format,
    })
    return out({ note_id: noteId, format, content: data.content || '' })
  },

  async ima_create_note(a) {
    const body: Record<string, any> = {
      content_format: 1,
      content: str(a.content, 'content'),
    }
    if (a.folder_id) body.folder_id = String(a.folder_id)
    if (a.folder_name) body.folder_name = String(a.folder_name)
    return out(await call(`${NOTE}/import_doc`, body))
  },

  async ima_append_note(a) {
    return out(
      await call(`${NOTE}/append_doc`, {
        note_id: str(a.note_id, 'note_id'),
        content_format: 1,
        content: str(a.content, 'content'),
      }),
    )
  },
}

// ---------- 工具清单 ----------

const folderIdDesc = '文件夹 ID；省略表示根目录（根目录 ID = knowledge_base_id）'
const mediaTypeDesc =
  '1=PDF 2=网页 3=Word 4=PPT 5=Excel 6=公众号文章 7=Markdown 9=图片 11=笔记 12=AI会话 13=TXT 14=Xmind 15=音频 20=HTML 21=EPUB'

const TOOLS = [
  {
    name: 'ima_search_knowledge_bases',
    description: '按关键词搜索 ima 知识库列表，返回知识库 ID 和名称。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '1-20，默认 20' },
        cursor: { type: 'string', description: '游标，首次传空字符串' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ima_list_addable_knowledge_bases',
    description: '列出当前账号有权限写入内容的知识库（上传前先查这个）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '1-50，默认 50' },
        cursor: { type: 'string', description: '游标，首次传空字符串' },
      },
    },
  },
  {
    name: 'ima_get_knowledge_base',
    description: '获取指定知识库的名称、描述、封面和推荐问题。',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: '知识库 ID 列表，1-20 个',
        },
      },
      required: ['ids'],
    },
  },
  {
    name: 'ima_list_knowledge',
    description: '浏览知识库某个文件夹下的条目（逐级下钻定位 folder_id）。',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge_base_id: { type: 'string', description: '知识库 ID' },
        folder_id: { type: 'string', description: folderIdDesc },
        limit: { type: 'number', description: '1-50，默认 50' },
        cursor: { type: 'string', description: '游标，首次传空字符串' },
      },
      required: ['knowledge_base_id'],
    },
  },
  {
    name: 'ima_search_knowledge',
    description: '在指定知识库内搜索条目，返回标题和高亮片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        knowledge_base_id: { type: 'string', description: '知识库 ID' },
        cursor: { type: 'string', description: '游标，首次传空字符串' },
      },
      required: ['query', 'knowledge_base_id'],
    },
  },
  {
    name: 'ima_check_repeated_names',
    description: '检查目标文件夹内是否已有同名文件（上传前查重）。仅文件类型适用。',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge_base_id: { type: 'string', description: '知识库 ID' },
        folder_id: { type: 'string', description: folderIdDesc },
        names: {
          type: 'array',
          description: '待检查的文件 [{name, media_type}]，最多 2000 个',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '文件名' },
              media_type: { type: 'number', description: mediaTypeDesc },
            },
            required: ['name'],
          },
        },
      },
      required: ['knowledge_base_id', 'names'],
    },
  },
  {
    name: 'ima_import_urls',
    description:
      '把网页 / 微信公众号文章导入知识库（1-10 个 URL，服务端自动识别类型）。',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge_base_id: { type: 'string', description: '知识库 ID' },
        folder_id: { type: 'string', description: folderIdDesc },
        urls: { type: 'array', items: { type: 'string' }, description: 'URL 列表，1-10 个' },
      },
      required: ['knowledge_base_id', 'urls'],
    },
  },
  {
    name: 'ima_upload_file',
    description:
      '上传本地文件到知识库（自动完成 创建媒体 → COS 直传 → 入库）。支持 PDF/Word/PPT/Excel/MD/图片/TXT/Xmind/HTML/EPUB/音频。',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '本地文件绝对路径' },
        knowledge_base_id: { type: 'string', description: '目标知识库 ID' },
        title: { type: 'string', description: '标题，默认用文件名' },
        folder_id: { type: 'string', description: folderIdDesc },
        file_name: { type: 'string', description: '入库文件名，默认用原文件名' },
      },
      required: ['file_path', 'knowledge_base_id'],
    },
  },
  {
    name: 'ima_add_knowledge',
    description:
      '把已有内容加入知识库：网页/公众号文章（media_type 2/6 + content_id）、笔记（11）、AI会话（12）。文件请用 ima_upload_file。',
    inputSchema: {
      type: 'object',
      properties: {
        media_type: { type: 'number', description: mediaTypeDesc },
        title: { type: 'string' },
        knowledge_base_id: { type: 'string' },
        folder_id: { type: 'string', description: folderIdDesc },
        content_id: { type: 'string', description: 'URL / 笔记 doc_id / 会话 session_id' },
      },
      required: ['media_type', 'title', 'knowledge_base_id'],
    },
  },
  {
    name: 'ima_get_media_info',
    description: '获取知识库条目的访问信息（media_type / 原文链接 / 笔记 ID）。',
    inputSchema: {
      type: 'object',
      properties: { media_id: { type: 'string', description: '媒体 ID' } },
      required: ['media_id'],
    },
  },
  {
    name: 'ima_read_media',
    description: '读取知识库条目正文：自动走原文链接抓取，笔记类型自动转纯文本。',
    inputSchema: {
      type: 'object',
      properties: {
        media_id: { type: 'string', description: '媒体 ID' },
        max_chars: { type: 'number', description: '最大返回字符数，默认 20000' },
      },
      required: ['media_id'],
    },
  },
  {
    name: 'ima_list_notebooks',
    description: '列出ima 笔记本（分类）目录。folder_type: 0=自建 1=全部 2=未分类。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '1-20，默认 20' },
        cursor: { type: 'string', description: '游标，首次传 "0"' },
      },
    },
  },
  {
    name: 'ima_list_notes',
    description: '列出笔记本下的笔记（省略 folder_id 则拉取全部笔记）。',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: { type: 'string', description: '笔记本 ID，省略表示全部' },
        limit: { type: 'number', description: '1-20，默认 20' },
        cursor: { type: 'string', description: '游标，首次传空字符串' },
        sort_type: { type: 'number', description: '0=修改时间 1=创建时间 2=标题 3=大小' },
      },
    },
  },
  {
    name: 'ima_search_notes',
    description: '搜索ima 笔记（按标题或正文，可选排序）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题关键词' },
        content: { type: 'string', description: '正文关键词' },
        search_type: { type: 'number', description: '0=标题 1=正文' },
        sort_type: { type: 'number', description: '0=修改时间 1=创建时间 2=标题 3=大小' },
        start: { type: 'number', description: '翻页起始，默认 0' },
        limit: { type: 'number', description: '1-20，默认 20' },
      },
    },
  },
  {
    name: 'ima_get_note_content',
    description: '读取笔记正文（需为笔记作者）。format: 0=纯文本 2=JSON。',
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: '笔记 ID' },
        format: { type: 'number', description: '0=纯文本(默认) 2=JSON' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'ima_create_note',
    description: '用 Markdown 新建一篇笔记，可指定笔记本。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown 正文，不能为空' },
        folder_id: { type: 'string', description: '笔记本 ID' },
        folder_name: { type: 'string', description: '笔记本名称（不存在则创建）' },
      },
      required: ['content'],
    },
  },
  {
    name: 'ima_append_note',
    description: '向笔记末尾追加 Markdown 内容（需为笔记作者）。',
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: '笔记 ID' },
        content: { type: 'string', description: '要追加的 Markdown' },
      },
      required: ['note_id', 'content'],
    },
  },
]

// ---------- 启动 ----------

loadDotEnv()

async function main() {
  const server = new Server(
    { name: 'ima-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args = {} } = request.params
    const handler = handlers[name]
    if (!handler) return out({ error: `未知工具: ${name}` })
    try {
      return await handler(args)
    } catch (e: any) {
      return {
        content: [{ type: 'text', text: `错误: ${e?.message || e}` }],
        isError: true,
      }
    }
  })

  await server.connect(new StdioServerTransport())
}

main().catch((e: any) => {
  process.stderr.write(`ima-mcp 启动失败: ${e?.message || e}\n`)
  process.exit(1)
})
