# code-review MCP

代码审阅 MCP：调用 LLM 对本地代码文件 / git diff 做按严重程度分级的审阅。

## 工具

| 工具 | 功能 |
|------|------|
| `review_file(file_path, focus?)` | 审阅本地代码文件（≤200KB），返回按严重程度分级的审阅结果 |
| `review_diff(code, focus?)` | 审阅代码片段 / git diff 文本 |
| `check_review_status()` | 检查配置状态 |

## 配置（环境变量）

| 变量 | 说明 |
|------|------|
| `REVIEW_API_KEY` | 审阅模型 API Key（必填，可 fallback 到 `VISION_API_KEY`） |
| `REVIEW_API_URL` | OpenAI 兼容 API 地址（如 `https://one-hub.hycx-gd.cn/v1`） |
| `REVIEW_MODEL` | 审阅模型（如 `glm-5.2`） |

> 凭据一律通过环境变量注入，仓库不含任何真实 Key。

## 注册示例（`~/.claude.json` 顶层 `mcpServers`）

```json
"code-review": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node", "E:/CodeProject/node_modules/tsx/dist/cli.mjs", "E:/CodeProject/mcp-server/code-review/index.ts"],
  "cwd": "E:\\CodeProject",
  "env": {
    "REVIEW_API_KEY": "<你的Key>",
    "REVIEW_API_URL": "https://one-hub.hycx-gd.cn/v1",
    "REVIEW_MODEL": "glm-5.2"
  }
}
```

## License

MIT
