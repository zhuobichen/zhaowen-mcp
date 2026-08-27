/**
 * keys.js - 密钥管理(需求 2 核心)
 *
 * 设计:
 *   - keys/<server-id>_key / .pub
 *   - 用 server-id 命名,IP 变化不影响密钥复用
 *   - 复用优先:已存在则直接返回
 *   - 新生成:用 ssh2.utils.generateKeyPairSync(OpenSSH 格式,非 PKCS8)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./env');

function ssh2() {
  return require('./loader').loadSsh2();
}

/**
 * 确保密钥对存在(复用或新建)
 */
async function ensureKey(serverId) {
  const keyDir = env.getKeysDir();
  const privPath = path.join(keyDir, `${serverId}_key`);
  const pubPath = path.join(keyDir, `${serverId}_key.pub`);

  // 复用
  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    const pubContent = fs.readFileSync(pubPath, 'utf8').trim();
    return { priv: privPath, pub: pubPath, pubContent, reused: true };
  }

  // 生成
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  }

  const { utils } = ssh2();
  const result = utils.generateKeyPairSync('rsa', {
    bits: 4096,
    comment: `fm@${serverId}`,
  });

  fs.writeFileSync(privPath, result.private, { mode: 0o600 });
  fs.writeFileSync(pubPath, result.public, { mode: 0o644 });

  return { priv: privPath, pub: pubPath, pubContent: result.public.trim(), reused: false };
}

/**
 * 读取私钥
 */
function readPrivate(server) {
  if (!server.key) throw new Error('SERVER_HAS_NO_KEY');
  return fs.readFileSync(server.key, 'utf8');
}

/**
 * 注入公钥到服务器的 authorized_keys
 * 注:此函数只构造命令,实际执行由调用方(servers.js 的 bind 流程)
 */
function buildInjectCmd(remoteHome, pubLine, targetUser) {
  return [
    `sudo -u ${targetUser} mkdir -p ~/.ssh`,
    `sudo -u ${targetUser} chmod 700 ~/.ssh`,
    `echo '${pubLine}' | sudo tee -a /home/${targetUser}/.ssh/authorized_keys > /dev/null`,
    `sudo chmod 600 /home/${targetUser}/.ssh/authorized_keys`,
  ].join(' && ');
}

module.exports = { ensureKey, readPrivate, buildInjectCmd };