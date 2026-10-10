import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "../lib/skills.ts";
import { validateSkill } from "../lib/validate.ts";

test("parses folded multiline descriptions used by upstream skills", () => {
  const parsed = parseFrontmatter(`---\nname: example-skill\ndescription: >\n  First line of the description.\n  Second line explains the boundary.\n---\n\n# Example\n`);
  assert.equal(parsed.name, "example-skill");
  assert.equal(parsed.description, "First line of the description. Second line explains the boundary.");
});

test("parses literal multiline descriptions and quoted scalars", () => {
  const parsed = parseFrontmatter(`---\nname: 'quoted-skill'\ndescription: |-\n  Keep this line.\n  Keep this line too.\n---\n`);
  assert.equal(parsed.name, "quoted-skill");
  assert.equal(parsed.description, "Keep this line.\nKeep this line too.");
});

test("validates a skill directory without requiring a network or repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-manager-test-"));
  const skillDir = join(root, "example-skill");
  try {
    await mkdir(join(skillDir, "agents"), { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: example-skill\ndescription: >\n  A test skill.\n---\n\nRead [the reference](references/guide.md).\n",
    );
    await mkdir(join(skillDir, "references"));
    await writeFile(join(skillDir, "references", "guide.md"), "# Guide\n");
    await writeFile(join(skillDir, "agents", "openai.yaml"), "interface:\n  display_name: Example\n");

    const result = await validateSkill(skillDir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
