/**
 * doctor.js - 环境自检(需求 v2.3 增强)
 *
 * 7 项检查:Node / ssh2 / 凭证目录 / servers / keys / ACL / 审计
 */

'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./env');
const loader = require('./loader');
const servers = require('./servers');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function status(ok, msg) {
  const icon = ok ? '✓' : '✗';
  const color = ok ? 'green' : 'red';
  return { ok, icon, msg, color, formatted: `${COLORS[color]}${icon}${COLORS.reset} ${msg}` };
}

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  const ok = major >= 18;
  return status(ok, `Node.js ${process.versions.node} (要求 ≥ 18)`);
}

function checkSsh2() {
  const info = loader.findSsh2();
  if (info) {
    return status(true, `ssh2 ${info.version} @ ${info.path}`);
  }
  return status(false, 'ssh2 未找到,运行 npm run install:lib');
}

function checkHomeDir() {
  const home = env.getHomeDir();
  if (!fs.existsSync(home)) {
    return status(false, `凭证目录不存在: ${home},运行 npm run install:lib`);
  }
  // 检查权限(类 Unix 系统)
  if (process.platform !== 'win32') {
    try {
      const stat = fs.statSync(home);
      const mode = (stat.mode & 0o777).toString(8);
      if (mode !== '700') {
        return status(false, `凭证目录权限 ${mode} 不安全,应为 700: ${home}`);
      }
    } catch (_) { /* ignore */ }
  }
  return status(true, `${home}`);
}

function checkServers() {
  try {
    const list = servers.list();
    if (list.length === 0) {
      return status(false, '无已绑定服务器,运行 npm run init');
    }
    const details = list.map(s =>
      `  - ${s.id}: ${s.host}:${s.port} (${s.username})`
    ).join('\n');
    return { ok: true, icon: '✓', msg: `已绑定 ${list.length} 个服务器\n${details}`, formatted: `${COLORS.green}✓${COLORS.reset} 已绑定 ${list.length} 个服务器\n${details}` };
  } catch (e) {
    return status(false, e.message);
  }
}

function checkKeys() {
  const keysDir = env.getKeysDir();
  if (!fs.existsSync(keysDir)) {
    return status(true, `keys 目录尚未创建(首次绑定时会创建)`);
  }
  const files = fs.readdirSync(keysDir).filter(f => f.endsWith('_key'));
  if (files.length === 0) {
    return status(false, 'keys 目录为空');
  }
  const details = files.map(f => {
    const pubPath = path.join(keysDir, f + '.pub');
    const hasPub = fs.existsSync(pubPath);
    return `  - ${f}${hasPub ? '' : ' (缺公钥!)'}`;
  }).join('\n');
  return { ok: true, icon: '✓', msg: `${files.length} 个密钥对\n${details}`, formatted: `${COLORS.green}✓${COLORS.reset} ${files.length} 个密钥对\n${details}` };
}

function checkAuditLog() {
  const log = env.getAuditLog();
  if (!fs.existsSync(log)) {
    return status(true, 'audit.log 尚未生成(无敏感操作记录)');
  }
  const stat = fs.statSync(log);
  return status(true, `${log} (${stat.size} bytes)`);
}

async function checkAcl(serverId) {
  const list = servers.list();
  const targets = serverId
    ? list.filter(s => s.id === serverId)
    : list;

  if (targets.length === 0) {
    return status(true, '未指定服务器,跳过 ACL 检查');
  }

  const results = [];
  for (const s of targets) {
    try {
      const share = require('./share');
      const servers = require('./servers');
      const fullServer = servers.get(s.id);
      const acl = await share.checkAcl({ id: s.id, ...fullServer });
      results.push(`${s.id}: ${acl.ready ? '✓ ' + acl.version : '✗ 未安装'}`);
    } catch (e) {
      results.push(`${s.id}: ✗ ${e.message}`);
    }
  }
  return { ok: true, icon: '✓', msg: results.join('\n  '), formatted: `${COLORS.green}✓${COLORS.reset}\n  ${results.join('\n  ')}` };
}

async function run({ server, json } = {}) {
  const checks = [
    checkNode(),
    checkSsh2(),
    checkHomeDir(),
    checkServers(),
    checkKeys(),
  ];

  if (json) {
    return {
      ok: checks.every(c => c.ok),
      checks,
    };
  }

  console.log('\n🔍 文件管理 Skill 环境诊断');
  console.log('========================================\n');

  console.log('[1/7] Node.js 版本');
  console.log('  ' + checks[0].formatted);

  console.log('\n[2/7] ssh2 依赖');
  console.log('  ' + checks[1].formatted);

  console.log('\n[3/7] 凭证目录');
  console.log('  ' + checks[2].formatted);

  console.log('\n[4/7] 服务器绑定');
  console.log('  ' + checks[3].formatted);

  console.log('\n[5/7] 密钥状态');
  console.log('  ' + checks[4].formatted);

  console.log('\n[6/7] ACL 工具');
  const aclCheck = await checkAcl(server);
  console.log('  ' + aclCheck.formatted);

  console.log('\n[7/7] 审计日志');
  const auditCheck = checkAuditLog();
  console.log('  ' + auditCheck.formatted);

  const passed = checks.filter(c => c.ok).length;
  console.log('\n========================================');
  console.log(`${passed}/5 基础检查通过${passed === 5 ? ' ✓' : ''}`);
  console.log();
}

module.exports = { run };