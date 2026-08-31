/**
 * 命名规范化：只有用户明确标明的来源前缀才保留（如 ylx_ / clz_），
 * 未标明的 skill 保持原名（kebab-case / 下划线均可），不自动加前缀。
 */
/** 清洗目录名：转小写，保留连字符与下划线，非 [a-z0-9-] 连续压缩为单个 `_`，去首尾 `_`/`-` */
export function sanitizeDirName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

/** 合法 slug：小写字母开头，仅 a-z0-9_-，长度 2~64（允许 kebab-case） */
export function isValidSlug(name: string): boolean {
  return /^[a-z][a-z0-9_-]{1,63}$/.test(name);
}

export interface ResolveNameResult {
  name: string;
  ok: boolean;
  reason?: string;
}

/**
 * 解析发布目标名：
 * - 显式 new_name：**原样使用**（若带已知来源前缀 ylx_/clz_ 则自然保留，不带则不加前缀），
 *   不自动补前缀。含中文/非法字符返回错误（不自动音译）。
 * - 缺省：**清洗后的目录名**（保持原名风格，不加任何前缀）；
 *   清洗后为空（如纯中文/纯符号名）报错，要求显式 new_name。
 */
export function resolveTargetName(
  rawDirName: string,
  newName: string | undefined,
  _namespace: string,
  _namePrefixes: string[] = []
): ResolveNameResult {
  if (newName && newName.trim()) {
    const name = newName.trim().toLowerCase();
    if (/[^\x00-\x7f]/.test(name)) {
      return {
        name: "",
        ok: false,
        reason: `new_name 含非 ASCII 字符（如中文）：${newName}。请用英文 slug（如 ylx_pm25_analysis、clz_wechat_mp_ops 或 cnki-search）。`,
      };
    }
    if (!isValidSlug(name)) {
      return {
        name: "",
        ok: false,
        reason: `名称不合法：${newName}。须匹配 ^[a-z][a-z0-9_-]{1,63}$`,
      };
    }
    return { name, ok: true };
  }
  const cleaned = sanitizeDirName(rawDirName);
  if (!cleaned) {
    return {
      name: "",
      ok: false,
      reason: `目录名 "${rawDirName}" 清洗后为空（可能为纯中文/纯符号名），请显式传 new_name。`,
    };
  }
  if (!isValidSlug(cleaned)) {
    return {
      name: "",
      ok: false,
      reason: `自动生成名称不合法：${cleaned}`,
    };
  }
  return { name: cleaned, ok: true };
}
