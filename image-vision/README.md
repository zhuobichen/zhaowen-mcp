# image-vision MCP

识图 + 生图 + **改图** MCP 服务（`describe_image` / `generate_image` / `edit_image` / `check_vision_status`）。

## 功能

| 工具 | 作用 |
|------|------|
| `describe_image` | 识别图片内容（视觉模型），支持 PNG/JPEG/GIF/WebP/BMP/TIFF。**默认不注册**，见下 |
| `generate_image` | **从零**生成图片并保存到本地（gpt-image 等生图模型）。只吃文字提示词 |
| `edit_image` | **在已有图片上编辑（图生图）**：传 1~4 张本地图片 + 指令，返回结果路径 |
| `check_vision_status` | 检查 API 配置状态 |

另有 `hook.mjs`：PreToolUse hook，拦截 `Read` 工具对图片文件的调用，自动调用视觉模型识图并重定向到文本描述。

### `generate_image` 与 `edit_image` 的分工

这两件事**不能混**，早先没有 `edit_image` 时确实被当成一个用过：

- `generate_image` 打的是 `POST {base}/images/generations`，body 里只有
  `model / prompt / size / n` —— **没有任何图片入参**。它做不到"改这张图"，
  哪怕模型本身有编辑能力。
- `edit_image` 打的是 `POST {base}/images/edits`，`multipart/form-data` 上传图片。
  「把这行字改掉」「换个背景」「拿这两张合成一张」走这条。

### `edit_image` 的两个实测坑

1. **多图的字段名各家不一致**：本机这份中转要 `image[]`，有的实现只认 `image`。
   所以第一次失败会**自动换写法重试一次**，而不是把 400 直接甩给调用方。
2. **中转按 `User-Agent` 拦**：不带 UA 的脚本请求会拿到 **403** —— 那不是权限问题，
   是 UA 被挡。所以代码里显式带一个 UA，别把它当无关紧要的 header 删掉。

### 识图为什么默认关

`describe_image` 是给"后端看不见图"的时代准备的（DeepSeek 之类的纯文本模型）。
现在主模型自己就能读图（`Read` 工具直接把图片当输入），这个工具就重复了：
多一次出境、多一份钱、还多一个可能读错的中转描述。

但它**不是没用了** —— 换个纯文本后端时它仍然是对的答案。所以是"默认不注册、
要就显式打开"（`VISION_DESCRIBE_ENABLED=true`），不是删掉。

与生图**没有任何关系**：两者共用一份端点配置，但一个读一个写，生命周期不该绑在一起
—— 所以这个开关只管识图那一个工具。

## 配置（环境变量）

| 变量 | 必填 | 说明 |
|------|------|------|
| `IMAGE_API_KEY` | ✅ | 生图/改图 API Key（fallback `VISION_API_KEY` / `ANTHROPIC_AUTH_TOKEN`） |
| `IMAGE_BASE_URL` | ❌ | 生图/改图端点（fallback `VISION_API_URL`，再 fallback 内置默认） |
| `IMAGE_MODEL` | ❌ | 生图/改图模型（默认 `gpt-image-2-ca`；实际用哪个看这里） |
| `VISION_API_KEY` | 识图才要 | 识图 API Key |
| `VISION_API_URL` | ❌ | 识图端点（默认 Anthropic） |
| `VISION_MODEL` | ❌ | 识图模型 |
| `VISION_DESCRIBE_ENABLED` | ❌ | 设 `true` 才注册 `describe_image`（**默认关**） |

> 本目录代码**不包含任何 API Key**，使用前请自行配置。

`generate_image` / `edit_image` 的工具说明里显示的模型名是**运行时读 `IMAGE_MODEL`** 得来的，
不是写死的字符串 —— 免得说明与实际跑的模型不一致。

## 安装运行

```sh
cd image-vision
npm install
npx tsx index.ts          # 直接运行
```

注册到 Claude Code 的配置模板见 `image-vision-mcp-config.example.json`。

## 开发自检

类型检查需要 typescript（本服务没装 devDependency，装了才跑）：

```sh
npm i -D typescript && npx tsc --noEmit -p tsconfig.json
```

更值得做的是**用真实工具调一遍**：起本服务走 stdio 握手，`tools/list` 看清单，
再真调一次 `edit_image`（给一张图 + 一句指令，确认回来的文件能打开）。
只做 `tsc` 看不出字段名、UA、超时这些真问题。
