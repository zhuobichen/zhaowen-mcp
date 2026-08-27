/**
 * loader.js - ssh2 加载器
 *
 * 需求 1:本地优先,自动 fallback 到 ~/.file-manager/lib/
 * 加载顺序:
 *   1. 当前工作目录 node_modules/ssh2
 *   2. NODE_PATH 指定的路径
 *   3. 全局 node_modules(由 npm root -g 获取)
 *   4. ~/.file-manager/lib/node_modules/ssh2(持久化安装)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const env = require('./env');

function getSsh2Info(dir) {
  const pkgFile = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgFile)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    if (pkg.name === 'ssh2') {
      return { path: dir, version: pkg.version };
    }
  } catch (_) { /* 解析失败时跳过 */ }
  return null;
}

/**
 * 按优先级查找 ssh2,不抛异常
 */
function findSsh2() {
  const candidates = [];

  // 1. 当前工作目录
  candidates.push(path.join(process.cwd(), 'node_modules', 'ssh2'));

  // 2. NODE_PATH
  if (process.env.NODE_PATH) {
    process.env.NODE_PATH.split(path.delimiter).forEach(p => {
      if (p) candidates.push(path.join(p, 'ssh2'));
    });
  }

  // 3. 全局路径
  try {
    const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' });
    if (result.stdout) {
      candidates.push(path.join(result.stdout.trim(), 'ssh2'));
    }
  } catch (_) { /* npm 不可用时跳过 */ }

  // 4. FM_LIB(持久化)
  candidates.push(path.join(env.getNodeModulesDir(), 'ssh2'));

  for (const dir of candidates) {
    const info = getSsh2Info(dir);
    if (info) return info;
  }
  return null;
}

/**
 * 加载 ssh2,失败抛出 NEED_INSTALL
 */
function loadSsh2() {
  const info = findSsh2();
  if (!info) {
    const err = new Error('NEED_INSTALL');
    err.code = 'NEED_INSTALL';
    throw err;
  }
  return require(info.path);
}

/**
 * 探测 ssh2,不抛异常
 */
function tryLoadSsh2() {
  try {
    return loadSsh2();
  } catch {
    return null;
  }
}

module.exports = {
  findSsh2,
  loadSsh2,
  tryLoadSsh2,
};