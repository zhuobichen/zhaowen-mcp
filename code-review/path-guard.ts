/**
 * 路径守卫：把 review_file 能读的范围钉死在允许目录内。
 *
 * 审计项：原来 `review_file` 接受任意绝对路径并把内容发到外部 LLM。
 * 这里做三件事：
 *   1. realpath 解析（符号链接会被解到真实位置，`..` 也一并归一）
 *   2. 必须落在允许目录内（默认 cwd，可用 REVIEW_ALLOWED_DIRS 覆盖）
 *   3. 命中敏感文件名直接拒绝（.env / 私钥 / 凭据文件等）
 */
import { realpathSync, statSync } from "fs";
import { delimiter, resolve, sep } from "path";

export interface ResolveResult {
  ok: boolean;
  path?: string;
  error?: string;
}

const DEFAULT_DENY: RegExp[] = [
  /(^|[\\/])\.env(\.[^\\/]*)?$/i,
  /(^|[\\/])\.git-credentials$/i,
  /(^|[\\/])\.npmrc$/i,
  /(^|[\\/])\.pypirc$/i,
  /(^|[\\/])(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/i,
  /(^|[\\/])credentials(\.[^\\/]*)?$/i,
  /(^|[\\/])secrets?(\.[^\\/]*)?\.(json|ya?ml|txt|env)$/i,
  /\.(pem|key|p12|pfx|kdbx|keystore|jks)$/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
];

/** 允许目录：REVIEW_ALLOWED_DIRS 用系统分隔符（Windows 是 ;）拆分，默认当前工作目录。 */
export function defaultRoots(): string[] {
  const env = process.env.REVIEW_ALLOWED_DIRS;
  const raw = env
    ? env.split(delimiter).map((s) => s.trim()).filter(Boolean)
    : [process.cwd()];
  return raw.map((p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  });
}

function within(target: string, root: string): boolean {
  const r = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(r);
}

export function resolveAllowedPath(
  filePath: string,
  opts: { roots?: string[]; denyPatterns?: RegExp[] } = {}
): ResolveResult {
  if (!filePath || !filePath.trim()) {
    return { ok: false, error: "file_path 不能为空" };
  }

  let real: string;
  try {
    real = realpathSync(resolve(filePath));
  } catch {
    return { ok: false, error: `文件不存在或不可访问: ${filePath}` };
  }

  const roots = opts.roots ?? defaultRoots();
  if (!roots.some((root) => within(real, root))) {
    return {
      ok: false,
      error: `拒绝读取：路径不在允许目录内。允许目录：${roots.join("、")}（可用 REVIEW_ALLOWED_DIRS 配置）`,
    };
  }

  const deny = opts.denyPatterns ?? DEFAULT_DENY;
  const base = real.split(/[\\/]/).pop() ?? "";
  if (deny.some((re) => re.test(real) || re.test(base))) {
    return { ok: false, error: `拒绝读取：${base} 疑似含凭据/密钥，不发送到外部模型` };
  }

  try {
    if (!statSync(real).isFile()) {
      return { ok: false, error: `不是普通文件: ${filePath}` };
    }
  } catch {
    return { ok: false, error: `无法读取文件状态: ${filePath}` };
  }

  return { ok: true, path: real };
}
