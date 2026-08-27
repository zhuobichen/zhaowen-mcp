# 凭证与密钥管理

## 目录结构

```
~/.file-manager/
├── lib/
│   └── node_modules/ssh2/    # 持久化依赖
├── keys/
│   ├── prod_key               # 私钥(0600)
│   ├── prod_key.pub           # 公钥(0644)
│   ├── staging_key
│   └── staging_key.pub
├── servers.json               # 服务器配置
├── shares/                    # 共享元数据
└── audit.log                  # 审计日志
```

## 命名约定

| 类型 | 命名 | 例子 |
|------|------|------|
| 私钥 | `keys/<server-id>_key` | `keys/prod_key` |
| 公钥 | `keys/<server-id>_key.pub` | `keys/prod_key.pub` |
| 共享元数据 | `shares/<server-id>.json` | `shares/prod.json` |
| 服务器配置 | `servers.json`(统一) | - |

> **为何用 server-id 而非 host?**
> 服务器 IP 变化时,密钥仍可复用,无需重新绑定。

## 密钥生成

使用 `ssh2.utils.generateKeyPairSync` 生成 OpenSSH 格式 RSA 4096:

```javascript
const { utils } = require('ssh2');
const { private, public } = utils.generateKeyPairSync('rsa', {
  bits: 4096,
  comment: 'fm@<server-id>',
});
```

⚠️ **不要**使用 Node.js `crypto.generateKeyPair`,会生成 PKCS8 格式,ssh2 无法解析。

## 复用逻辑

```javascript
async function ensureKey(serverId) {
  const priv = `keys/${serverId}_key`;
  const pub  = `keys/${serverId}_key.pub`;

  if (fs.existsSync(priv) && fs.existsSync(pub)) {
    return { priv, pub, reused: true };  // 复用
  }

  // 生成新密钥
  const result = utils.generateKeyPairSync(...);
  fs.writeFileSync(priv, result.private, { mode: 0o600 });
  fs.writeFileSync(pub, result.public, { mode: 0o644 });
  return { priv, pub, reused: false };
}
```

## 权限

- 凭证目录:`~/.file-manager/`:0700
- keys 目录:0700
- 私钥文件:0600
- 公钥文件:0644

## 跨设备迁移

```bash
# 打包
tar czf file-manager-backup.tar.gz ~/.file-manager/

# 恢复
tar xzf file-manager-backup.tar.gz -C ~/

# 验证
node scripts/ssh-ops.js doctor
```

## 凭证清除

```bash
# 删除整个凭证目录(危险,所有 server 都需要重新绑定)
rm -rf ~/.file-manager/

# 仅清除某个 server
node scripts/ssh-ops.js unbind --server prod
# 同时手动删除 keys/prod_key*
```

## 安全建议

1. **生产环境加密私钥**:Phase 1 暂未实现,可考虑用 ssh-agent 或加密存储
2. **定期轮换密钥**:`keys/` 目录可定期清理旧密钥
3. **备份加密**:备份 `~/.file-manager/` 时使用加密压缩
4. **多设备隔离**:不同设备用不同 server-id 命名,如 `prod-laptop` / `prod-desktop`