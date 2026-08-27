/**
 * wizard.js - 交互式向导(零依赖,Node 内置 readline)
 *
 * 触发:node scripts/ssh-ops.js init(无参数)
 */

'use strict';

const readline = require('readline');

function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl, prompt, defaultValue) {
  return new Promise(resolve => {
    const hint = defaultValue !== undefined ? ` [${defaultValue}]` : '';
    rl.question(`${prompt}${hint}: `, answer => {
      const trimmed = answer.trim();
      resolve(trimmed === '' ? (defaultValue !== undefined ? defaultValue : '') : trimmed);
    });
  });
}

async function questionSecret(rl, prompt) {
  // 简化版:明文读取(生产建议用 raw mode + 屏蔽回显)
  return question(rl, prompt);
}

async function questionYesNo(rl, prompt, defaultYes = true) {
  const hint = defaultYes ? ' [Y/n]' : ' [y/N]';
  const answer = await question(rl, prompt + hint, '');
  if (answer === '') return defaultYes;
  return /^y(es)?$/i.test(answer);
}

/**
 * 初始化向导
 */
async function initWizard() {
  const rl = createRl();

  console.log('\n📦 文件管理 Skill 初始化向导');
  console.log('================================\n');

  try {
    const serverId = await question(rl, '[1/6] 服务器标识(英文/数字)', 'prod');
    if (!/^[a-zA-Z0-9_-]+$/.test(serverId)) {
      throw new Error('服务器标识只能包含字母、数字、下划线、横线');
    }

    const host = await question(rl, '[2/6] 服务器 IP 或域名', '');
    if (!host) throw new Error('IP/域名必填');

    const port = await question(rl, '     SSH 端口', '22');

    const adminUser = await question(rl, '[3/6] 管理员用户名(需 sudo)', 'root');
    const adminPassword = await questionSecret(rl, '     管理员密码');

    const createAgent = await questionYesNo(rl, '[4/6] 创建新 Agent 账号?', false);
    let agentUser, agentPassword;
    if (createAgent) {
      agentUser = await question(rl, '     Agent 用户名', 'claude_agent');
      agentPassword = await questionSecret(rl, '     Agent 密码');
    } else {
      agentUser = await question(rl, '     复用已有账号', adminUser);
    }

    const lockSudo = await questionYesNo(rl, '     禁用 Agent 账号的 sudo?', true);
    const installAcl = await questionYesNo(rl, '[5/6] 安装 ACL 工具(文件共享用)?', true);

    // v2.4: Agent home 改成 751,以便后续把 Agent 文件分享给其他用户无需手动加 traverse
    const shareHomeMode = await questionYesNo(
      rl,
      '[5.5/6] 是否将 Agent home 设为 751 (允许其他用户 traverse,推荐)?',
      true
    );

    console.log('\n[6/6] 验证');
    console.log('  正在准备绑定...');

    return {
      serverId,
      host,
      port: parseInt(port, 10) || 22,
      adminUser,
      adminPassword,
      createAgent,
      agentUser,
      agentPassword,
      lockSudo,
      installAcl,
      shareHomeMode,
    };
  } finally {
    rl.close();
  }
}

module.exports = { initWizard, question, questionYesNo, createRl };