# ZhaoWen 自用的 MCP 服务集合

个人自用的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务集合，供 Claude Code 等 MCP 客户端调用。

## 包含的服务

| 目录 | 服务 | 功能 |
|------|------|------|
| [`image-vision/`](./image-vision) | 识图 + 生图 | `describe_image` 识图 · `generate_image` 生图 · `check_vision_status` |
| [`minimax-video-mcp/`](./minimax-video-mcp) | 生视频 | `submit_video` 提交 · `query_video` 查询 · `download_video` 下载 |
| [`skill-manager/`](./skill-manager) | skill 盘点 + 一键发布 GitHub | `list_skills` 盘点 · `check_sensitive` 敏感检测 · `publish_skill` 发布 · `get_config` |

## 隐私说明

- 本仓库**不包含任何 API Key、密钥或个人中转站地址**。
- 所有服务均通过**环境变量**配置，使用前请自行填写各自的 API 凭据。
- 各服务的配置方式见各自目录下的 `README.md`。

## 快速开始

每个服务相互独立，进入对应目录安装依赖并配置环境变量后即可运行：

```sh
# 识图 + 生图
cd image-vision && npm install

# 生视频（MiniMax H3）
cd minimax-video-mcp && npm install && npm run build

# skill 盘点 + 一键发布 GitHub
cd skill-manager && npm install
```

## License

MIT
