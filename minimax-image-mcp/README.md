# minimax-image-mcp

MiniMax 生图 MCP server。**文生图 + 图生图**，纯 HTTP，不依赖 GUI。

## 为什么有它

原来生图只有豆包桌面版那条路：要开窗口、点输入框、一次一张、15–35 秒，产物右下角还有**可见水印**。
MiniMax 这条路是纯 HTTP：能并发、能指定比例、能直接把 base64 落盘，且**无任何水印**。

## 工具

| 工具 | 作用 |
| --- | --- |
| `generate_image` | 文生图 / 图生图并保存到本地，返回绝对路径。`images`(1–16) / `aspect_ratio` / `width`·`height` / `n`(1–4) / `prompt_optimizer` / `out_dir` / `name` 可调 |
| `generate_image_url` | 同上但只回 URL，不写盘（接口只给 base64 时会落盘并说明） |
| `image_config` | 只读排障：配置文件路径、key 是否就位（不打印 key）、baseUrl、模型、默认比例、输出目录 |

## 图生图怎么用

```jsonc
// 1 张参考图 → 默认走新模型 MiniMax-H3-Image
{ "prompt": "把她画成水彩绘本风", "images": ["D:/assets/yachiyo.png"] }

// 多张参考图（最多 16 张）
{ "prompt": "按图1的人物、图2的配色重画", "images": ["a.png", "b.png"] }

// 老模型：只做单图主体参考
{ "prompt": "…", "image": "a.png", "model": "image-01" }
```

参考图三种写法都收：本地绝对路径、`http(s)://` URL、`data:image/...;base64,...`。

按有没有参考图自动选路：

| 情况 | 模型 | 端点 | 参考图上限 |
| --- | --- | --- | --- |
| 无参考图 | `image-01`（默认） | `/image_generation` | — |
| 无参考图 + 显式 `MiniMax-H3-Image` | 新模型 | `/images/generations` | — |
| 有参考图（默认） | `MiniMax-H3-Image` | `/images/edits` | **16 张** |
| 有参考图 + 显式 `model: image-01` | `image-01` | `/image_generation` + `subject_reference` | **1 张** |

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

## 踩过的坑（都是"不报错但结果错"的那一类）

1. **给 `image-01` 传 `image: [a, b]` 会被静默吞掉**。这个字段官方契约里不存在，接口吞掉未知字段
   照常返回 200，图看着"像"，其实参考图一张没进。**参数错了不会报错，只会静静失效**——
   所以图生图做完必须**看一眼图**，确认参考的特征真的进去了。
2. **`image-01` 的 `subject_reference` 只收一张**（多张报 `image_reference must be one`）。
   要传多张必须换 `MiniMax-H3-Image` 的 `/images/edits`。
3. **`response_format` 两套接口名字不同**：老 `/image_generation` 用 `base64` / `url`；
   新 `/images/*` 只认 `url` / `b64_json`。传错报
   `invalid params, response_format must be url or b64_json (2013)`。
4. **HTTP 200 不等于成功**：必须看 `base_resp.status_code === 0`。
5. **返回的 base64 其实是 JPEG**：按模型名写 `.png` 会让按 magic 判类型的下游工具拒读。
   本实现按文件头决定扩展名（jpg / png / webp）。
6. **返回形状有三种**，都要认：
   - `{ data: { image_base64: [...] } }`（老接口 base64）
   - `{ data: { image_urls: [...] } }`（老接口 url）
   - `{ data: [ { url } ] }` 或 `{ data: [ { b64_json } ] }`（新接口）
7. **错误对象不一定有 `.message`**：早期把 `throw err` 直接抛出，客户端只看到 `[object Object]`，
   完全没法排查。现在统一走 `errText()` 兜底序列化。

## 实测规格

`MiniMax-H3-Image` 的 `/images/edits`，1 张参考图、16:9 请求，实测返回 **5472×3072 JPEG**，
耗时约 16 秒。

## 与豆包那条路的取舍

| | MiniMax（本 MCP） | 豆包（dsh-image-gen） |
| --- | --- | --- |
| 依赖 | 网络 + key | 豆包桌面版开着并登录，带 `--remote-debugging-port=9333` |
| 并发 | 可并发 | 一次一张 |
| 比例 | 8 种可选 | 固定方图 |
| 图生图 | 支持，1–16 张 | 支持，1–4 张（`edit_image`） |
| 水印 | 无 | 右下角「豆包 AI 生成」 |
| 中文画面理解 | 好 | 更好（国内模型） |
