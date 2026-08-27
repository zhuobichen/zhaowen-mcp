/**
 * 命名规范化：ylx_用途_名称（下划线，ylx 为来源标记前缀）。
 */
/** 清洗目录名：转小写，非 [a-z0-9] 连续压缩为单个 `_`，去首尾 `_` */
export function sanitizeDirName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** 合法 slug：小写字母开头，仅 a-z0-9_，长度 2~64 */
export function isValidSlug(name: string): boolean {
  return /^[a-z][a-z0-9_]{1,63}$/.test(name);
}

export interface ResolveNameResult {
  name: string;
  ok: boolean;
  reason?: string;
}

/**
 * 解析发布目标名：
 * - 显式 new_name：自动补 `namespace_` 前缀（若缺），校验 slug；
 *   含中文/非法字符返回错误（不自动音译）。
 * - 缺省：`namespace_<清洗后目录名>`；清洗后为空（如全中文目录名）报错，要求显式 new_name。
 */
export function resolveTargetName(
  rawDirName: string,
  newName: string | undefined,
  namespace: string
): ResolveNameResult {
  const prefix = `${namespace}_`;
  if (newName && newName.trim()) {
    let name = newName.trim().toLowerCase();
    if (/[^\x00-\x7f]/.test(name)) {
      return {
        name: "",
        ok: false,
        reason: `new_name 含非 ASCII 字符（如中文）：${newName}。请用英文 slug（如 ylx_pm25_analysis）。`,
      };
    }
    if (!name.startsWith(prefix)) name = prefix + name;
    if (!isValidSlug(name)) {
      return {
        name: "",
        ok: false,
        reason: `名称不合法：${newName}。须匹配 ^[a-z][a-z0-9_]{1,63}$`,
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
  const name = prefix + cleaned;
  if (!isValidSlug(name)) {
    return {
      name: "",
      ok: false,
      reason: `自动生成名称不合法：${name}`,
    };
  }
  return { name, ok: true };
}
