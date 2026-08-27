/**
 * audit.js - 审计日志(只追加)
 *
 * JSONL 格式,每行一条 JSON
 * 只记录敏感/危险操作(参见 references/audit.md)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./env');

const SENSITIVE_ACTIONS = new Set([
  'bind', 'unbind',
  'share.add', 'share.revoke', 'share.sync',
  'rm.recursive', 'batch.delete',
  'chmod.recursive', 'chown',
  'exec.allowSudo', 'exec.allowEscape',
  'mv.overwrite',
]);

function write(entry) {
  // 过滤非敏感
  if (!SENSITIVE_ACTIONS.has(entry.action)) return;

  const logFile = env.getAuditLog();
  const dir = path.dirname(logFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const record = {
    ts: new Date().toISOString(),
    ...entry,
  };

  fs.appendFileSync(logFile, JSON.stringify(record) + '\n', { mode: 0o600 });
}

function read({ limit = 50, type } = {}) {
  const logFile = env.getAuditLog();
  if (!fs.existsSync(logFile)) return [];

  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').reverse();
  const filtered = type ? lines.filter(l => l.includes(`"action":"${type}"`)) : lines;
  return filtered.slice(0, limit).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function clear() {
  const logFile = env.getAuditLog();
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }
}

module.exports = { write, read, clear, SENSITIVE_ACTIONS };