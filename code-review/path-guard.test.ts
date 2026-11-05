import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { resolveAllowedPath } from "./path-guard.ts";

function setup() {
  // 本机 %TEMP% 目录写入受限（EPERM），测试改用仓库内临时目录
  const base = mkdtempSync(join(process.cwd(), ".tmp-cr-guard-"));
  const root = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "app.ts"), "export const a = 1;\n");
  writeFileSync(join(root, ".env"), "SECRET=1\n");
  writeFileSync(join(root, "id_rsa"), "PRIVATE KEY\n");
  writeFileSync(join(outside, "secret.ts"), "const leaked = 1;\n");
  return { base, root, outside };
}

test("允许目录内的普通文件可读", () => {
  const { root } = setup();
  const r = resolveAllowedPath(join(root, "app.ts"), { roots: [root] });
  assert.equal(r.ok, true);
});

test("目录外的文件被拒绝", () => {
  const { root, outside } = setup();
  const r = resolveAllowedPath(join(outside, "secret.ts"), { roots: [root] });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /不在允许目录内/);
});

test(".. 逃逸被拒绝", () => {
  const { root } = setup();
  const r = resolveAllowedPath(join(root, "..", "outside", "secret.ts"), { roots: [root] });
  assert.equal(r.ok, false);
});

test("符号链接指到外部被拒绝", () => {
  const { root, outside } = setup();
  const link = join(root, "link.ts");
  try {
    symlinkSync(join(outside, "secret.ts"), link);
  } catch {
    return; // 无权限创建符号链接时跳过
  }
  const r = resolveAllowedPath(link, { roots: [root] });
  assert.equal(r.ok, false);
});

test("凭据类文件被拒绝", () => {
  const { root } = setup();
  for (const name of [".env", "id_rsa"]) {
    const r = resolveAllowedPath(join(root, name), { roots: [root] });
    assert.equal(r.ok, false, `${name} 应被拒绝`);
    assert.match(r.error ?? "", /凭据|密钥/);
  }
});

test("目录与不存在的路径被拒绝", () => {
  const { root } = setup();
  assert.equal(resolveAllowedPath(root, { roots: [root] }).ok, false);
  assert.equal(resolveAllowedPath(join(root, "nope.ts"), { roots: [root] }).ok, false);
});

test("空路径被拒绝", () => {
  assert.equal(resolveAllowedPath("", { roots: ["/"] }).ok, false);
});
