/**
 * safety.js - 沙箱拦截(需求 3 核心)
 *
 * 三层防线:
 *   1. safePath     - 所有路径必须落在 home 内
 *   2. safeSystemPath - 禁止系统目录
 *   3. safeCmd      - 危险命令黑名单
 *
 * 显式开关:
 *   - allowEscape  : 允许越界(需文档化理由)
 *   - allowSudo    : 允许 sudo
 */

'use strict';

const path = require('path');

// 危险命令黑名单
const BLOCKED_CMDS = [
  /\bsudo\b/,
  /\bsu\b/,
  /\brm\s+-rf?\s+\/\s*(?:$|[;&|])/,    // rm -rf / 行尾 或 后跟 ; & |
  /\brm\s+-rf?\s+\/(?:etc|usr|var|boot|proc|sys|dev|bin|sbin|lib|opt|root|run)\b/,  // rm -rf /系统目录
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+-R\s+777\b/,
  /\bcurl\s+[^|]*\|\s*(ba)?sh/,        // curl ... | sh
  /\bwget\s+[^|]*\|\s*(ba)?sh/,
  /:\(\)\s*\{.*:\|:.*\};:/,             // fork bomb: :(){ :|:& };:
  /\bnc\s+-l\b/,                        // 反弹 shell 监听
  /\bbash\s+-i\s+>&\s*\/dev\/tcp/,      // 反弹 shell
];

// 系统目录黑名单
const SYSTEM_PATHS = [
  '/etc', '/usr', '/var', '/boot',
  '/proc', '/sys', '/dev', '/sbin',
  '/bin', '/lib', '/lib64', '/opt',
  '/root', '/run',
];

/**
 * 检查路径是否落在 home 内
 * @param {string} home - 用户 home 目录
 * @param {string} remotePath - 待检查路径(支持 ~/ 前缀)
 * @param {object} opts - { allowEscape }
 * @returns {string} 规范化后的绝对路径
 */
function safePath(home, remotePath, opts = {}) {
  if (!remotePath) {
    throw new Error('PATH_EMPTY');
  }

  // 展开 ~/
  let p = remotePath;
  if (p.startsWith('~/') || p === '~') {
    p = path.posix.join(home, p.slice(1));
  }

  // 规范化
  const abs = path.posix.resolve(p);

  // 系统目录检查优先(无论是否在 home 内都生效)
  for (const sys of SYSTEM_PATHS) {
    if (abs === sys || abs.startsWith(sys + '/')) {
      const err = new Error(`SYSTEM_PATH_BLOCKED: ${abs}`);
      err.code = 'SYSTEM_PATH_BLOCKED';
      throw err;
    }
  }

  // home 检查
  if (abs !== home && !abs.startsWith(home + '/')) {
    if (opts.allowEscape) {
      return abs;
    }
    const err = new Error(`PATH_BLOCKED: ${remotePath} 超出 home 目录 ${home}`);
    err.code = 'PATH_BLOCKED';
    throw err;
  }

  return abs;
}

/**
 * 检查命令是否包含危险操作
 * @param {string} cmd - shell 命令
 * @param {object} opts - { allowSudo, allowEscape }
 */
function safeCmd(cmd, opts = {}) {
  if (!cmd || !cmd.trim()) {
    throw new Error('CMD_EMPTY');
  }

  // sudo/su 需要 allowSudo
  if ((/\bsudo\b/.test(cmd) || /\bsu\b/.test(cmd)) && !opts.allowSudo) {
    const err = new Error('CMD_BLOCKED: 命令包含 sudo/su,需要 --allow-sudo');
    err.code = 'CMD_BLOCKED';
    throw err;
  }

  // 其他危险命令
  for (const pat of BLOCKED_CMDS) {
    // 跳过 sudo/su 的检查(已处理)
    if (pat.source.includes('sudo') || pat.source.includes('\\bsu\\b')) continue;
    if (pat.test(cmd)) {
      const err = new Error(`CMD_BLOCKED: 命令匹配危险模式 ${pat}`);
      err.code = 'CMD_BLOCKED';
      throw err;
    }
  }

  return true;
}

/**
 * 判断操作是否需要二次确认
 */
function needsConfirm(action, opts = {}) {
  const HIGH_RISK = ['rm.recursive', 'batch.delete', 'chmod.recursive', 'chown', 'mv.overwrite'];
  return HIGH_RISK.includes(action) && !opts.skipConfirm;
}

/**
 * 等待用户输入 YES(从 stdin)
 */
async function confirm(prompt) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${prompt}\n请输入 YES 继续: `, answer => {
      rl.close();
      resolve(answer.trim() === 'YES');
    });
  });
}

/**
 * safeExecPaths - 从命令字符串中提取可疑路径并检查(用于 --sandbox)
 *
 * 提取模式:匹配绝对路径(以 / 开头)、~/ 开头、./ 开头
 * 对每个路径调用 safePath 检查
 *
 * @param {string} cmd - shell 命令
 * @param {string} home - 用户 home
 * @returns {Array} 发现的合规路径列表
 */
function safeExecPaths(cmd, home) {
  // 匹配:绝对路径(/开头)、~/开头、./开头
  // 注意:跳过被引号包围的简单参数、跳过命令名(如 /usr/bin/cat)
  const pathRegex = /(?:^|[\s;&|(])(~?\/|\.\/)[^\s'"]+/g;

  let match;
  const checked = [];

  while ((match = pathRegex.exec(cmd)) !== null) {
    const rawPath = match[1] === './' ? match[0].trim() : match[0].trim();
    // 提取路径部分(去掉前导空格/符号)
    const pathMatch = rawPath.match(/(~?\/|\.\/)[^\s'"]+/);
    if (!pathMatch) continue;

    const p = pathMatch[0];

    // 跳过常见可执行命令路径(已在 safeCmd 检查)
    if (/^\/(usr|bin|sbin|lib)\//.test(p)) continue;

    // 跳过 home 内的合法路径(直接调用,异常自然传播)
    const abs = safePath(home, p);
    checked.push(abs);
  }

  return checked;
}

module.exports = {
  safePath,
  safeCmd,
  safeExecPaths,
  needsConfirm,
  confirm,
  SYSTEM_PATHS,
  BLOCKED_CMDS,
};