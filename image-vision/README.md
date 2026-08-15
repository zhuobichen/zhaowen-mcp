# image-vision MCP

识图 + 生图 MCP 服务（`describe_image` / `generate_image` / `check_vision_status`）。

## 功能

| 工具 | 作用 |
|------|------|
| `describe_image` | 识别图片内容（视觉模型），支持 PNG/JPEG/GIF/WebP/BMP/TIFF |
| `generate_image` | 生成图片并保存到本地（gpt-image 等生图模型） |
| `check_vision_status` | 检查 API 配置状态 |

另有 `hook.mjs`：PreToolUse hook，拦截 `Read` 工具对图片文件的调用，自动调用视觉模型识图并重定向到文本描述。

## 配置（环境变量）

| 变量 | 必填 | 说明 |
|------|------|------|
| `VISION_API_KEY` | ✅ | 识图 API Key |
| `VISION_API_URL` | ❌ | 识图端点（默认 Anthropic） |
| `VISION_MODEL` | ❌ | 识图模型 |
| `IMAGE_API_KEY` | ✅ | 生图 API Key（fallback `VISION_API_KEY`） |
| `IMAGE_BASE_URL` | ✅ | 生图端点（fallback `VISION_API_URL`） |
| `IMAGE_MODEL` | ❌ | 生图模型（默认 `gpt-image-2-ca`） |

> 本目录代码**不包含任何 API Key**，使用前请自行配置。

## 安装运行

```sh
cd image-vision
npm install
npx tsx index.ts          # 直接运行
```

注册到 Claude Code 的配置模板见 `image-vision-mcp-config.example.json`。
