# DeepSeek Search MCP

把 DeepSeek 的**网页搜索（Search）**与**网页抓取（Fetch）**两个接口包成 MCP 工具，供 Claude Code / Codex 等 MCP 客户端调用。

官方文档：<https://api-docs.deepseek.com/zh-cn/guides/search/>

## 工具

| 工具 | 作用 |
|---|---|
| `deepseek_search` | 按 `query` 搜索网页，返回结构化结果（`rerank_score` / `authority` / `date` / `snippet` / `summary` / 可选正文） |
| `deepseek_fetch` | 抓单个网页，返回 **Markdown 正文** |
| `check_status` | 只读检查配置（Base URL、Key 来源、计费与限速要点）。**不发网络请求，不产生费用** |

### `deepseek_search` 参数

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `query` | 是 | — | 1–128 个 Unicode 字符，不能全为空白 |
| `count` | 否 | 10 | 1–50。⚠️ **不影响计费**，10 条与 50 条同价 |
| `need_content` | 否 | false | 是否返回网页正文 `content`（体积会大很多） |
| `ori_question` | 否 | — | 触发搜索的原始问题，帮助理解意图 |
| `localization` | 否 | — | 用于本地化排序的 IP 地址，一般不用填 |
| `raw` | 否 | false | 返回原始 JSON 而不是格式化文本 |

**搜索语法**（直接写进 `query`，可组合）：

| 操作符 | 示例 | 说明 |
|---|---|---|
| `site:` | `DeepSeek site:github.com` | 限定站点；多个用空格分隔并按 OR 连接：`site:github.com OR site:huggingface.co` |
| `-site:` | `-site:example.com` | 排除站点 |
| `-词` | `-广告` | 排除含该词的网页 |
| `-"短语"` | `-"release notes"` | 排除含该短语的网页 |
| `"短语"` | `"精确短语"` | 精确匹配 |
| `lang:` | `lang:zh,en` | 限定语言 |
| `after:` | `after:2025` / `after:2025-01-01` | 发布时间下限 |
| `before:` | `before:2026-06-01` | 发布时间上限 |

### 结果怎么看

| 字段 | 含义 |
|---|---|
| `rerank_score` | 0–3，综合相关性+权威性+时效性，**≥1.5 为优质** |
| `authority` | 0–4，**≥3 为极权威**，`-1` 为未知 |
| `snippet` | 100–200 字，给前端展示 |
| `summary` | **600–800 字**，适合直接喂给模型 |
| `content` | 网页正文，需 `need_content: true` |
| `date` | UTC RFC 3339，未知为 `null` |

## 配置

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 是¹ | DeepSeek API Key |
| `DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com` |
| `ANTHROPIC_AUTH_TOKEN` | 兜底¹ | 直连 `api.deepseek.com` 的 Claude Code 会话里只有这个，且它本来就是同一个 DeepSeek key，所以作为兜底读取 |

¹ 两个键**有一个**即可。

**Key 只放环境变量，不要写进仓库。**

## 计费与限速（官方）

- **5 元 / 1000 次成功请求**，Search 与 Fetch 分别计
- **只有 HTTP 200 且产生结果才计费**：无结果 / 失败 / 超时都不收费
- `count` 只控制返回条数，**不影响单次价格**
- **QPS 各 5，且是账号级**（与用哪个 API Key 无关，与模型并发限制相互独立）
- Fetch 另外**对目标域名单独限速**
- 429 退避重试；402 是余额不足，充值后再试；其他 4xx 不改请求就别重试

> ⚠️ 官方另有一句：在 Claude Code / Codex 里用 DeepSeek API 时，服务端工具调用**已经在走** Search/Fetch，这部分目前不计费，**自北京时间 2026-11-01 00:00 起按次收费**。

## 注册到 Claude Code

```json
{
  "mcpServers": {
    "deepseek-search": {
      "command": "npx",
      "args": ["tsx", "E:/CodeProject/mcp-server/deepseek-search/index.ts"],
      "env": { "DEEPSEEK_API_KEY": "<你的 key>" }
    }
  }
}
```

改完需**重启 Claude Code** 才会加载。

## 开发

```bash
npm install
npm run typecheck
npx tsx index.ts        # stdio 模式，由 MCP 客户端驱动
```
