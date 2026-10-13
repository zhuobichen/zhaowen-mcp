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

### `edit_image` 的三个实测坑

1. **多图的字段名各家不一致**：本机这份中转要 `image[]`，有的实现只认 `image`。
   所以第一次失败会**自动换写法重试一次**，而不是把 400 直接甩给调用方。
2. **中转按 `User-Agent` 拦**：不带 UA 的脚本请求会拿到 **403** —— 那不是权限问题，
   是 UA 被挡。所以代码里显式带一个 UA，别把它当无关紧要的 header 删掉。
3. **中转不回报模型名**：实测响应里**没有 `model` 字段**（有 `usage`）。
   也就是说「出图到底用的是哪个模型」在这个通道上**无法证实也无法证伪** ——
   请求参数写了 `gpt-image-2.5`，不等于跑的就是它。

### 为什么每次生成都落一份 `<图>.meta.json`

因为上面第 3 条：**光看请求参数证明不了什么**，而生成物本身也不带模型元数据
（实测这些 PNG 里只有一个 `dpi` 标签），事后从图片上反查不出来。
所以回执和 sidecar 里把两件事**分开写**：

```
requestedModel : "gpt-image-2.5"   ← 我们请求的
reportedModel  : null              ← 服务端回报的；没回报就是 null，不拿请求值冒充
usage          : { input_tokens, output_tokens, image_tokens, ... }
field          : "image[]"         ← 哪个 multipart 字段名生效了
```

工具回执里也会写明「服务端有没有回报模型」；没回报时**明说查不到**，不装作知道。

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

本服务**没装 devDependency**，所以类型检查要临时装两个包（`--no-save`，不动 `package.json`）：

```sh
npm i --no-save typescript @types/node
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck \
  --esModuleInterop --moduleResolution bundler --module esnext --target es2022 \
  --types node index.ts vision.ts
```

两个实测坑：

- 直接 `-p tsconfig.json` 会因为仓库的 tsconfig 没有 `types` 字段而**认不出 `fs` / `process` / `Buffer`**，
  报一整屏 `TS2591`（"Do you need to install type definitions for node?"）——
  **那不是你的代码错**，是类型定义没被加载。要么像上面那样显式 `--types node`，要么去改 tsconfig。
- **连着跑两次 `npm i --no-save` 会把上一个包 prune 掉**（第二次装完之后 `tsc` 就找不到了），
  要装就一起装。

更值得做的是**用真实工具调一遍**：起本服务走 stdio 握手，`tools/list` 看清单，
再真调一次 `edit_image`（给一张图 + 一句指令，确认回来的文件能打开、回执里有模型与用量行）。
只做 `tsc` 看不出字段名、UA、超时这些真问题——这次就是靠真调才发现**中转根本不回报模型名**。

## 部署到另一台机器

1. 把整个 `image-vision/` 目录放到目标机器的任意位置（`node_modules/` 里已带 `tsx`，**不用联网装**）；
   目标机器只要有 **Node.js 18+**（`edit_image` 用的 `FormData`/`Blob` 依赖它）。
2. 在目标机器 `~/.claude.json` 顶层的 `mcpServers` 里加一项，模板见
   `image-vision-mcp-config.example.json`，把 `args` 里的两处路径与 `cwd` 改成实际路径。
3. 重启 Claude Code —— 工具清单在**连接那一刻**定下，旧会话里还是旧清单。

> ⚠️ `VISION_API_KEY` / `IMAGE_API_KEY` 是敏感凭据：**不要**写进本文件、示例配置或任何提交。
> 示例文件里只有占位符。

## 本服务**不再**在 `~/.claude/mcp-servers/` 下维护

它曾经有两份：`~/.claude/mcp-servers/image-vision/`（实际注册在跑的那份）和本仓库这份。
结果是**两份可运行代码各自演化、静默漂移** —— 跑的那份攒了 4 处改动（`VISION_DESCRIBE_ENABLED`
开关、生图说明读运行时模型、`IMAGE_BASE_URL` 默认值、状态输出）一个都没回仓库。

2026-10-13 已合并回本仓库，并删掉 `~/.claude/mcp-servers/` 那份；注册指向本仓库。
**以后只在本仓库改。**

