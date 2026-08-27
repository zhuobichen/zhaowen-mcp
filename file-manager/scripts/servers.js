/**
 * servers.js - 服务器配置管理
 *
 * 持久化到 ~/.file-manager/servers.json
 * 支持多 server,server-id 作为主键
 */

'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./env');

function load() {
  const file = env.getServersFile();
  if (!fs.existsSync(file)) {
    return { default: null, servers: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error('SERVERS_FILE_CORRUPT: ' + file);
  }
}

function save(data) {
  const file = env.getServersFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function get(serverId) {
  const data = load();
  return data.servers[serverId] || null;
}

function getOrThrow(serverId) {
  const s = get(serverId);
  if (!s) {
    const err = new Error(`SERVER_NOT_FOUND: ${serverId}`);
    err.code = 'SERVER_NOT_FOUND';
    throw err;
  }
  return s;
}

function upsert(serverId, info) {
  const data = load();
  data.servers[serverId] = {
    ...data.servers[serverId],
    ...info,
    updated_at: new Date().toISOString(),
  };
  save(data);
}

function remove(serverId) {
  const data = load();
  delete data.servers[serverId];
  if (data.default === serverId) {
    const remaining = Object.keys(data.servers);
    data.default = remaining.length === 1 ? remaining[0] : null;
  }
  save(data);
}

function setDefault(serverId) {
  const data = load();
  if (!data.servers[serverId]) {
    throw new Error('SERVER_NOT_FOUND');
  }
  data.default = serverId;
  save(data);
}

function list() {
  const data = load();
  return Object.entries(data.servers).map(([id, s]) => ({
    id,
    host: s.host,
    port: s.port || 22,
    username: s.username,
    home: s.home,
    bound_at: s.bound_at,
    acl_ready: s.acl_ready !== false,
  }));
}

function resolveServer(serverId) {
  if (serverId) return getOrThrow(serverId);
  const data = load();
  const def = env.getDefaultServer(data);
  if (!def) {
    const err = new Error('NO_DEFAULT_SERVER: 请用 --server 指定');
    err.code = 'NO_DEFAULT_SERVER';
    throw err;
  }
  return getOrThrow(def);
}

module.exports = {
  load, save, get, getOrThrow, upsert, remove,
  setDefault, list, resolveServer,
};