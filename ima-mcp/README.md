# ima MCP Server

把腾讯 [ima](https://ima.qq.com) 的知识库和笔记接进 MCP，基于**官方 OpenAPI**，不走 Cookie、不逆向客户端。

接口规格来自官方 skill 包 `ima-skills-1.1.10`（`knowledge-base/references/api.md` + `notes/references/api.md`）。

## 凭证

到 [ima.qq.com/agent-interface](https://ima.qq.com/agent-interface) 申请 Client ID + API Key，然后任选一种方式配置：

```bash
# 1. 环境变量
export IMA_CLIENT_ID=xxx
export IMA_API_KEY=xxx

# 2. 本目录 .env（复制 .env.example）

# 3. 官方约定的文件位置
~/.config/ima/client_id
~/.config/ima/api_key
```

读取优先级：环境变量 → 本服务目录 `.env` → 仓库根 `.env` → `~/.config/ima/`。

## 启动

在本仓库根目录（依赖装在根 `node_modules`）：

```bash
npx tsx ima-mcp/index.ts
```

## 注册到 MCP 客户端

```json
{
  "mcpServers": {
    "ima": {
      "command": "npx",
      "args": ["tsx", "ima-mcp/index.ts"],
      "cwd": "<本仓库根目录>"
    }
  }
}
```

## 工具（17 个）

### 知识库 `/openapi/wiki/v1`

| 工具 | 底层接口 | 说明 |
| --- | --- | --- |
| `ima_search_knowledge_bases` | `search_knowledge_base` | 搜知识库列表 |
| `ima_list_addable_knowledge_bases` | `get_addable_knowledge_base_list` | 列出可写入的知识库 |
| `ima_get_knowledge_base` | `get_knowledge_base` | 知识库信息 + 推荐问题 |
| `ima_list_knowledge` | `get_knowledge_list` | 浏览文件夹（逐级下钻） |
| `ima_search_knowledge` | `search_knowledge` | 库内搜索，返回高亮片段 |
| `ima_check_repeated_names` | `check_repeated_names` | 上传前查重 |
| `ima_import_urls` | `import_urls` | 导入网页 / 公众号文章 |
| `ima_upload_file` | `create_media` + COS PUT + `add_knowledge` | 本地文件一步入库 |
| `ima_add_knowledge` | `add_knowledge` | 加入网页 / 笔记 / AI 会话 |
| `ima_get_media_info` | `get_media_info` | 取原文链接或笔记 ID |
| `ima_read_media` | `get_media_info` + 抓取 / `get_doc_content` | 直接读正文 |

### 笔记 `/openapi/note/v1`

| 工具 | 底层接口 |
| --- | --- |
| `ima_list_notebooks` | `list_notebook` |
| `ima_list_notes` | `list_note` |
| `ima_search_notes` | `search_note` |
| `ima_get_note_content` | `get_doc_content` |
| `ima_create_note` | `import_doc` |
| `ima_append_note` | `append_doc` |

## 关键约束

- **没有问答接口。** 官方 OpenAPI 只覆盖知识库/笔记的增删查改，**不提供 RAG 问答**。想让 AI「问 ima 问题」只能自己在 MCP 外面拼检索流程。
- 根目录的 `folder_id` 等于 `knowledge_base_id`；`import_urls` 的 `folder_id` 必填，不传时工具会自动用 `knowledge_base_id`兜底。
- 上传大小限制：Excel/TXT/Xmind/MD/HTML 10MB，图片 30MB，EPUB 50MB，PDF/Word/PPT/音频 200MB。超限在本地就拦掉，不发请求。
- 视频链接（B站/YouTube）不支持通过 API 入库，只能在 ima 桌面端手动添加。
- 频控错误码（110021/ 20002）和下游网络错误（110010 / 210003）自动重试 2 次。

## 类型检查

```bash
npx tsc -p ima-mcp/tsconfig.json
```

## License

MIT
