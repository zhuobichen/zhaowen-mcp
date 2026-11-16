# minimax-image-mcp

MiniMax `image-01` 文生图 MCP server。纯 HTTP，不依赖 GUI。

## 为什么有它

原来生图只有豆包桌面版那条路：要开窗口、点输入框、一次一张、15–35 秒，产物右下角还有**可见水印**。
MiniMax 这条路是纯 HTTP：能并发、能指定比例、能直接把 base64 落盘，且**无任何水印**。

## 工具

| 工具 | 作用 |
| --- | --- |
| `generate_image` | 文生图并保存到本地，返回绝对路径。`aspect_ratio` / `n`(1–4) / `prompt_optimizer` / `out_dir` / `name` 可调 |
| `generate_image_url` | 同上但只回 URL，不写盘 |
| `image_config` | 只读排障：配置文件路径、key 是否就位（不打印 key）、baseUrl、模型、默认比例、输出目录 |

## 配置

**key 不存在这个仓库里**。运行时从 `qchat-cli/private/minimax.config.json` 读（那份不进 git）：

```json
{
  "apiKey": "sk-api-...",
  "baseUrl": "https://api.minimaxi.com/v1",
  "baseUrlFallback": "https://api.minimax.chat/v1",
  "model": "image-01",
  "defaultAspect": "16:9",
  "outDir": "output/gen"
}
```

覆盖顺序：环境变量 > 配置文件 > 默认值

| 环境变量 | 说明 |
| --- | --- |
| `MINIMAX_IMAGE_CONFIG` | 配置文件路径 |
| `MINIMAX_API_KEY` | 直接给 key（覆盖文件） |
| `MINIMAX_BASE_URL` | 覆盖 baseUrl |
| `MINIMAX_IMAGE_MODEL` | 覆盖模型 |

> ⚠️ **只认国内站**：`api.minimaxi.com` / `api.minimax.chat`。国际站 `api.minimax.io` 对这把 key 会回
> `1004 login fail`——那把是 New API 中转的对话 key，两回事。

## 在 DSH 里注册

`dsh/home/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: minimax-image-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: minimax-image
        transport: stdio
        command: node
        args:
          - 'D:\github_project\ZhaoWen_GitHub维护\zhaowen-mcp\minimax-image-mcp\dist\index.js'
        failOnStartupError: false
```

改完要**重启 DSH**（MCP 在启动时拉起）。之后工具名是
`mcp__minimax-image__generate_image`。

## 构建

```bash
cd zhaowen-mcp/minimax-image-mcp
node node_modules/typescript/bin/tsc   # 或 npx tsc
node dist/index.js                     # stdio，等客户端连
```

依赖借用同级 `minimax-video-mcp/node_modules`（拷贝而来），换机器要 `npm install`。

## 两个踩过的坑

1. **HTTP 200 不等于成功**：必须看 `base_resp.status_code === 0`，否则报的是"成功"但其实没图。
2. **返回的 base64 其实是 JPEG**：按模型名写 `.png` 会让按 magic 判类型的下游工具拒读。
   本实现按文件头决定扩展名（jpg / png / webp）。

## 与豆包那条路的取舍

| | MiniMax（本 MCP） | 豆包（dsh-image-gen） |
| --- | --- | --- |
| 依赖 | 网络 + key | 豆包桌面版开着并登录，带 `--remote-debugging-port=9333` |
| 并发 | 可并发 | 一次一张 |
| 比例 | 8 种可选 | 固定方图 |
| 水印 | 无 | 右下角「豆包 AI 生成」 |
| 中文画面理解 | 好 | 更好（国内模型） |
