import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateMcp } from "../lib/validate-mcp.ts";

test("validates a low-level MCP server and extracts registered tool names", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-validator-test-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture-mcp",
        version: "1.0.0",
        description: "fixture",
        main: "index.ts",
        scripts: { typecheck: "tsc --noEmit", smoke: "node smoke.mjs" },
        dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
      }),
    );
    await writeFile(
      join(root, "index.ts"),
      'server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "hello" }] }));\n' +
        "server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [] }));\n",
    );
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "tests", "fixture.test.mjs"),
      'const fake = { tools: [{ name: "should-not-be-counted" }] };\n',
    );
    await writeFile(join(root, "README.md"), "# Fixture\n");

    const result = await validateMcp(root);
    assert.equal(result.ok, true);
    assert.equal(result.entrypoint, "index.ts");
    assert.deepEqual(result.toolNames, ["hello"]);
    assert.deepEqual(result.errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports missing package and entrypoint without touching the directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-validator-invalid-"));
  try {
    await mkdir(join(root, "src"));
    const result = await validateMcp(root);
    assert.equal(result.ok, false);
    assert.equal(result.files, 0);
    assert.ok(result.errors.some((item) => item.includes("package.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
