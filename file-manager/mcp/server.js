#!/usr/bin/env node
/**
 * MCP Server for file-manager skill
 *
 * 把 25 个 CLI 命令暴露为 MCP tools
 * 任何支持 MCP 的客户端(KIMIWork/Cline/Continue/Claude Desktop)都能用
 *
 * 用法:
 *   node mcp/server.js
 *
 * 客户端配置:
 *   {
 *     "mcpServers": {
 *       "file-manager": {
 *         "command": "node",
 *         "args": ["/path/to/file-manager/mcp/server.js"]
 *       }
 *     }
 *   }
 */

'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');

// 复用 skill 现有模块
const servers = require('../scripts/servers');
const safety = require('../scripts/safety');
const ssh = require('../scripts/ssh');
const share = require('../scripts/share');
const audit = require('../scripts/audit');

// ==================== Tool 定义 ====================

const TOOLS = [
  // ===== 基础 =====
  {
    name: 'install',
    description: '持久化安装 ssh2 依赖到 ~/.file-manager/lib/',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'doctor',
    description: '环境诊断(Node/ssh2/凭证/servers/keys/ACL/审计)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: '指定 server-id(可选)' },
        json: { type: 'boolean', description: '是否返回 JSON 格式', default: false },
      },
    },
  },

  // ===== 服务器 =====
  {
    name: 'bind',
    description: '绑定服务器(密码登录→生成密钥→注入公钥→免密登录)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number', default: 22 },
        user: { type: 'string' },
        password: { type: 'string' },
      },
      required: ['server', 'host', 'user', 'password'],
    },
  },
  {
    name: 'unbind',
    description: '解绑服务器(密钥保留)',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string' } },
      required: ['server'],
    },
  },
  {
    name: 'servers_list',
    description: '列出已绑定服务器',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },

  // ===== CRUD =====
  {
    name: 'exec',
    description: '在服务器上执行 shell 命令(支持 --sandbox 路径检查)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        cmd: { type: 'string' },
        sandbox: { type: 'boolean', default: false, description: '启用路径沙箱' },
        allow_sudo: { type: 'boolean', default: false },
        allow_escape: { type: 'boolean', default: false },
      },
      required: ['server', 'cmd'],
    },
  },
  {
    name: 'mkdir',
    description: '创建目录(支持 ~/ 路径)',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string' }, path: { type: 'string' } },
      required: ['server', 'path'],
    },
  },
  {
    name: 'write',
    description: '创建/覆盖文件内容',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['server', 'path', 'content'],
    },
  },
  {
    name: 'upload',
    description: '上传本地文件/目录到服务器',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        local: { type: 'string', description: '本地路径' },
        remote: { type: 'string', description: '远端路径(支持 ~/)' },
        recursive: { type: 'boolean', default: false },
      },
      required: ['server', 'local', 'remote'],
    },
  },
  {
    name: 'download',
    description: '下载服务器文件/目录(支持 --tar 打包下载)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        remote: { type: 'string' },
        local: { type: 'string' },
        tar: { type: 'boolean', default: false, description: '打包下载' },
      },
      required: ['server', 'remote', 'local'],
    },
  },
  {
    name: 'rm',
    description: '删除文件/目录(--recursive 需 yes=true 确认)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        recursive: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false, description: '跳过二次确认' },
      },
      required: ['server', 'path'],
    },
  },
  {
    name: 'mv',
    description: '重命名/移动文件(目标存在时审计记录)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['server', 'from', 'to'],
    },
  },
  {
    name: 'chmod',
    description: '改权限(如 644/755/700)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        mode: { type: 'string', description: '如 644' },
      },
      required: ['server', 'path', 'mode'],
    },
  },
  {
    name: 'chown',
    description: '改所有者(需 allow_sudo=true)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        owner: { type: 'string', description: 'USER:GROUP' },
        allow_sudo: { type: 'boolean', default: false },
      },
      required: ['server', 'path', 'owner'],
    },
  },

  // ===== 批量 =====
  {
    name: 'find',
    description: '按名称/大小查找文件',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        name: { type: 'string', description: 'glob 模式(如 *.log)' },
        size: { type: 'string', description: '如 +10M' },
      },
      required: ['server', 'path'],
    },
  },
  {
    name: 'grep',
    description: '内容关键字检索',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        pattern: { type: 'string' },
        include: { type: 'string', description: '如 *.js' },
      },
      required: ['server', 'path', 'pattern'],
    },
  },
  {
    name: 'batch_delete',
    description: '批量删除匹配文件(需 yes=true)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        pattern: { type: 'string' },
        yes: { type: 'boolean', default: false },
      },
      required: ['server', 'path', 'pattern'],
    },
  },
  {
    name: 'batch_chmod',
    description: '批量改权限',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        pattern: { type: 'string' },
        mode: { type: 'string' },
      },
      required: ['server', 'path', 'pattern', 'mode'],
    },
  },
  {
    name: 'stat',
    description: '统计目录:文件数 + 总大小',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string' }, path: { type: 'string' } },
      required: ['server', 'path'],
    },
  },

  // ===== 共享 =====
  {
    name: 'share_add',
    description: '用 ACL 共享文件给用户(三级权限)',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        to: { type: 'string', description: '目标用户名' },
        perm: { type: 'string', enum: ['read', 'readwrite', 'admin'] },
        recursive: { type: 'boolean', default: false },
      },
      required: ['server', 'path', 'to', 'perm'],
    },
  },
  {
    name: 'share_list',
    description: '列出某 server 的所有共享',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string' } },
      required: ['server'],
    },
  },
  {
    name: 'share_revoke',
    description: '撤销共享',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        path: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['server', 'path', 'to'],
    },
  },
  {
    name: 'share_sync',
    description: '从服务端同步 ACL 到本地',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string' } },
      required: ['server'],
    },
  },
  {
    name: 'check_acl',
    description: '检测服务器是否安装 ACL 工具',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string' } },
      required: ['server'],
    },
  },

  // ===== 审计 =====
  {
    name: 'audit_list',
    description: '查看审计日志(敏感操作)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
        type: { type: 'string', description: '按 action 筛选' },
      },
    },
  },
];

// ==================== Tool 实现 ====================

async function getResolvedServer(serverId) {
  try {
    return servers.resolveServer(serverId);
  } catch (e) {
    throw new McpError(ErrorCode.InvalidParams, e.message);
  }
}

async function execOnServer(server, cmd, opts = {}) {
  safety.safeCmd(cmd, { allowSudo: opts.allow_sudo, allowEscape: opts.allow_escape });
  // jail 模式:固定可访问路径为 server.home(由 servers.json 的 jail:true 开启)
  const jail = server.jail === true;
  if (jail || opts.sandbox) safety.safeExecPaths(cmd, server.home);
  if (jail && /(^|[;&|()\s])\.\.([;&|()\s/]|$)/.test(cmd)) {
    const err = new Error('PATH_BLOCKED: jail 模式下命令不能包含 .. 越级路径');
    err.code = 'PATH_BLOCKED';
    throw err;
  }
  // jail 模式:cd 到 home 并 export HOME,相对路径与 ~ 均固定在该目录内
  // 注意:必须先 export 再执行 cmd,否则 ~/$HOME 会被外层 shell 用原值展开
  const finalCmd = jail ? 'cd ' + server.home + ' && export HOME=' + server.home + ' && ' + cmd : cmd;
  return await ssh.exec(server, finalCmd);
}

const HANDLERS = {
  install: async () => {
    require('child_process').execSync(
      'node ' + require('path').join(__dirname, '..', 'scripts', 'install.js'),
      { stdio: 'pipe' }
    );
    return { content: [{ type: 'text', text: '安装完成' }] };
  },

  doctor: async ({ server: sid, json }) => {
    if (json) {
      const doctor = require('../scripts/doctor');
      const r = await doctor.run({ server: sid, json: true });
      return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
    }
    return { content: [{ type: 'text', text: 'doctor: ' + (sid || 'all') + ' (use json=true for structured)' }] };
  },

  bind: async ({ server: sid, host, port, user, password }) => {
    const scriptPath = require('path').join(__dirname, '..', 'scripts', 'ssh-ops.js');
    const cmd = 'node ' + scriptPath + ' bind --server ' + sid + ' --host ' + host +
      ' --port ' + (port || 22) + ' --user ' + user + ' --password ' + password;
    require('child_process').execSync(cmd, { stdio: 'pipe' });
    return { content: [{ type: 'text', text: '绑定完成 ' + sid }] };
  },

  unbind: async ({ server: sid }) => {
    servers.remove(sid);
    audit.write({ server: sid, action: 'unbind', actor: 'mcp', result: 'ok', trace: 'mcp' });
    return { content: [{ type: 'text', text: '已解绑 ' + sid }] };
  },

  servers_list: async () => {
    return { content: [{ type: 'text', text: JSON.stringify(servers.list(), null, 2) }] };
  },

  exec: async ({ server: sid, cmd, sandbox, allow_sudo, allow_escape }) => {
    const server = await getResolvedServer(sid);
    try {
      const r = await execOnServer(server, cmd, { sandbox, allow_sudo, allow_escape });
      if (server.jail) audit.write({ server: sid, action: 'exec.jail', actor: server.username, target: cmd, result: 'ok', trace: 'mcp' });
      if (sandbox) audit.write({ server: sid, action: 'exec.sandbox', actor: server.username, target: cmd, result: 'ok', trace: 'mcp' });
      if (allow_sudo) audit.write({ server: sid, action: 'exec.allowSudo', actor: server.username, target: cmd, result: 'ok', trace: 'mcp' });
      if (allow_escape) audit.write({ server: sid, action: 'exec.allowEscape', actor: server.username, target: cmd, result: 'ok', trace: 'mcp' });
      return { content: [{ type: 'text', text: r.stdout + (r.stderr || '') }] };
    } catch (e) {
      throw new McpError(ErrorCode.InternalError, e.message);
    }
  },

  mkdir: async ({ server: sid, path: p }) => {
    const server = await getResolvedServer(sid);
    const abs = safety.safePath(server.home, p);
    await ssh.exec(server, 'mkdir -p ' + abs + ' && echo created');
    return { content: [{ type: 'text', text: 'created: ' + abs }] };
  },

  write: async ({ server: sid, path: p, content }) => {
    const server = await getResolvedServer(sid);
    const abs = safety.safePath(server.home, p);
    const c = (content || '').replace(/'/g, "'\\''");
    await ssh.exec(server, "echo '" + c + "' > " + abs + ' && echo written');
    return { content: [{ type: 'text', text: 'written: ' + abs }] };
  },

  upload: async ({ server: sid, local, remote, recursive }) => {
    const server = await getResolvedServer(sid);
    const abs = safety.safePath(server.home, remote, { allowEscape: false });
    if (recursive) {
      const localDir = require('path').resolve(local);
      const files = [];
      (function walk(d) {
        for (const f of require('fs').readdirSync(d, { withFileTypes: true })) {
          const p = require('path').join(d, f.name);
          if (f.isDirectory()) walk(p);
          else files.push(p);
        }
      })(localDir);
      for (const f of files) {
        const rel = require('path').relative(localDir, f).replace(/\\/g, '/');
        const remoteFile = abs + '/' + rel;
        await ssh.exec(server, 'mkdir -p ' + require('path').posix.dirname(remoteFile));
        await ssh.upload(server, f, remoteFile);
      }
      return { content: [{ type: 'text', text: 'uploaded ' + files.length + ' files' }] };
    } else {
      const r = await ssh.upload(server, local, abs);
      return { content: [{ type: 'text', text: 'uploaded ' + r.uploaded + ' bytes → ' + abs }] };
    }
  },

  download: async ({ server: sid, remote, local, tar }) => {
    const server = await getResolvedServer(sid);
    const abs = safety.safePath(server.home, remote);
    if (tar) {
      const tarName = '/tmp/wb_dl_' + Date.now() + '.tar.gz';
      await ssh.exec(server, 'tar -czf ' + tarName + ' -C ' + require('path').posix.dirname(abs) + ' ' + require('path').posix.basename(abs));
      await ssh.download(server, tarName, local);
      await ssh.exec(server, 'rm -f ' + tarName);
      require('child_process').execSync('tar -xzf "' + local + '" -C "' + require('path').dirname(local) + '"', { stdio: 'pipe' });
      return { content: [{ type: 'text', text: 'downloaded and extracted: ' + local }] };
    } else {
      const r = await ssh.download(server, abs, local);
      return { content: [{ type: 'text', text: 'downloaded ' + r.downloaded + ' bytes' }] };
    }
  },

  rm: async ({ server: sid, path: p, recursive, yes }) => {
    const server = await getResolvedServer(sid);
    const abs = safety.safePath(server.home, p);
    if (recursive) {
      if (!yes) {
        throw new McpError(ErrorCode.InvalidRequest, '递归删除需设置 yes=true 确认 (path=' + abs + ')');
      }
      audit.write({ server: sid, action: 'rm.recursive', actor: server.username, target: abs, result: 'ok', trace: 'mcp' });
      await ssh.exec(server, 'rm -rf ' + abs + ' && echo deleted');
    } else {
      await ssh.exec(server, 'rm -f ' + abs + ' && echo deleted');
    }
    return { content: [{ type: 'text', text: 'deleted: ' + abs }] };
  },

  mv: async ({ server: sid, from, to }) => {
    const server = await getResolvedServer(sid);
    const f = safety.safePath(server.home, from);
    const t = safety.safePath(server.home, to);
    const check = await ssh.exec(server, 'test -e ' + t + ' && echo EXISTS || echo NEW');
    if (check.stdout.trim() === 'EXISTS') {
      audit.write({ server: sid, action: 'mv.overwrite', actor: server.username, target: t, result: 'ok', trace: 'mcp' });
    }
    await ssh.exec(server, 'mv ' + f + ' ' + t + ' && echo renamed');
    return { content: [{ type: 'text', text: 'renamed: ' + f + ' → ' + t }] };
  },

  chmod: async ({ server: sid, path: p, mode }) => {
    const server = await getResolvedServer(sid);
    const abs = safety.safePath(server.home, p);
    await ssh.exec(server, 'chmod ' + mode + ' ' + abs + ' && echo done');
    return { content: [{ type: 'text', text: 'chmod ' + mode + ' ' + abs }] };
  },

  chown: async ({ server: sid, path: p, owner, allow_sudo }) => {
    if (!allow_sudo) {
      throw new McpError(ErrorCode.InvalidRequest, 'chown 需要 allow_sudo=true');
    }
    const server = await getResolvedServer(sid);
    const abs = safety.safePath(server.home, p, { allowSudo: true });
    audit.write({ server: sid, action: 'chown', actor: server.username, target: abs, result: 'ok', trace: 'mcp' });
    await ssh.exec(server, 'sudo chown ' + owner + ' ' + abs);
    return { content: [{ type: 'text', text: 'chown ' + owner + ' ' + abs }] };
  },

  find: async ({ server: sid, path: p, name, size }) => {
    const server = await getResolvedServer(sid);
    const base = safety.safePath(server.home, p);
    let pat = '';
    if (name) pat = "-name '" + name + "'";
    else if (size) pat = '-size ' + size;
    const r = await ssh.exec(server, 'find ' + base + ' -type f ' + pat);
    return { content: [{ type: 'text', text: r.stdout }] };
  },

  grep: async ({ server: sid, path: p, pattern, include }) => {
    const server = await getResolvedServer(sid);
    const base = safety.safePath(server.home, p);
    const inc = include ? "--include='" + include + "'" : '';
    const r = await ssh.exec(server, "grep -rln '" + pattern + "' " + base + ' ' + inc);
    return { content: [{ type: 'text', text: r.stdout }] };
  },

  batch_delete: async ({ server: sid, path: p, pattern, yes }) => {
    if (!yes) {
      throw new McpError(ErrorCode.InvalidRequest, 'batch_delete 需 yes=true');
    }
    const server = await getResolvedServer(sid);
    const base = safety.safePath(server.home, p);
    audit.write({ server: sid, action: 'batch.delete', actor: server.username, target: base, result: 'ok', trace: 'mcp' });
    await ssh.exec(server, "find " + base + " -name '" + pattern + "' -type f -delete && echo done");
    return { content: [{ type: 'text', text: 'deleted pattern=' + pattern + ' in ' + base }] };
  },

  batch_chmod: async ({ server: sid, path: p, pattern, mode }) => {
    const server = await getResolvedServer(sid);
    const base = safety.safePath(server.home, p);
    await ssh.exec(server, "find " + base + " -type f -name '" + pattern + "' | xargs chmod " + mode + ' && echo done');
    return { content: [{ type: 'text', text: 'chmod ' + mode + ' pattern=' + pattern + ' in ' + base }] };
  },

  stat: async ({ server: sid, path: p }) => {
    const server = await getResolvedServer(sid);
    const base = safety.safePath(server.home, p);
    const r = await ssh.exec(server,
      "echo '文件数: $(find " + base + " -type f | wc -l)'; echo '总大小: $(du -sh " + base + " | cut -f1)'");
    return { content: [{ type: 'text', text: r.stdout }] };
  },

  share_add: async ({ server: sid, path: p, to, perm, recursive }) => {
    const server = await getResolvedServer(sid);
    const item = await share.add({ ...server, id: sid }, {
      path: p, to, perm, recursive: !!recursive,
    });
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  },

  share_list: async ({ server: sid }) => {
    return { content: [{ type: 'text', text: JSON.stringify(share.list(sid), null, 2) }] };
  },

  share_revoke: async ({ server: sid, path: p, to }) => {
    const server = await getResolvedServer(sid);
    await share.revoke({ ...server, id: sid }, { path: p, to });
    return { content: [{ type: 'text', text: '已撤销' }] };
  },

  share_sync: async ({ server: sid }) => {
    const server = await getResolvedServer(sid);
    const synced = await share.sync({ ...server, id: sid });
    return { content: [{ type: 'text', text: 'synced ' + synced.length + ' items' }] };
  },

  check_acl: async ({ server: sid }) => {
    const server = await getResolvedServer(sid);
    const r = await share.checkAcl(server);
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  },

  audit_list: async ({ limit = 50, type }) => {
    const records = audit.read({ limit, type });
    return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
  },
};

// ==================== Resources ====================

const RESOURCES = [
  {
    uri: 'file-manager://servers',
    name: '已绑定服务器列表',
    description: '~/.file-manager/servers.json 的内容',
    mimeType: 'application/json',
  },
  {
    uri: 'file-manager://audit',
    name: '审计日志',
    description: '~/.file-manager/audit.log(最近 100 条)',
    mimeType: 'application/x-ndjson',
  },
];

// ==================== Server 启动 ====================

const server = new Server({
  name: 'file-manager',
  version: '2.3.0',
}, {
  capabilities: {
    tools: {},
    resources: {},
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, 'Unknown tool: ' + name);
  }
  try {
    return await handler(args || {});
  } catch (e) {
    if (e instanceof McpError) throw e;
    throw new McpError(ErrorCode.InternalError, e.message || String(e));
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === 'file-manager://servers') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(servers.list(), null, 2),
      }],
    };
  }
  if (uri === 'file-manager://audit') {
    const records = audit.read({ limit: 100 });
    return {
      contents: [{
        uri,
        mimeType: 'application/x-ndjson',
        text: records.map(r => JSON.stringify(r)).join('\n'),
      }],
    };
  }
  throw new McpError(ErrorCode.InvalidRequest, 'Unknown resource: ' + uri);
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error('file-manager MCP server v2.3.0 ready (stdio)');
}).catch(e => {
  console.error('Failed to start:', e);
  process.exit(1);
});