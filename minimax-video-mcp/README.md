# minimax-video-mcp

MiniMax H3（海螺 3.0）生视频 MCP server —— 把 MiniMax H3 的文生视频 / 图生视频 API 封装成 MCP 工具，供 Claude Code、DSH 等 MCP 客户端调用。

## 功能

三个工具，覆盖完整异步流程：

| 工具 | 作用 |
|------|------|
| `submit_video` | 提交文生视频（t2v）/ 图生视频（i2v）任务，返回 `task_id` |
| `query_video` | 轮询任务状态，完成后返回视频下载 URL |
| `download_video` | 下载视频到本地文件 |

## MiniMax H3 简介

MiniMax 于 2026-07 发布的通用多模态视频模型（海螺 3.0）：

- 输出 4–15 秒，最高 2K（2560×1440 / 24fps）
- 文生视频 / 图生视频（首尾帧）/ 多模态参考生视频
- 原生立体声音、超长提示词（~7000 字符）
- 强项：广告创意、动态海报、MV、UI/UX 动效、电商产品动画

## 配置（环境变量）

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `MINIMAX_API_KEY` | ✅ | — | MiniMax 开放平台 API Key |
| `MINIMAX_BASE_URL` | ❌ | `https://api.minimaxi.com` | 基础 URL，第三方聚合（EvoLink 等）改这里 |
| `MINIMAX_VIDEO_MODEL` | ❌ | `MiniMax-H3` | 视频模型 ID |

## 安装与运行

```sh
npm install
npm run build

# 设置 API Key 后启动（stdio）
export MINIMAX_API_KEY=sk-xxx
node dist/index.js
```

## 在 Claude Code 中注册

在 `.claude/settings.json` 或 `claude_desktop_config.json` 里加：

```json
{
  "mcpServers": {
    "minimax-video": {
      "command": "node",
      "args": ["<本仓库路径>/minimax-video-mcp/dist/index.js"],
      "env": {
        "MINIMAX_API_KEY": "sk-xxx"
      }
    }
  }
}
```

## 使用示例

注册后，对 Claude 说：

```
用 minimax-video 生成一个 6 秒的 2K 视频：无人机掠过晨雾森林的航拍镜头
```

它会依次调用 `submit_video` →（等待）→ `query_video` → `download_video`，最终把 mp4 下载到本地。

## 实现说明

- **异步任务**：MiniMax H3 是「提交 → 轮询 → 下载」三段式。`submit_video` 只负责提交，返回 `task_id`；`query_video` 轮询直到 `status=success/completed`；`download_video` 落盘（URL 有效期约 24h）。
- **端点**：官方 v2（`/v2/video_generation` + `/v2/query/video_generation/{task_id}`）。第三方聚合端点结构可能不同，通过 `MINIMAX_BASE_URL` 切换。
- **URL 解析兜底**：不同平台返回字段命名不一（`video_url`/`url`/`videos[0].url`…），客户端做了宽松提取 + 递归查找。

## License

MIT
