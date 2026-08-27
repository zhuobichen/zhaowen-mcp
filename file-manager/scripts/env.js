/**
 * env.js - 环境变量与路径解析
 *
 * 自动发现机制(优先级从高到低):
 *   1. 环境变量 FM_HOME / FM_CONFIG / FM_DEFAULT_SERVER
 *   2. 项目级配置 ./.file-manager.json
 *   3. 用户级配置 ~/.file-manager/config.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function getHomeDir() {
  return process.env.FM_HOME || path.join(os.homedir(), '.file-manager');
}

function getLibDir() {
  return path.join(getHomeDir(), 'lib');
}

function getNodeModulesDir() {
  return path.join(getLibDir(), 'node_modules');
}

function getKeysDir() {
  return path.join(getHomeDir(), 'keys');
}

function getSharesDir() {
  return path.join(getHomeDir(), 'shares');
}

function getAuditLog() {
  return path.join(getHomeDir(), 'audit.log');
}

function getServersFile() {
  return path.join(getHomeDir(), 'servers.json');
}

function getConfigFile() {
  if (process.env.FM_CONFIG) {
    return process.env.FM_CONFIG;
  }
  // 项目级覆盖
  const projectConfig = path.join(process.cwd(), '.file-manager.json');
  if (fs.existsSync(projectConfig)) {
    return projectConfig;
  }
  // 用户级
  const userConfig = path.join(getHomeDir(), 'config.json');
  if (fs.existsSync(userConfig)) {
    return userConfig;
  }
  return null;
}

function getDefaultServer(servers) {
  if (process.env.FM_DEFAULT_SERVER) {
    return process.env.FM_DEFAULT_SERVER;
  }
  if (servers && servers.default) {
    return servers.default;
  }
  // 唯一已绑定 server 时自动选中
  if (servers && servers.servers) {
    const ids = Object.keys(servers.servers);
    if (ids.length === 1) return ids[0];
  }
  return null;
}

module.exports = {
  getHomeDir,
  getLibDir,
  getNodeModulesDir,
  getKeysDir,
  getSharesDir,
  getAuditLog,
  getServersFile,
  getConfigFile,
  getDefaultServer,
};