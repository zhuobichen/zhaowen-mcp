/**
 * ssh.js - SSH 连接管理
 *
 * 封装 ssh2.Client,提供:
 *   - connect(server):建立连接
 *   - exec(cmd):执行命令,返回 { stdout, stderr, code }
 *   - sftp():获取 sftp 句柄
 *   - upload(local, remote):SFTP 上传
 *   - download(remote, local):SFTP 下载
 */

'use strict';

const fs = require('fs');
// const path = require('path'); // (当前未使用,预留)
const loader = require('./loader');

function ssh2() {
  return loader.loadSsh2();
}

/**
 * 建立 SSH 连接(server 配置由 servers.js 提供)
 */
async function connect(server) {
  const { Client } = ssh2();

  const opts = {
    host: server.host,
    port: server.port || 22,
    username: server.username,
    readyTimeout: 10000,
  };

  // 私钥登录
  if (server.key && fs.existsSync(server.key)) {
    opts.privateKey = fs.readFileSync(server.key, 'utf8');
  } else if (server.password) {
    opts.password = server.password;
  } else {
    throw new Error('NO_AUTH: 服务器配置缺少 key 或 password');
  }

  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', e => {
      const err = new Error('SSH_FAIL: ' + e.message);
      err.code = 'SSH_FAIL';
      reject(err);
    });
    c.connect(opts);
  });
}

/**
 * 执行命令并返回结果
 */
async function exec(server, cmd) {
  const c = await connect(server);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    c.exec(cmd, (err, stream) => {
      if (err) {
        c.end();
        reject(err);
        return;
      }
      stream.on('data', d => (stdout += d.toString()));
      stream.stderr.on('data', d => (stderr += d.toString()));
      stream.on('close', code => {
        c.end();
        resolve({ stdout, stderr, code });
      });
    });
  });
}

/**
 * SFTP 上传文件(带进度)
 */
async function upload(server, localPath, remotePath, onProgress) {
  const c = await connect(server);
  return new Promise((resolve, reject) => {
    c.sftp((err, sftp) => {
      if (err) {
        c.end();
        reject(err);
        return;
      }
      const rs = fs.createReadStream(localPath);
      const ws = sftp.createWriteStream(remotePath);
      let uploaded = 0;
      rs.on('data', chunk => {
        uploaded += chunk.length;
        if (onProgress) onProgress(uploaded);
      });
      rs.pipe(ws);
      ws.on('close', () => {
        sftp.end();
        c.end();
        resolve({ uploaded });
      });
      ws.on('error', e => {
        sftp.end();
        c.end();
        reject(e);
      });
    });
  });
}

/**
 * SFTP 下载文件(带进度)
 */
async function download(server, remotePath, localPath, onProgress) {
  const c = await connect(server);
  return new Promise((resolve, reject) => {
    c.sftp((err, sftp) => {
      if (err) {
        c.end();
        reject(err);
        return;
      }
      const ws = fs.createWriteStream(localPath);
      const rs = sftp.createReadStream(remotePath);
      let downloaded = 0;
      rs.on('data', chunk => {
        downloaded += chunk.length;
        if (onProgress) onProgress(downloaded);
      });
      rs.pipe(ws);
      ws.on('close', () => {
        sftp.end();
        c.end();
        resolve({ downloaded });
      });
      ws.on('error', e => {
        sftp.end();
        c.end();
        reject(e);
      });
    });
  });
}

module.exports = { connect, exec, upload, download };