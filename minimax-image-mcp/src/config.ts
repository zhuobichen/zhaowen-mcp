/**
 * 配置读取：单一一处来源 —— qchat-cli 里那份不进 git 的 minimax.config.json。
 *
 * 为什么不在 MCP 里再存一份 key：key 一旦有两处，轮换时必有一处忘改，
 * 表现出来是"一个工具能用、另一个 2049 invalid api key"。
 *
 * 覆盖顺序：环境变量 > 配置文件 > 默认值
 *   MINIMAX_IMAGE_CONFIG  配置文件路径（默认指向 qchat-cli/private/minimax.config.json）
 *   MINIMAX_API_KEY       直接给 key（覆盖文件）
 *   MINIMAX_BASE_URL      覆盖 baseUrl
 *   MINIMAX_IMAGE_MODEL   覆盖模型（默认 image-01）
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DEFAULT_CONFIG =
  'D:\\github_project\\ZhaoWen_GitHub维护\\qchat-cli\\private\\minimax.config.json'

interface FileConfig {
  apiKey?: string
  baseUrl?: string
  baseUrlFallback?: string
  model?: string
  defaultAspect?: string
  outDir?: string
}

export interface Config {
  apiKey: string
  bases: string[]
  model: string
  defaultAspect: string
  outDir: string
  configPath: string
}

function loadFile(path: string): FileConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FileConfig
  } catch {
    return {}
  }
}

const configPath = process.env.MINIMAX_IMAGE_CONFIG || DEFAULT_CONFIG
const file = loadFile(configPath)

const baseUrl = (process.env.MINIMAX_BASE_URL || file.baseUrl || 'https://api.minimaxi.com/v1')
  .replace(/\/+$/, '')
const bases = [baseUrl, file.baseUrlFallback].filter(Boolean).map((b) => String(b).replace(/\/+$/, ''))

// outDir 在文件里是相对 qchat-cli 根的路径
const qchatRoot = dirname(dirname(configPath))
const outDir = file.outDir
  ? resolve(qchatRoot, file.outDir)
  : resolve(qchatRoot, 'output', 'gen')

export const config: Config = {
  apiKey: process.env.MINIMAX_API_KEY || file.apiKey || '',
  bases,
  model: process.env.MINIMAX_IMAGE_MODEL || file.model || 'image-01',
  defaultAspect: file.defaultAspect || '1:1',
  outDir,
  configPath,
}
