/**
 * share.js - 文件共享管理(需�?4 核心)
 *
 * 基于 Linux ACL(setfacl/getfacl)
 * 三级权限:read / readwrite / admin
 * 元数据持久化�?~/.file-manager/shares/<server>.json
 *
 * ====================================================================
 * v2.5.0 重大重构:三层独立授权
 * ====================================================================
 *
 * �?分享一个目�?拆成三个独立维度,每个维度由分享者显式分�?
 *
 *   ┌─────────────────────────────────────────────────────────────�? *   �? 1. 容器权限(目录本身)                                       �? *   �?    - none      : 不设 ACL,grantee 完全无法访问该目�?       �? *   �?    - list      : r-x,grantee �?ls/cd(默认)                �? *   �?    - traverse  : --x,grantee 仅可按已知路径访�?不能 ls    �? *   �?    - full      : rwx,grantee �?ls/cd/mkdir/touch/rm/mv    �? *   ├─────────────────────────────────────────────────────────────�? *   �? 2. 子项权限(目录下现有文�?子目�?                          �? *   �?    - 默认:无任�?ACL(完全拒绝)                            �? *   �?    - 通过 share grant / share grant-dir 显式分配           �? *   �?    - perm: read | readwrite | admin �?r-- | rw- | rwx     �? *   ├─────────────────────────────────────────────────────────────�? *   �? 3. 未来�?目录以后新创建的文件/子目�?                      �? *   �?    - 默认:�?default ACL,新文件自动不可访�?               �? *   �?    - 通过 share set-default 显式开�?                     �? *   └─────────────────────────────────────────────────────────────�? *
 * 防御原理:
 *   Linux 删除/重命名一个文�?实际修改的是父目录的目录�?索引�?,
 *   需要父目录�?w 权限。容器默�?r-x 不含 w,grantee 永远不能:
 *     - �?test/ �?mkdir / touch
 *     - �?test/ �?rm / mv / 改名任何文件
 *     - 删除 test/ 本身
 *   即使文件被显�?grant rwx(可读可写),grantee 仍无法删�?重命名它�? *
 * 快捷等级(--level):
 *   read       = 容器 list + 子项�?+ future�? *   readwrite  = 容器 list + 子项�?readwrite + future readwrite
 *   full       = 容器 full + 子项�?readwrite + future readwrite
 *                ⚠️ full 等级需二次确认(CLI: --yes / 需输入 SHARE_FULL)
 *
 * v2.4 保留:父目�?traverse 自动授权
 *   跨用户共享时,被分享人需�?home 链每一级目录的 --x 才能穿透�? *   share.add 自动给父链最�?traverse 授权�? *   share.revoke 撤销�?若该层仅为此分享而设,则一并清掉�? */

'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./env');
const ssh = require('./ssh');
const audit = require('./audit');

/* ------------------------------------------------------------------ */
/* 权限映射                                                            */
/* ------------------------------------------------------------------ */

/**
 * 业务三级权限 �?文件�?ACL 字符
 *   read       �?r--    (可读,不能�?
 *   readwrite  �?rw-    (可读可写,�?x)
 *   admin      �?rwx
 */
const PERM_FILE = {
  read: 'r--',
  readwrite: 'rw-',
  admin: 'rwx',
};

/**
 * 容器权限(目录本身)4 �? *   none      �?null       (不设任何 ACL,grantee 看不到摸不着)
 *   list      �?r-x        (�?ls/cd,不能�?
 *   traverse  �?--x        (只能按已知路径进,不能 ls)
 *   full      �?rwx        (完全管理)
 */
const CONTAINER_PERM = {
  none: null,
  list: 'r-x',
  traverse: '--x',
  full: 'rwx',
};

/**
 * --level 快捷方式
 *   read       �?容器 list,  子项�? future�? *   readwrite  �?容器 list,  子项�?readwrite, future readwrite
 *   full       �?容器 full,  子项�?readwrite, future readwrite
 */
const LEVEL_PRESET = {
  read:      { container: 'list', filePerm: 'read',      defaultPerm: null },
  readwrite: { container: 'list', filePerm: 'readwrite', defaultPerm: 'readwrite' },
  full:      { container: 'full', filePerm: 'readwrite', defaultPerm: 'readwrite' },
};

/* ------------------------------------------------------------------ */
/* 持久�?                                                             */
/* ------------------------------------------------------------------ */

function getSharesFile(serverId) {
  return path.join(env.getSharesDir(), `${serverId}.json`);
}

function load(serverId) {
  const file = getSharesFile(serverId);
  if (!fs.existsSync(file)) {
    return { server: serverId, items: [], version: '2.5' };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.version) data.version = '2.5';
    return data;
  } catch {
    return { server: serverId, items: [], version: '2.5' };
  }
}

function save(data) {
  const file = getSharesFile(data.server);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function escapePath(p) {
  return p.includes(' ') ? `'${p.replace(/'/g, "'\\''")}'` : p;
}

/* ------------------------------------------------------------------ */
/* 父目�?traverse 处理(v2.4 保留)                                   */
/* ------------------------------------------------------------------ */

async function inspectAcl(server, remotePath, user) {
  const cmd = `stat -c '%a %U %G' ${remotePath} 2>/dev/null && echo --- && getfacl -p ${remotePath} 2>/dev/null`;
  const r = await ssh.exec(server, cmd);
  if (r.code !== 0) return null;
  const lines = r.stdout.split('\n---');
  const statLine = (lines[0] || '').trim();
  const aclBlock = (lines[1] || '').trim();

  const parts = statLine.split(/\s+/);
  const mode = parseInt(parts[0], 8);
  const owner = parts[1];
  const otherX = !!(mode & 0o001);
  const ownerX = !!(mode & 0o100);

  const hasEntryForUser = new RegExp(`^user:${user}:`, 'm').test(aclBlock);
  const userLineMatch = aclBlock.match(new RegExp(`^user:${user}:([rwx-]+)`, 'm'));
  const userExplicitX = userLineMatch ? /x/.test(userLineMatch[1]) : false;
  const effMatch = aclBlock.match(new RegExp(`^\\s*effective:\\s*([rwx-]+)`, 'm'));
  const effectiveX = effMatch ? /x/.test(effMatch[1]) : false;

  return {
    hasX: effectiveX || otherX || (user === owner && ownerX),
    hasAclEntry: hasEntryForUser && userExplicitX,
  };
}

function parentChain(remotePath) {
  const out = [];
  let p = remotePath;
  while (true) {
    const parent = path.posix.dirname(p);
    if (parent === p || parent === '/') {
      out.push(parent);
      break;
    }
    out.push(parent);
    p = parent;
  }
  return out.filter(d => d !== '/').reverse();
}

async function ensureTraverseChain(server, parents, user) {
  const granted = [];
  for (const p of parents) {
    const info = await inspectAcl(server, p, user);
    if (!info) continue;
    if (info.hasX) continue;
    const safe = escapePath(p);
    const r = await ssh.exec(server, `setfacl -m u:${user}:--x ${safe} 2>&1`);
    if (r.code === 0) {
      granted.push(p);
    } else {
      throw Object.assign(
        new Error(`PARENT_TOO_RESTRICTIVE: 无法�?${p} �?traverse 权限`),
        { code: 'PARENT_TOO_RESTRICTIVE', path: p, stderr: r.stderr }
      );
    }
  }
  return granted;
}

async function cleanupOrphanTraverse(server, serverId, user, orphans) {
  const cleaned = [];
  if (!orphans || orphans.length === 0) return cleaned;
  const remaining = load(serverId).items.filter(it => it.grantee === user);
  const stillUsedDirs = new Set();
  for (const item of remaining) {
    for (const d of parentChain(item.path)) stillUsedDirs.add(d);
  }
  for (const dir of orphans) {
    if (stillUsedDirs.has(dir)) continue;
    const safe = escapePath(dir);
    const r = await ssh.exec(server, `setfacl -x u:${user} ${safe} 2>&1`);
    if (r.code === 0) cleaned.push(dir);
  }
  return cleaned;
}

/* ------------------------------------------------------------------ */
/* 内部:容器权限应用                                                  */
/* ------------------------------------------------------------------ */

async function applyContainer(server, containerPath, user, perm) {
  const aclPerm = CONTAINER_PERM[perm];
  const safe = escapePath(containerPath);
  if (aclPerm === null) {
    try { await ssh.exec(server, `setfacl -x u:${user} ${safe} 2>/dev/null; true`); } catch (_) {};
    return;
  }
  const r = await ssh.exec(server, `setfacl -m u:${user}:${aclPerm} ${safe} 2>&1`);
  if (r.code !== 0) throw new Error('ACL_FAILED (container): ' + r.stderr);
}

/**
 * 递归给容器内所有子目录�?r-x(�?grantee �?ls 整棵�?
 * 但不碰文�? */
async function applyContainerRecursiveList(server, containerPath, user) {
  const safe = escapePath(containerPath);
  const cmd = `cd ${safe} && find . -type d -print0 2>/dev/null | xargs -0 -r -I{} setfacl -m u:${user}:r-x {} 2>/dev/null; true`;
  try { await ssh.exec(server, cmd); } catch (_) {}
}

async function clearContainerRecursive(server, containerPath, user) {
  const safe = escapePath(containerPath);
  const cmd = `cd ${safe} && find . -type d -print0 2>/dev/null | xargs -0 -r -I{} setfacl -x u:${user} {} 2>/dev/null; true`;
  try { await ssh.exec(server, cmd); } catch (_) {}
}

/* ------------------------------------------------------------------ */
/* 内部:子项权限应用                                                  */
/* ------------------------------------------------------------------ */

async function applyFile(server, filePath, user, perm) {
  const aclPerm = PERM_FILE[perm];
  if (!aclPerm) throw new Error(`INVALID_FILE_PERM: ${perm}`);
  const safe = escapePath(filePath);
  const r = await ssh.exec(server, `setfacl -m u:${user}:${aclPerm} ${safe} 2>&1`);
  if (r.code !== 0) throw new Error('ACL_FAILED (file): ' + r.stderr);
}

async function applyFilesByPattern(server, containerPath, user, perm, pattern) {
  const aclPerm = PERM_FILE[perm];
  if (!aclPerm) throw new Error(`INVALID_FILE_PERM: ${perm}`);
  const safe = escapePath(containerPath);
  const safePat = `'${String(pattern).replace(/'/g, "'\\''")}'`;
  const cmd =
    `cd ${safe} && find . -type f -name ${safePat} -print0 2>/dev/null | ` +
    `xargs -0 -r -I{} setfacl -m u:${user}:${aclPerm} {} 2>/dev/null; true`;
  const r = await ssh.exec(server, cmd);
  if (r.code !== 0) throw new Error('ACL_FAILED (pattern): ' + r.stderr);
}

async function applyAllFiles(server, containerPath, user, perm) {
  const aclPerm = PERM_FILE[perm];
  if (!aclPerm) throw new Error(`INVALID_FILE_PERM: ${perm}`);
  const safe = escapePath(containerPath);
  const cmd =
    `cd ${safe} && find . -type f -print0 2>/dev/null | ` +
    `xargs -0 -r -I{} setfacl -m u:${user}:${aclPerm} {} 2>/dev/null; true`;
  const r = await ssh.exec(server, cmd);
  if (r.code !== 0) throw new Error('ACL_FAILED (all files): ' + r.stderr);
}

async function clearFile(server, filePath, user) {
  const safe = escapePath(filePath);
  try { await ssh.exec(server, `setfacl -x u:${user} ${safe} 2>/dev/null; true`); } catch (_) {};
}

async function clearAllFiles(server, containerPath, user) {
  const safe = escapePath(containerPath);
  const cmd =
    `cd ${safe} && find . -type f -print0 2>/dev/null | ` +
    `xargs -0 -r -I{} setfacl -x u:${user} {} 2>/dev/null; true`;
  try { await ssh.exec(server, cmd); } catch (_) {};
}

/* ------------------------------------------------------------------ */
/* 内部:default ACL                                                   */
/* ------------------------------------------------------------------ */

async function setDefault(server, containerPath, user, perm) {
  const safe = escapePath(containerPath);
  try { await ssh.exec(server, `setfacl -d -x u:${user} ${safe} 2>/dev/null; true`); } catch (_) {};
  if (!perm || perm === 'none') return;
  const fileAcl = PERM_FILE[perm];
  if (!fileAcl) throw new Error(`INVALID_FILE_PERM: ${perm}`);
  const cmd =
    `setfacl -d -m u:${user}:${fileAcl} ${safe} && ` +
    `setfacl -d -m u:${user}:r-x ${safe}`;
  const r = await ssh.exec(server, cmd);
  if (r.code !== 0) throw new Error('ACL_FAILED (default): ' + r.stderr);
}

async function clearDefault(server, containerPath, user) {
  const safe = escapePath(containerPath);
  try { await ssh.exec(server, `setfacl -k ${safe} 2>/dev/null; true`); } catch (_) {};
}

/* ------------------------------------------------------------------ */
/* 类型探测                                                            */
/* ------------------------------------------------------------------ */

async function detectType(server, remotePath) {
  const safe = escapePath(remotePath);
  const r = await ssh.exec(
    server,
    `if [ -d ${safe} ]; then echo DIR; elif [ -e ${safe} ]; then echo FILE; else echo MISSING; fi`
  );
  return (r.stdout || '').trim();
}

/* ------------------------------------------------------------------ */
/* 1) 创建分享 share.add                                              */
/* ------------------------------------------------------------------ */

/**
 * 添加分享(v2.5 核心入口)
 *
 * @param {object} server
 * @param {object} opts {
 *   path, to,
 *   level,                          // 'read'|'readwrite'|'full'  与下�?3 个互�? *   container,                      // 容器权限
 *   filePerm,                       // 子项文件权限
 *   defaultPerm,                    // future 文件权限
 *   grantAll,                       // filePerm 是否应用到所有现有文�? *   pattern,                        // 通配�? *   grantTraverse,                  // 父链 traverse 自动授权(默认 true)
 * }
 */
async function add(server, opts) {
  const {
    path: remotePath,
    to,
    level,
    container: containerOpt,
    filePerm: filePermOpt,
    defaultPerm: defaultPermOpt,
    grantAll,
    pattern,
    grantTraverse = true,
  } = opts;

  if (!to) throw new Error('GRANTEE_REQUIRED: 需�?--to <user>');
  if (!remotePath) throw new Error('PATH_REQUIRED');

  // level 预设展开
  let container = containerOpt;
  let filePerm = filePermOpt;
  let defaultPerm = defaultPermOpt;
  if (level) {
    if (!LEVEL_PRESET[level]) {
      throw new Error(`INVALID_LEVEL: ${level},可�? read/readwrite/full`);
    }
    if (containerOpt || filePermOpt || defaultPermOpt) {
      throw new Error('LEVEL_CONFLICT: --level �?--container/--file-perm/--default-perm 互斥');
    }
    const preset = LEVEL_PRESET[level];
    container = preset.container;
    filePerm = preset.filePerm;
    defaultPerm = preset.defaultPerm;
  }
  if (container === undefined) container = 'list';
  if (container !== 'none' && !(container in CONTAINER_PERM)) {
    throw new Error(`INVALID_CONTAINER: ${container},可�? none/list/traverse/full`);
  }
  if (filePerm != null && !PERM_FILE[filePerm]) {
    throw new Error(`INVALID_FILE_PERM: ${filePerm},可�? read/readwrite/admin`);
  }
  if (defaultPerm != null && defaultPerm !== 'none' && !PERM_FILE[defaultPerm]) {
    throw new Error(`INVALID_DEFAULT_PERM: ${defaultPerm},可�? read/readwrite/admin/none`);
  }

  const serverId = server.id || server.host;
  const targetType = await detectType(server, remotePath);
  if (targetType === 'MISSING') {
    throw new Error(`TARGET_NOT_FOUND: ${remotePath}`);
  }

  // 父链 traverse 自动授权
  let traverseGrants = [];
  if (grantTraverse) {
    traverseGrants = await ensureTraverseChain(
      server,
      parentChain(remotePath),
      to
    );
  }

  // v2.5.1: 默认 filePerm = read(开箱即读)
  const effectiveFilePermMeta = filePerm || 'read';

  const record = {
    id: `share-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    path: remotePath,
    grantee: to,
    target_type: targetType,
    container_perm: container,
    file_perm: effectiveFilePermMeta,
    default_perm: defaultPerm || null,
    grants: [],
    traverse_grants: traverseGrants,
    created_at: new Date().toISOString(),
    granted_by: server.username,
    level: level || null,
  };

  if (targetType === 'DIR') {
    await applyContainer(server, remotePath, to, container);
    if (container !== 'none') {
      await applyContainerRecursiveList(server, remotePath, to);
    }
    // v2.5.1: 用户没传 filePerm/grantAll/pattern 时,默认给所有现有文件 r--(开箱即读)
    const effectiveFilePerm = filePerm || 'read';
    const effectiveGrantAll = (grantAll === undefined) ? true : !!grantAll;
    if (effectiveFilePerm) {
      if (pattern) {
        await applyFilesByPattern(server, remotePath, to, effectiveFilePerm, pattern);
      } else if (effectiveGrantAll) {
        await applyAllFiles(server, remotePath, to, effectiveFilePerm);
      }
    }
    if (defaultPerm && defaultPerm !== 'none') {
      await setDefault(server, remotePath, to, defaultPerm);
    }
  } else {
    // 单文件:默认 r--,分享者可通过 --file-perm 改
    const effectiveFilePerm = filePerm || 'read';
    await applyFile(server, remotePath, to, effectiveFilePerm);
  }

  // 写元数据
  const data = load(serverId);
  data.items.push(record);
  save(data);

  audit.write({
    server: server.id,
    action: 'share.add',
    actor: server.username,
    target: remotePath,
    grantee: to,
    level: level || null,
    container,
    file_perm: filePerm,
    default_perm: defaultPerm,
    pattern: pattern || null,
    result: 'ok',
    traverse_grants: traverseGrants.length,
    trace: 'cli',
  });

  return record;
}

/* ------------------------------------------------------------------ */
/* 2) 显式文件授权 share.grant                                        */
/* ------------------------------------------------------------------ */

async function grantFile(server, opts) {
  const { path: remotePath, to, perm, pattern, grantAll } = opts;
  // v2.5.1: 不传 perm 时默认 read(r--)
  const effectivePerm = perm || 'read';
  if (!to) throw new Error('GRANTEE_REQUIRED');
  if (!PERM_FILE[effectivePerm]) {
    throw new Error(`INVALID_FILE_PERM: ${perm}`);
  }

  const serverId = server.id || server.host;
  const data = load(serverId);
  const share = data.items.find(
    it => it.grantee === to && (
      it.path === remotePath ||
      remotePath.startsWith(it.path.replace(/\/$/, '') + '/')
    )
  );
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath} 或其父目录`);
  }

  // 确保父链 traverse
  let traverseGrants = await ensureTraverseChain(
    server,
    parentChain(remotePath),
    to
  );

  // v2.5.1: 默认 grantAll=true(单文件/通配符/grant-dir 同理,默认 r-- 覆盖整树)
  const effectiveGrantAll = (grantAll === undefined) ? true : !!grantAll;

  if (pattern) {
    await applyFilesByPattern(server, share.path, to, effectivePerm, pattern);
  } else if (effectiveGrantAll) {
    await applyAllFiles(server, share.path, to, effectivePerm);
  } else {
    await applyFile(server, remotePath, to, effectivePerm);
  }

  const grantEntry = {
    path: remotePath,
    perm: effectivePerm,
    pattern: pattern || null,
    grant_all: effectiveGrantAll,
    granted_at: new Date().toISOString(),
  };
  if (!share.grants) share.grants = [];
  share.grants.push(grantEntry);
  save(data);

  audit.write({
    server: server.id,
    action: 'share.grant',
    actor: server.username,
    target: remotePath,
    grantee: to,
    perm: effectivePerm,
    pattern: pattern || null,
    grant_all: effectiveGrantAll,
    result: 'ok',
    trace: 'cli',
  });

  return grantEntry;
}

/* ------------------------------------------------------------------ */
/* 3) 容器权限调整 share.grant-container                              */
/* ------------------------------------------------------------------ */

async function grantContainer(server, opts) {
  const { path: remotePath, to, perm } = opts;
  if (!to) throw new Error('GRANTEE_REQUIRED');
  if (!(perm in CONTAINER_PERM)) {
    throw new Error(`INVALID_CONTAINER: ${perm},可�? none/list/traverse/full`);
  }

  const serverId = server.id || server.host;
  const data = load(serverId);
  const share = data.items.find(it => it.path === remotePath && it.grantee === to);
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath}`);
  }

  await applyContainer(server, remotePath, to, perm);
  if (perm !== 'none') {
    await applyContainerRecursiveList(server, remotePath, to);
  } else {
    await clearContainerRecursive(server, remotePath, to);
  }

  share.container_perm = perm;
  share.updated_at = new Date().toISOString();
  save(data);

  audit.write({
    server: server.id,
    action: 'share.grant.container',
    actor: server.username,
    target: remotePath,
    grantee: to,
    container_perm: perm,
    result: 'ok',
    trace: 'cli',
  });

  return { path: remotePath, grantee: to, container_perm: perm };
}

/* ------------------------------------------------------------------ */
/* 4) 子目录批量授�?share.grant-dir                                  */
/* ------------------------------------------------------------------ */

async function grantDir(server, opts) {
  const { path: remotePath, to, perm } = opts;
  // v2.5.1: 不传 perm 时默认 read(r--)
  const effectivePerm = perm || 'read';
  if (!to) throw new Error('GRANTEE_REQUIRED');
  if (!PERM_FILE[effectivePerm]) {
    throw new Error(`INVALID_FILE_PERM: ${perm}`);
  }

  const serverId = server.id || server.host;
  const data = load(serverId);

  const share = data.items.find(
    it => it.grantee === to && (
      it.path === remotePath ||
      remotePath.startsWith(it.path.replace(/\/$/, '') + '/')
    )
  );
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath} 或其父目录`);
  }

  const type = await detectType(server, remotePath);
  if (type !== 'DIR') {
    throw new Error(`NOT_A_DIR: ${remotePath}`);
  }

  let traverseGrants = await ensureTraverseChain(
    server,
    parentChain(remotePath),
    to
  );

  await applyAllFiles(server, remotePath, to, effectivePerm);

  const grantEntry = {
    path: remotePath,
    perm: effectivePerm,
    is_dir: true,
    granted_at: new Date().toISOString(),
  };
  if (!share.grants) share.grants = [];
  share.grants.push(grantEntry);
  save(data);

  audit.write({
    server: server.id,
    action: 'share.grant.dir',
    actor: server.username,
    target: remotePath,
    grantee: to,
    perm: effectivePerm,
    result: 'ok',
    trace: 'cli',
  });

  return grantEntry;
}

/* ------------------------------------------------------------------ */
/* 5) 未来�?default ACL share.set-default                            */
/* ------------------------------------------------------------------ */

async function setDefaultPerm(server, opts) {
  const { path: remotePath, to, perm } = opts;
  if (!to) throw new Error('GRANTEE_REQUIRED');

  const serverId = server.id || server.host;
  const data = load(serverId);
  const share = data.items.find(it => it.path === remotePath && it.grantee === to);
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath}`);
  }
  if (share.target_type !== 'DIR') {
    throw new Error('NOT_A_DIR: default ACL 仅对目录有效');
  }

  if (perm && perm !== 'none' && !PERM_FILE[perm]) {
    throw new Error(`INVALID_DEFAULT_PERM: ${perm},可�? read/readwrite/admin/none`);
  }

  await setDefault(server, remotePath, to, perm === 'none' ? null : perm);

  share.default_perm = (perm === 'none' || !perm) ? null : perm;
  share.updated_at = new Date().toISOString();
  save(data);

  audit.write({
    server: server.id,
    action: 'share.default',
    actor: server.username,
    target: remotePath,
    grantee: to,
    default_perm: share.default_perm,
    result: 'ok',
    trace: 'cli',
  });

  return { path: remotePath, grantee: to, default_perm: share.default_perm };
}

/* ------------------------------------------------------------------ */
/* 6) 列表 share.list                                                  */
/* ------------------------------------------------------------------ */

function list(serverId) {
  return load(serverId).items;
}

/* ------------------------------------------------------------------ */
/* 7) 撤销 share.revoke / revoke-grant / revoke-container / revoke-default */
/* ------------------------------------------------------------------ */

async function revokeAll(server, opts) {
  const { path: remotePath, to } = opts;
  const serverId = server.id || server.host;

  const data = load(serverId);
  const share = data.items.find(it => it.path === remotePath && it.grantee === to);
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath}`);
  }
  const traverseOrphans = share.traverse_grants || [];
  const safeTarget = escapePath(remotePath);

  try { await ssh.exec(server, `setfacl -x u:${to} ${safeTarget} 2>/dev/null; true`); } catch (_) {};
  await clearDefault(server, remotePath, to);
  if (share.target_type === 'DIR') {
    await clearAllFiles(server, remotePath, to);
    await clearContainerRecursive(server, remotePath, to);
  }
  data.items = data.items.filter(
    it => !(it.path === remotePath && it.grantee === to)
  );
  save(data);

  const cleaned = await cleanupOrphanTraverse(server, serverId, to, traverseOrphans).catch(() => []);

  audit.write({
    server: server.id,
    action: 'share.revoke',
    actor: server.username,
    target: remotePath,
    grantee: to,
    result: 'ok',
    traverse_cleaned: cleaned,
    trace: 'cli',
  });

  return { path: remotePath, grantee: to, traverse_cleaned: cleaned };
}

async function revokeGrant(server, opts) {
  const { path: remotePath, to } = opts;
  const serverId = server.id || server.host;
  const data = load(serverId);

  const share = data.items.find(
    it => it.grantee === to && (
      it.path === remotePath ||
      remotePath.startsWith(it.path.replace(/\/$/, '') + '/')
    )
  );
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath} 或其父目录`);
  }

  await clearFile(server, remotePath, to);

  if (share.grants) {
    share.grants = share.grants.filter(g => g.path !== remotePath);
  }
  save(data);

  audit.write({
    server: server.id,
    action: 'share.revoke.grant',
    actor: server.username,
    target: remotePath,
    grantee: to,
    result: 'ok',
    trace: 'cli',
  });

  return { path: remotePath, grantee: to };
}

async function revokeContainer(server, opts) {
  const { path: remotePath, to } = opts;
  const serverId = server.id || server.host;
  const data = load(serverId);
  const share = data.items.find(it => it.path === remotePath && it.grantee === to);
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath}`);
  }
  if (share.target_type !== 'DIR') {
    throw new Error('NOT_A_DIR');
  }

  await clearContainerRecursive(server, remotePath, to);
  try { await ssh.exec(server, `setfacl -x u:${to} ${escapePath(remotePath)} 2>/dev/null; true`); } catch (_) {}

  share.container_perm = 'none';
  share.updated_at = new Date().toISOString();
  save(data);

  audit.write({
    server: server.id,
    action: 'share.revoke.container',
    actor: server.username,
    target: remotePath,
    grantee: to,
    result: 'ok',
    trace: 'cli',
  });

  return { path: remotePath, grantee: to, container_perm: 'none' };
}

async function revokeDefault(server, opts) {
  const { path: remotePath, to } = opts;
  const serverId = server.id || server.host;
  const data = load(serverId);
  const share = data.items.find(it => it.path === remotePath && it.grantee === to);
  if (!share) {
    throw new Error(`SHARE_NOT_FOUND: ${to} 未被分享 ${remotePath}`);
  }

  await clearDefault(server, remotePath, to);

  share.default_perm = null;
  share.updated_at = new Date().toISOString();
  save(data);

  audit.write({
    server: server.id,
    action: 'share.revoke.default',
    actor: server.username,
    target: remotePath,
    grantee: to,
    result: 'ok',
    trace: 'cli',
  });

  return { path: remotePath, grantee: to, default_perm: null };
}

/* ------------------------------------------------------------------ */
/* 8) 同步 share.sync                                                  */
/* ------------------------------------------------------------------ */

async function sync(server) {
  const data = load(server.id);
  const synced = [];
  for (const item of data.items) {
    try {
      const result = await ssh.exec(server, `getfacl ${escapePath(item.path)} 2>/dev/null`);
      synced.push({
        ...item,
        raw_acl: result.stdout,
        synced_at: new Date().toISOString(),
      });
    } catch {
      synced.push({ ...item, raw_acl: null, missing: true });
    }
  }
  data.items = synced;
  save(data);
  audit.write({
    server: server.id, action: 'share.sync', actor: server.username,
    result: 'ok', count: synced.length, trace: 'cli',
  });
  return synced;
}

/* ------------------------------------------------------------------ */
/* 9) ACL 工具检�?                                                    */
/* ------------------------------------------------------------------ */

async function checkAcl(server) {
  const result = await ssh.exec(server, 'which setfacl && setfacl --version');
  if (result.code === 0) {
    return { ready: true, version: result.stdout.trim() };
  }
  return { ready: false, hint: 'Ubuntu/Debian: sudo apt install acl' };
}

module.exports = {
  // CRUD
  add, list,
  grantFile, grantContainer, grantDir, setDefaultPerm,
  revokeAll, revokeGrant, revokeContainer, revokeDefault,
  sync, checkAcl,
  // 映射(供测�?
  PERM_FILE, CONTAINER_PERM, LEVEL_PRESET,
  // v2.4 兼容导出
  parentChain, ensureTraverseChain, cleanupOrphanTraverse, inspectAcl,
  // v2.5 工具
  detectType, applyContainer, applyFile, setDefault,
  applyFilesByPattern, applyAllFiles,
};