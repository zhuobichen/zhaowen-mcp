import { promises as fs } from "fs";
import * as path from "path";

export interface McpValidationResult {
  ok: boolean;
  mcpDir: string;
  files: number;
  packageName?: string;
  version?: string;
  entrypoint?: string;
  toolNames: string[];
  errors: string[];
  warnings: string[];
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "reports",
  "__pycache__",
  ".venv",
  "venv",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const SOURCE_SKIP_DIRS = new Set(["test", "tests", "__tests__", "fixtures", "examples"]);

async function collectFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await collectFiles(full)));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayBody(source: string, openAt: number): string | undefined {
  if (source[openAt] !== "[") return undefined;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openAt; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(openAt + 1, index);
    }
  }
  return undefined;
}

function sourceToolNames(source: string): string[] {
  const names = new Set<string>();
  const registerTool = /\bregisterTool\(\s*["'`]([^"'`]+)["'`]/g;
  const serverTool = /\bserver\.tool\(\s*["'`]([^"'`]+)["'`]/g;
  for (const pattern of [registerTool, serverTool]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) names.add(match[1]);
  }
  // The low-level Server API declares tools in one or more `tools: []` arrays.
  const toolsArray = /\btools\s*:\s*\[/g;
  let arrayMatch: RegExpExecArray | null;
  while ((arrayMatch = toolsArray.exec(source)) !== null) {
    const body = arrayBody(source, arrayMatch.index + arrayMatch[0].length - 1);
    if (!body) continue;
    const objectName = /\bname\s*:\s*["'`]([^"'`]+)["'`]/g;
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = objectName.exec(body)) !== null) {
      names.add(nameMatch[1]);
    }
  }
  return [...names].sort();
}

/** Read-only structural checks for an MCP service before publishing it. */
export async function validateMcp(inputDir: string, strict = false): Promise<McpValidationResult> {
  const mcpDir = path.resolve(inputDir);
  const errors: string[] = [];
  const warnings: string[] = [];
  const result: McpValidationResult = {
    ok: false,
    mcpDir,
    files: 0,
    toolNames: [],
    errors,
    warnings,
  };

  let stat;
  try {
    stat = await fs.stat(mcpDir);
  } catch {
    errors.push(`目录不存在: ${mcpDir}`);
    return result;
  }
  if (!stat.isDirectory()) {
    errors.push(`不是目录: ${mcpDir}`);
    return result;
  }

  const packagePath = path.join(mcpDir, "package.json");
  let packageData: Record<string, unknown>;
  try {
    packageData = JSON.parse(await fs.readFile(packagePath, "utf8")) as Record<string, unknown>;
    if (!isRecord(packageData)) throw new Error("package.json 顶层必须是对象");
  } catch (error) {
    errors.push(`package.json 不可读或不是有效 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  result.packageName = asString(packageData.name);
  result.version = asString(packageData.version);
  if (!result.packageName) errors.push("package.json 缺少 name");
  if (!result.version) warnings.push("package.json 缺少 version，发布后难以追踪版本");

  const declaredMain = asString(packageData.main);
  const candidates = [
    ...(declaredMain ? [declaredMain] : []),
    "index.ts",
    "src/index.ts",
    "index.js",
    "src/index.js",
    "index.mjs",
    "src/index.mjs",
  ];
  const seenCandidates = new Set<string>();
  let entrypointPath: string | undefined;
  for (const candidate of candidates) {
    if (seenCandidates.has(candidate)) continue;
    seenCandidates.add(candidate);
    try {
      const candidatePath = path.resolve(mcpDir, candidate);
      if (!candidatePath.startsWith(`${mcpDir}${path.sep}`)) continue;
      const candidateStat = await fs.stat(candidatePath);
      if (candidateStat.isFile()) {
        entrypointPath = candidatePath;
        break;
      }
    } catch {
      // Try the next conventional source entrypoint.
    }
  }
  if (!entrypointPath) {
    errors.push("未找到 MCP 入口文件（检查 package.json main、index.ts 或 src/index.ts）");
  } else {
    result.entrypoint = path.relative(mcpDir, entrypointPath) || path.basename(entrypointPath);
    if (declaredMain && path.resolve(mcpDir, declaredMain) !== entrypointPath) {
      warnings.push(`package.json main 指向不存在的文件: ${declaredMain}；当前按 ${result.entrypoint} 检查源码`);
    }
  }

  const files = await collectFiles(mcpDir);
  result.files = files.length;
  if (!files.some((file) => path.basename(file).toLowerCase() === "readme.md")) {
    (strict ? errors : warnings).push("缺少 README.md，使用者无法获知启动和环境变量配置");
  }

  const packageScripts = isRecord(packageData.scripts) ? packageData.scripts : {};
  if (!asString(packageData.description)) warnings.push("package.json 缺少 description");
  if (!("typecheck" in packageScripts)) warnings.push("未提供 npm run typecheck 脚本");
  if (!("test" in packageScripts) && !("smoke" in packageScripts)) {
    warnings.push("未提供 npm run test 或 npm run smoke 脚本");
  }
  const dependencies = {
    ...(isRecord(packageData.dependencies) ? packageData.dependencies : {}),
    ...(isRecord(packageData.devDependencies) ? packageData.devDependencies : {}),
  };
  if (!("@modelcontextprotocol/sdk" in dependencies)) {
    warnings.push("未声明 @modelcontextprotocol/sdk 依赖；如使用远程/封装运行时，请在 README 中说明");
  }

  const sourceFiles = files.filter((file) => {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
    const relativeParts = path.relative(mcpDir, file).split(path.sep);
    return !relativeParts.some((part) => SOURCE_SKIP_DIRS.has(part.toLowerCase()));
  });
  let source = "";
  for (const file of sourceFiles) {
    try {
      source += `\n${await fs.readFile(file, "utf8")}`;
    } catch {
      warnings.push(`无法读取源码文件: ${path.relative(mcpDir, file)}`);
    }
  }
  const hasToolListing = /ListToolsRequestSchema|registerTool\s*\(|server\.tool\s*\(/u.test(source);
  const hasCallHandler = /CallToolRequestSchema|server\.connect\s*\(/u.test(source);
  if (!hasToolListing) {
    (strict ? errors : warnings).push("未识别到工具注册或 tools/list 处理器");
  }
  if (!hasCallHandler) {
    (strict ? errors : warnings).push("未识别到 tools/call 处理器或 server.connect 调用");
  }
  result.toolNames = sourceToolNames(source);
  if (result.toolNames.length === 0) warnings.push("未能静态提取工具名称，请通过 MCP 客户端做一次 tools/list smoke test");

  result.ok = errors.length === 0;
  return result;
}
