#!/usr/bin/env node
/**
 * ssh-ops.js - 文件管理 Skill 主入口
 */

'use strict';

const fs = require('fs');
const path = require('path');
// const env = require('./env'); // (保留供未来使用)
const loader = require('./loader');
const safety = require('./safety');
const ssh = require('./ssh');
const keys = require('./keys');
const servers = require('./servers');
const share = require('./share');
const audit = require('./audit');
const errors = require('./errors');
const doctor = require('./doctor');
const wizard = require('./wizard');

const COLORS = {
  reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', cyan: '\x1b[36m', dim: '\x1b[2m',
};

function log(color, msg) {
  console.log(`${COLORS[color] || ''}${msg}${COLORS.reset}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function usage() {
  console.log(`
文件管理 Skill v2.5

基础命令:
  install                    持久化安装 ssh2 到 ~/.file-manager/lib/
  doctor [--server ID]       环境诊断
  init                       交互式向导(无参数)/ 批量配置(--config)

服务器绑定:
  bind   --server ID --host H --user U --password P
  unbind --server ID
  servers list

通用 SSH:
  exec   --server ID --cmd "ls -lah ~/projects" [--allow-sudo] [--allow-escape] [--sandbox]

CRUD:
  mkdir / write / upload / download / rm / mv / chmod / chown

批量:
  find / grep / batch / stat

共享(v2.5 三层独立授权):
  share add --path ~/test --to lisi
    默认:容器 list(r-x),子项无,future无
  share add --path ~/test --to lisi --level read
  share add --path ~/test --to lisi --level readwrite
  share add --path ~/test --to lisi --level full        # 需确认 SHARE_FULL
  share add --path ~/test --to lisi --container list|traverse|full|none
  share add --path ~/test --to lisi --file-perm read --grant-all
  share add --path ~/test --to lisi --file-perm read --pattern '*.log'
  share add --path ~/test --to lisi --default-perm readwrite
  share add --no-traverse ...

  share grant         --path ~/test/a.txt --to lisi --perm read
  share grant         --path ~/test --to lisi --perm read --pattern '*.log'
  share grant         --path ~/test --to lisi --perm readwrite --all
  share grant-dir     --path ~/test/logs --to lisi --perm readwrite
  share grant-container --path ~/test --to lisi --perm full
  share set-default   --path ~/test --to lisi --perm readwrite

  share list
  share revoke        --path ~/test --to lisi    (整个)
  share revoke-grant     --path ~/test/a.txt --to lisi
  share revoke-container --path ~/test --to lisi
  share revoke-default   --path ~/test --to lisi
  share sync

  check-acl

审计:
  audit [--limit 50] [--type share.add]

环境变量:
  FM_HOME / FM_CONFIG / FM_DEFAULT_SERVER
`);
}

async function doBind(opts) {
  const ssh2 = loader.loadSsh2();

  log('dim', '  [1/5] 测试密码登录...');
  const adminConn = await new Promise((resolve, reject) => {
    const c = new ssh2.Client();
    c.on('ready', () => resolve(c));
    c.on('error', e => reject(new Error('AUTH_FAIL: ' + e.message)));
    c.connect({
      host: opts.host,
      port: opts.port || 22,
      username: opts.adminUser,
      password: opts.adminPassword,
      readyTimeout: 10000,
    });
  });

  log('dim', '  [2/5] 生成密钥对...');
  const keyInfo = await keys.ensureKey(opts.serverId);

  log('dim', '  [3/5] 注入公钥...');
  // v2.4: 当向导同意 shareHomeMode,把 Agent home 改为 751,允许其他用户 traverse
  const chmodHomePart = opts.shareHomeMode
    ? `chmod 751 /home/${opts.agentUser} && `
    : '';
  await new Promise((resolve, reject) => {
    adminConn.exec(
      `${chmodHomePart}mkdir -p /home/${opts.agentUser}/.ssh && chmod 700 /home/${opts.agentUser}/.ssh && echo '${keyInfo.pubContent}' >> /home/${opts.agentUser}/.ssh/authorized_keys && chmod 600 /home/${opts.agentUser}/.ssh/authorized_keys && echo INJECTED`,
      (err, stream) => {
        if (err) return reject(err);
        let out = '';
        stream.on('data', d => out += d.toString());
        stream.stderr.on('data', d => process.stderr.write(d));
        stream.on('close', code => {
          if (code === 0 && out.includes('INJECTED')) resolve();
          else reject(new Error('INJECT_FAILED: code=' + code));
        });
      }
    );
  });
  adminConn.end();

  if (opts.shareHomeMode) {
    log('dim', '  [3.5/5] Agent home 已 chmod 751 (其他用户 traverse 授权)');
  }

  log('dim', '  [4/5] 验证免密登录...');
  await new Promise((resolve, reject) => {
    const c = new ssh2.Client();
    c.on('ready', () => {
      c.exec(`whoami && echo KEY_LOGIN_OK`, (err, stream) => {
        if (err) return reject(err);
        let out = '';
        stream.on('data', d => out += d.toString());
        stream.on('close', () => {
          c.end();
          if (out.includes('KEY_LOGIN_OK')) resolve();
          else reject(new Error('KEY_LOGIN_FAIL'));
        });
      });
    });
    c.on('error', e => reject(e));
    c.connect({
      host: opts.host,
      port: opts.port || 22,
      username: opts.agentUser,
      privateKey: fs.readFileSync(keyInfo.priv, 'utf8'),
      readyTimeout: 10000,
    });
  });

  log('dim', '  [5/5] 保存配置...');
  servers.upsert(opts.serverId, {
    host: opts.host,
    port: opts.port || 22,
    username: opts.agentUser,
    key: keyInfo.priv,
    home: `/home/${opts.agentUser}`,
    bound_at: new Date().toISOString(),
    acl_ready: false,
    bound_by: 'init',
    admin_user: opts.adminUser,
  });

  audit.write({
    server: opts.serverId,
    action: 'bind',
    actor: opts.adminUser,
    target: opts.host,
    result: 'ok',
    trace: 'cli',
  });
}

async function cmdInit(args) {
  if (!args.config) {
    const opts = await wizard.initWizard();
    log('cyan', '\n→ 开始绑定...');
    await doBind(opts);
    log('green', '\n✅ 绑定完成!');
    return;
  }

  if (!fs.existsSync(args.config)) {
    throw new Error('CONFIG_NOT_FOUND: ' + args.config);
  }
  const items = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  if (!Array.isArray(items)) {
    throw new Error('CONFIG_INVALID: 必须是数组');
  }
  for (const item of items) {
    log('cyan', `\n→ 绑定 ${item.server}...`);
    await doBind({ ...item, configPassword: true });
  }
}

async function cmdBind(args) {
  if (!args.server || !args.host || !args.user || !args.password) {
    throw new Error('BIND_PARAMS_MISSING: 需要 --server --host --user --password');
  }
  await doBind({
    serverId: args.server,
    host: args.host,
    port: parseInt(args.port, 10) || 22,
    adminUser: args.user,
    adminPassword: args.password,
    agentUser: args.user,
    createAgent: false,
    shareHomeMode: false,           // 命令行 bind 默认关闭 751 改写,避免动用户 home
  });
}

async function cmdUnbind(args) {
  const serverId = args.server;
  if (!serverId) throw new Error('SERVER_REQUIRED');
  servers.remove(serverId);
  audit.write({
    server: serverId,
    action: 'unbind',
    actor: process.env.USER || process.env.USERNAME,
    result: 'ok',
    trace: 'cli',
  });
  log('green', `✓ ${serverId} 已解绑(密钥保留)`);
}

async function cmdServers(args) {
  if (args._subcommand === 'list' || !args._subcommand) {
    const list = servers.list();
    console.log(JSON.stringify(list, null, 2));
  }
}

async function cmdExec(args) {
  const server = servers.resolveServer(args.server);
  const opts = {
    allowSudo: !!args['allow-sudo'],
    allowEscape: !!args['allow-escape'],
    sandbox: !!args.sandbox,
  };
  safety.safeCmd(args.cmd, opts);
  // jail 模式:固定可访问路径为 server.home(由 servers.json 的 jail:true 开启)
  const jail = server.jail === true;
  if (jail || opts.sandbox) {
    safety.safeExecPaths(args.cmd, server.home);
  }
  if (jail && /(^|[;&|()\s])\.\.([;&|()\s/]|$)/.test(args.cmd)) {
    console.error('PATH_BLOCKED: jail 模式下命令不能包含 .. 越级路径');
    process.exit(1);
  }
  if (jail) audit.write({ server: server.id, action: 'exec.jail', actor: server.username, target: args.cmd, result: 'ok', trace: 'cli' });
  if (opts.allowSudo) audit.write({ server: server.id, action: 'exec.allowSudo', actor: server.username, target: args.cmd, result: 'ok', trace: 'cli' });
  if (opts.allowEscape) audit.write({ server: server.id, action: 'exec.allowEscape', actor: server.username, target: args.cmd, result: 'ok', trace: 'cli' });
  if (opts.sandbox) audit.write({ server: server.id, action: 'exec.sandbox', actor: server.username, target: args.cmd, result: 'ok', trace: 'cli' });

  // jail 模式:cd 到 home 并 export HOME,相对路径与 ~ 均固定在该目录内
  // 注意:必须先 export 再执行 cmd,否则 ~/$HOME 会被外层 shell 用原值展开
  const finalCmd = jail ? 'cd ' + server.home + ' && export HOME=' + server.home + ' && ' + args.cmd : args.cmd;
  const result = await ssh.exec(server, finalCmd);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}

async function cmdMkdir(args) {
  const server = servers.resolveServer(args.server);
  const abs = safety.safePath(server.home, args.path);
  const result = await ssh.exec(server, `mkdir -p ${abs} && echo created`);
  console.log(result.stdout);
}

async function cmdWrite(args) {
  const server = servers.resolveServer(args.server);
  const abs = safety.safePath(server.home, args.path);
  const content = (args.content || '').replace(/'/g, "'\\''");
  const result = await ssh.exec(server, `echo '${content}' > ${abs} && echo written`);
  console.log(result.stdout);
}

async function cmdUpload(args) {
  const server = servers.resolveServer(args.server);
  const abs = safety.safePath(server.home, args.remote, { allowEscape: !!args['allow-escape'] });

  if (args.recursive) {
    const localDir = path.resolve(args.local);
    const files = [];
    (function walk(dir) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else files.push(p);
      }
    })(localDir);

    log('cyan', `  上传 ${files.length} 个文件...`);
    for (const f of files) {
      const rel = path.relative(localDir, f).replace(/\\/g, '/');
      const remote = abs + '/' + rel;
      await ssh.exec(server, `mkdir -p ${path.posix.dirname(remote)}`);
      process.stdout.write(`  ${rel} ... `);
      await ssh.upload(server, f, remote);
      console.log('✓');
    }
  } else {
    // 如果 abs 是目录,自动拼接本地文件名
    let remoteFile = abs;
    const checkDir = await ssh.exec(server, `test -d ${abs} && echo DIR || echo FILE`);
    if (checkDir.stdout.trim() === 'DIR') {
      const fname = path.basename(args.local);
      remoteFile = abs.replace(/\/$/, '') + '/' + fname;
    }
    const result = await ssh.upload(server, args.local, remoteFile);
    log('green', `✓ 上传 ${result.uploaded} bytes → ${remoteFile}`);
  }
}

async function cmdDownload(args) {
  const server = servers.resolveServer(args.server);
  const abs = safety.safePath(server.home, args.remote);

  if (args.tar) {
    const tarName = `/tmp/wb_download_${Date.now()}.tar.gz`;
    log('cyan', `  服务器打包: ${tarName}`);
    await ssh.exec(server, `tar -czf ${tarName} -C ${path.posix.dirname(abs)} ${path.posix.basename(abs)}`);
    await ssh.download(server, tarName, args.local);
    log('cyan', `  解压到 ${args.local}`);
    require('child_process').execSync(`tar -xzf "${args.local}" -C "${path.dirname(args.local)}"`, { stdio: 'inherit' });
    await ssh.exec(server, `rm -f ${tarName}`);
    log('green', '✓ 下载并解压完成');
  } else {
    const result = await ssh.download(server, abs, args.local);
    log('green', `✓ 下载 ${result.downloaded} bytes`);
  }
}

async function cmdRm(args) {
  const server = servers.resolveServer(args.server);
  const abs = safety.safePath(server.home, args.path);

  if (args.recursive) {
    const ok = await safety.confirm(`⚠️ 将递归删除 ${abs} 及其所有内容,无法恢复`);
    if (!ok) {
      log('yellow', '已取消');
      return;
    }
    audit.write({ server: server.id, action: 'rm.recursive', actor: server.username, target: abs, result: 'ok', trace: 'cli' });
    await ssh.exec(server, `rm -rf ${abs} && echo deleted`);
    log('green', '✓ 递归删除完成');
  } else {
    await ssh.exec(server, `rm -f ${abs} && echo deleted`);
    log('green', '✓ 已删除');
  }
}

async function cmdMv(args) {
  const server = servers.resolveServer(args.server);
  const from = safety.safePath(server.home, args.from);
  const to = safety.safePath(server.home, args.to);
  const check = await ssh.exec(server, `test -e ${to} && echo EXISTS || echo NEW`);
  if (check.stdout.trim() === 'EXISTS') {
    const ok = await safety.confirm(`⚠️ 目标 ${to} 已存在,将被覆盖`);
    if (!ok) { log('yellow', '已取消'); return; }
    audit.write({ server: server.id, action: 'mv.overwrite', actor: server.username, target: to, result: 'ok', trace: 'cli' });
  }
  await ssh.exec(server, `mv ${from} ${to} && echo renamed`);
  log('green', '✓ 已重命名');
}

async function cmdChmod(args) {
  const server = servers.resolveServer(args.server);
  const abs = safety.safePath(server.home, args.path);
  const result = await ssh.exec(server, `chmod ${args.mode} ${abs} && ls -l ${abs}`);
  console.log(result.stdout);
}

async function cmdChown(args) {
  const server = servers.resolveServer(args.server);
  const abs = safety.safePath(server.home, args.path, { allowSudo: true });
  const result = await ssh.exec(server, `sudo chown ${args.owner} ${abs}`);
  console.log(result.stdout);
}

async function cmdFind(args) {
  const server = servers.resolveServer(args.server);
  const base = safety.safePath(server.home, args.path);
  let pattern = '';
  if (args.name) pattern = `-name '${args.name}'`;
  else if (args.size) pattern = `-size ${args.size}`;
  const result = await ssh.exec(server, `find ${base} -type f ${pattern}`);
  process.stdout.write(result.stdout);
}

async function cmdGrep(args) {
  const server = servers.resolveServer(args.server);
  const base = safety.safePath(server.home, args.path);
  const include = args.include ? `--include='${args.include}'` : '';
  const result = await ssh.exec(server, `grep -rln '${args.pattern}' ${base} ${include}`);
  process.stdout.write(result.stdout);
}

async function cmdBatch(args) {
  const server = servers.resolveServer(args.server);
  const base = safety.safePath(server.home, args.path);

  if (args._subcommand === 'delete') {
    const ok = await safety.confirm(`⚠️ 将批量删除 ${base} 下匹配 ${args.pattern} 的文件`);
    if (!ok) { log('yellow', '已取消'); return; }
    audit.write({ server: server.id, action: 'batch.delete', actor: server.username, target: base, result: 'ok', trace: 'cli' });
    await ssh.exec(server, `find ${base} -name '${args.pattern}' -type f -delete && echo done`);
    log('green', '✓ 批量删除完成');
  } else if (args._subcommand === 'chmod') {
    await ssh.exec(server, `find ${base} -type f -name '${args.pattern}' | xargs chmod ${args.mode} && echo done`);
    log('green', '✓ 批量改权限完成');
  }
}

async function cmdStat(args) {
  const server = servers.resolveServer(args.server);
  const base = safety.safePath(server.home, args.path);
  const cmd = `echo 文件数: $(find ${base} -type f | wc -l); echo 总大小: $(du -sh ${base} | cut -f1)`;
  const result = await ssh.exec(server, cmd);
  process.stdout.write(result.stdout);
}

async function cmdShare(args) {
  const serverId = args.server;
  const sub = args._subcommand;

  if (sub === 'add') {
    const server = servers.resolveServer(serverId);

    // --level full 需要二次确认
    if (args.level === 'full' && !args.yes) {
      console.log('');
      log('yellow', '⚠️  危险操作:你将把目录完全管理权授予 ' + args.to);
      log('yellow', '   - 容器 rwx:' + args.to + ' 可在目录下增删改任意文件');
      log('yellow', '   - 所有现有文件 rw-:' + args.to + ' 可读写所有文件');
      log('yellow', '   - 新建文件自动 rw-');
      console.log('');
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise(resolve => {
        rl.question('确认输入 SHARE_FULL 继续,Ctrl+C 取消: ', resolve);
      });
      rl.close();
      if (answer.trim() !== 'SHARE_FULL') {
        log('yellow', '已取消');
        return;
      }
    }

    const grantTraverse = !args['no-traverse'];
    const item = await share.add({ ...server, id: serverId }, {
      path: args.path,
      to: args.to,
      level: args.level || undefined,
      container: args.container || undefined,
      filePerm: args['file-perm'] || undefined,
      defaultPerm: args['default-perm'] || undefined,
      grantAll: !!args['grant-all'] || !!args.all,
      pattern: args.pattern || undefined,
      grantTraverse,
    });

    log('green', `✓ 已共享 ${item.path} 给 ${item.grantee}`);
    log('dim', `  容器权限: ${item.container_perm}`);
    if (item.file_perm) {
      log('dim', `  文件权限: ${item.file_perm}${item.level ? ` (level=${item.level})` : ''}`);
    } else {
      log('dim', `  文件权限: 无(需 share grant 显式分配)`);
    }
    if (item.default_perm) {
      log('dim', `  default ACL: ${item.default_perm} (新文件自动继承)`);
    } else {
      log('dim', `  default ACL: 无`);
    }
    if (item.traverse_grants && item.traverse_grants.length > 0) {
      log('dim', `  父链 traverse 已自动授权:${item.traverse_grants.length} 层`);
      for (const p of item.traverse_grants) log('dim', `    + ${p}`);
    }
  } else if (sub === 'grant') {
    const server = servers.resolveServer(serverId);
    const entry = await share.grantFile({ ...server, id: serverId }, {
      path: args.path,
      to: args.to,
      perm: args.perm,
      pattern: args.pattern || undefined,
      grantAll: !!args['grant-all'] || !!args.all,
    });
    log('green', `✓ 已授权 ${entry.path} 给 ${args.to} (${entry.perm})`);
  } else if (sub === 'grant-dir') {
    const server = servers.resolveServer(serverId);
    const entry = await share.grantDir({ ...server, id: serverId }, {
      path: args.path,
      to: args.to,
      perm: args.perm,
    });
    log('green', `✓ 已授权子目录 ${entry.path} 内所有文件给 ${args.to} (${entry.perm})`);
  } else if (sub === 'grant-container') {
    const server = servers.resolveServer(serverId);
    const r = await share.grantContainer({ ...server, id: serverId }, {
      path: args.path,
      to: args.to,
      perm: args.perm,
    });
    log('green', `✓ 容器权限已调整: ${r.path} → ${r.grantee} (${r.container_perm})`);
  } else if (sub === 'set-default') {
    const server = servers.resolveServer(serverId);
    const r = await share.setDefaultPerm({ ...server, id: serverId }, {
      path: args.path,
      to: args.to,
      perm: args.perm,
    });
    log('green', `✓ default ACL 已设: ${r.path} → ${r.grantee} (${r.default_perm || 'none'})`);
  } else if (sub === 'list') {
    const items = share.list(serverId);
    console.log(JSON.stringify(items, null, 2));
  } else if (sub === 'revoke') {
    const server = servers.resolveServer(serverId);
    const r = await share.revokeAll({ ...server, id: serverId }, { path: args.path, to: args.to });
    log('green', `✓ 已撤销 ${args.path} 对 ${args.to} 的整个分享`);
    if (r.traverse_cleaned && r.traverse_cleaned.length) {
      log('dim', `  父链孤儿 traverse 已清:${r.traverse_cleaned.length} 层`);
    }
  } else if (sub === 'revoke-grant') {
    const server = servers.resolveServer(serverId);
    await share.revokeGrant({ ...server, id: serverId }, { path: args.path, to: args.to });
    log('green', `✓ 已撤销 ${args.path} 对 ${args.to} 的文件授权`);
  } else if (sub === 'revoke-container') {
    const server = servers.resolveServer(serverId);
    await share.revokeContainer({ ...server, id: serverId }, { path: args.path, to: args.to });
    log('green', `✓ 已撤销 ${args.path} 对 ${args.to} 的容器权限`);
  } else if (sub === 'revoke-default') {
    const server = servers.resolveServer(serverId);
    await share.revokeDefault({ ...server, id: serverId }, { path: args.path, to: args.to });
    log('green', `✓ 已撤销 ${args.path} 对 ${args.to} 的 default ACL`);
  } else if (sub === 'sync') {
    const server = servers.resolveServer(serverId);
    const synced = await share.sync({ ...server, id: serverId });
    log('green', `✓ 同步 ${synced.length} 条共享`);
  }
}

async function cmdCheckAcl(args) {
  const server = servers.resolveServer(args.server);
  const result = await share.checkAcl(server);
  if (result.ready) {
    log('green', `✓ ${result.version}`);
  } else {
    log('red', `✗ ${result.hint}`);
  }
}

async function cmdAudit(args) {
  const records = audit.read({ limit: parseInt(args.limit, 10) || 50, type: args.type });
  console.log(JSON.stringify(records, null, 2));
}

async function cmdInstall() {
  require('child_process').execSync('node ' + path.join(__dirname, 'install.js'), { stdio: 'inherit' });
}

async function main() {
  const argv = process.argv;
  const command = argv[2];
  const args = parseArgs(argv);

  try {
    switch (command) {
      case 'install':  return cmdInstall();
      case 'init':     return cmdInit(args);
      case 'doctor':   return doctor.run(args);
      case 'bind':     return cmdBind(args);
      case 'unbind':   return cmdUnbind(args);
      case 'servers':  return cmdServers({ ...args, _subcommand: argv[3] });
      case 'exec':     return cmdExec(args);
      case 'mkdir':    return cmdMkdir(args);
      case 'write':    return cmdWrite(args);
      case 'upload':   return cmdUpload(args);
      case 'download': return cmdDownload(args);
      case 'rm':       return cmdRm(args);
      case 'mv':       return cmdMv(args);
      case 'chmod':    return cmdChmod(args);
      case 'chown':    return cmdChown(args);
      case 'find':     return cmdFind(args);
      case 'grep':     return cmdGrep(args);
      case 'batch':    return cmdBatch({ ...args, _subcommand: argv[3] });
      case 'stat':     return cmdStat(args);
      case 'share':    return cmdShare({ ...args, _subcommand: argv[3] });
      case 'check-acl':return cmdCheckAcl(args);
      case 'audit':    return cmdAudit(args);
      case 'help':
      case '--help':
      case '-h':
      default:
        usage();
    }
  } catch (e) {
    errors.handle(e);
  }
}

// 导出供测试用
module.exports = { parseArgs, usage };

// 仅当直接执行本文件时跑 main()(被 require 时不跑)
if (require.main === module) {
  main();
}