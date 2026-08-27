/**
 * errors.js - 友好错误信息(需求 v2.3 友好化)
 *
 * 错误码 → 标题 + 原因 + 修复建议
 */

'use strict';

const ERROR_TIPS = {
  NEED_INSTALL: {
    title: 'ssh2 依赖未找到',
    cause: '这是 Claude Code Skill 文件管理的核心依赖,首次使用前需安装。',
    fix: '运行 node scripts/install.js 安装,或自动安装?',
  },
  SSH_FAIL: {
    title: 'SSH 连接失败',
    cause: '无法建立到服务器的 SSH 连接。',
    fix: [
      '检查 IP/域名是否正确',
      '检查服务器 sshd: systemctl status sshd',
      '检查防火墙: ufw status / iptables -L',
      '检查安全组(云服务器)',
    ],
  },
  PATH_BLOCKED: {
    title: '路径越界',
    cause: 'Agent 账号被限制在 home 目录内。',
    fix: [
      '改用 ~/ 开头的相对路径',
      '如必须访问系统路径,用 --allow-escape 显式允许',
    ],
  },
  SYSTEM_PATH_BLOCKED: {
    title: '系统目录禁止访问',
    cause: '为安全起见,/etc /usr /var /boot 等系统目录始终禁止。',
    fix: '如需修改系统配置,请用管理员账号手动操作。',
  },
  CMD_BLOCKED: {
    title: '危险命令被拦截',
    cause: '命令匹配安全黑名单(sudo/su/rm -rf / / mkfs 等)。',
    fix: [
      '检查命令是否真的必要',
      '如确实需要,用 --allow-sudo / --allow-escape 显式允许',
      '建议拆分命令,用高层操作替代',
    ],
  },
  NO_DEFAULT_SERVER: {
    title: '未指定服务器',
    cause: '未通过 --server 指定,也未设置默认 server。',
    fix: [
      '命令行指定: --server prod',
      '设置环境变量: export FM_DEFAULT_SERVER=prod',
      '设置默认: 编辑 ~/.file-manager/servers.json 的 default 字段',
    ],
  },
  SERVER_NOT_FOUND: {
    title: '服务器未绑定',
    cause: '指定的 server-id 不在 servers.json 中。',
    fix: '先运行 node scripts/ssh-ops.js bind 或 init 绑定服务器。',
  },
  PERMISSION_DENIED: {
    title: '文件权限不足',
    cause: '当前用户无权访问该文件。',
    fix: [
      '检查文件权限: ls -l <path>',
      '用 chmod 调整(需 allowSudo)',
      '联系文件所有者',
    ],
  },
  ACL_FAILED: {
    title: 'ACL 操作失败',
    cause: 'setfacl/getfacl 执行失败,通常是 ACL 工具未安装或权限不足。',
    fix: [
      'Ubuntu/Debian: sudo apt install acl',
      'CentOS/RHEL: sudo yum install acl',
      '检查文件系统是否支持 ACL(mount 选项 acl)',
    ],
  },
  PARENT_TOO_RESTRICTIVE: {
    title: '父目录权限不足',
    cause: '被分享路径上的某个父目录(如 /home/<用户>)权限过严(700),无法自动加 traverse (--x) 让被分享人穿透。',
    fix: [
      '联系该目录的所有者,确认是否同意分享',
      '由所有者执行 setfacl -m u:<grantee>:--x <目录> 后再试',
      '或将目标挪到 home 之外的公共位置',
    ],
  },
  SERVERS_FILE_CORRUPT: {
    title: 'servers.json 文件损坏',
    cause: 'JSON 解析失败。',
    fix: [
      '检查文件: cat ~/.file-manager/servers.json',
      '如确认损坏,从备份恢复或手动重建',
    ],
  },
};

function format(code, _ctx = {}) {
  const tpl = ERROR_TIPS[code];
  if (!tpl) return code;

  let msg = `❌ ${tpl.title}\n`;
  msg += `   ${tpl.cause}\n`;
  if (Array.isArray(tpl.fix)) {
    msg += '   建议:\n';
    tpl.fix.forEach(line => { msg += `   - ${line}\n`; });
  } else {
    msg += `   ${tpl.fix}\n`;
  }
  return msg;
}

function handle(err) {
  const code = err.code || err.message;
  if (ERROR_TIPS[code]) {
    console.error(format(code));
  } else {
    console.error('❌', err.message || err);
  }
  process.exit(1);
}

module.exports = { format, handle, ERROR_TIPS };