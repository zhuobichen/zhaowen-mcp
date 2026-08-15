/**
 * 环境变量配置。所有关键项都可用环境变量覆盖，
 * 以便在官方 MiniMax 平台与第三方聚合（EvoLink/EmpirioLabs 等）之间切换。
 */
export interface Config {
  /** MiniMax API Key（必填）。 */
  apiKey: string
  /** 基础 URL，默认官方 H3 端点域名。第三方聚合改这里。 */
  baseUrl: string
  /** 视频模型 ID，默认 MiniMax-H3。 */
  model: string
}

const baseUrl = (process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com').replace(/\/+$/, '')

export const config: Config = {
  apiKey: process.env.MINIMAX_API_KEY ?? '',
  baseUrl,
  model: process.env.MINIMAX_VIDEO_MODEL ?? 'MiniMax-H3',
}
