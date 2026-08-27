#!/usr/bin/env node
/**
 * install.js - 持久化安装器
 *
 * 需求 1:一次安装,跨 session 永久调用
 * - 将 ssh2 安装到 ~/.file-manager/lib/node_modules/
 * - 不污染全局 npm,也不依赖工作目录
 * - 幂等:已安装则跳过
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = process.env.FM_HOME || path.join(os.homedir(), '.file-manager');
const LIB_DIR = path.join(HOME, 'lib');
const NODE_MODULES = path.join(LIB_DIR, 'node_modules');
const SSH2_DIR = path.join(NODE_MODULES, 'ssh2');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(level, msg) {
  const c = COLORS[level] || '';
  console.log(`${c}${msg}${COLORS.reset}`);
}

function ensureDir(dir, mode) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode });
    log('dim', `  创建目录: ${dir}`);
  }
}

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    log('red', `❌ Node.js 版本过低: ${process.versions.node},要求 ≥ 18`);
    process.exit(1);
  }
  log('green', `✓ Node.js ${process.versions.node}`);
}

function checkSsh2() {
  // 检查 4 个位置
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'ssh2'),
    SSH2_DIR,
  ];

  // 全局路径
  try {
    const globalModules = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout.trim();
    if (globalModules) candidates.push(path.join(globalModules, 'ssh2'));
  } catch (_) { /* npm 不可用时跳过 */ }

  // NODE_PATH
  if (process.env.NODE_PATH) {
    candidates.push(path.join(process.env.NODE_PATH, 'ssh2'));
  }

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        log('green', `✓ ssh2 ${pkg.version} @ ${dir}`);
        return { path: dir, version: pkg.version, installed: false };
      } catch (_) { /* 已是有效文件 */ }
    }
  }
  return null;
}

function installSsh2() {
  log('cyan', '\n→ 正在安装 ssh2 到 ' + NODE_MODULES);
  ensureDir(LIB_DIR);

  // 创建 lib/package.json(标记为隔离环境)
  if (!fs.existsSync(path.join(LIB_DIR, 'package.json'))) {
    fs.writeFileSync(
      path.join(LIB_DIR, 'package.json'),
      JSON.stringify({ name: 'file-manager-lib', version: '1.0.0', private: true }, null, 2)
    );
  }

  log('dim', '  执行: npm install ssh2 --silent --no-audit --no-fund');
  const result = spawnSync('npm', ['install', 'ssh2', '--silent', '--no-audit', '--no-fund'], {
    cwd: LIB_DIR,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    log('red', '❌ npm install 失败');
    process.exit(1);
  }
}

function writePlaceholder() {
  // 写入 README,提示用户不要删除此目录
  const readme = path.join(HOME, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        '# 文件管理 Skill 数据目录',
        '',
        '此目录由 file-manager Skill 管理,请勿手动删除或移动。',
        '',
        '## 子目录说明',
        '- lib/node_modules/ssh2/    ssh2 依赖(持久化安装)',
        '- keys/                      各 server 的 SSH 密钥对',
        '- shares/                    共享元数据',
        '- audit.log                  敏感操作日志',
        '- servers.json               已绑定服务器列表',
        '',
        '## 跨设备迁移',
        '将整个 .file-manager 目录打包即可在新设备恢复。',
        '',
      ].join('\n'),
      'utf8'
    );
    log('dim', `  写入说明: ${readme}`);
  }
}

function main() {
  console.log('\n📦 文件管理 Skill - 依赖安装器\n');
  console.log('凭证目录: ' + HOME);
  console.log('依赖目录: ' + NODE_MODULES + '\n');

  log('cyan', '[1/3] 检查 Node.js 版本');
  checkNode();

  log('cyan', '\n[2/3] 检查 ssh2 依赖');
  const existing = checkSsh2();
  if (existing) {
    log('green', '\n✅ 已安装,无需重复安装');
  } else {
    installSsh2();
    const after = checkSsh2();
    if (!after) {
      log('red', '❌ 安装后仍检测不到 ssh2');
      process.exit(1);
    }
    log('green', `\n✅ ssh2 ${after.version} 安装成功`);
  }

  log('cyan', '\n[3/3] 初始化数据目录');
  ensureDir(HOME, 0o700);
  ensureDir(LIB_DIR, 0o755);
  ensureDir(path.join(HOME, 'keys'), 0o700);
  ensureDir(path.join(HOME, 'shares'), 0o700);
  writePlaceholder();

  log('green', '\n✅ 初始化完成\n');
  log('dim', '后续使用:');
  log('dim', '  node scripts/ssh-ops.js doctor   # 环境诊断');
  log('dim', '  node scripts/ssh-ops.js init      # 初始化向导(绑定服务器)');
  log('dim', '');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    log('red', '❌ ' + e.message);
    process.exit(1);
  }
}

module.exports = { HOME, LIB_DIR, NODE_MODULES, SSH2_DIR };