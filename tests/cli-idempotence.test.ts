import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGenerate } from "@/cli/generate";

const directories: string[] = [];

async function createProject() {
  const cwd = await mkdtemp(join(tmpdir(), "write-once-idempotence-"));
  directories.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generation preservation and idempotence", () => {
  it("preserves CRLF and missing final newline, then becomes content-idempotent", async () => {
    const cwd = await createProject();
    const source = join(cwd, "source.md");
    const destination = join(cwd, "README.md");
    await writeFile(source, "new\ntext\n", "utf8");
    const original = [
      "unrelated prefix",
      '<!-- fragment source="./source.md" -->',
      "old content",
      "<!-- /fragment -->",
      "unrelated suffix",
    ].join("\r\n");
    await writeFile(destination, original, "utf8");

    const first = await runGenerate({ cwd });
    const expected = [
      "unrelated prefix",
      '<!-- fragment source="./source.md" -->',
      "new",
      "text",
      "<!-- /fragment -->",
      "unrelated suffix",
    ].join("\r\n");

    expect(first.exitCode).toBe(0);
    expect(await readFile(destination, "utf8")).toBe(expected);
    expect(expected.endsWith("\n")).toBe(false);

    const second = await runGenerate({ cwd });
    expect(second.exitCode).toBe(0);
    expect(second.written).toEqual([]);
    expect(second.unchanged).toHaveLength(2);
    expect(await readFile(destination, "utf8")).toBe(expected);
  });

  it("does not modify any file when one destination fails during extraction", async () => {
    const cwd = await createProject();
    const source = join(cwd, "source.md");
    const valid = join(cwd, "a.md");
    const invalid = join(cwd, "b.md");
    await writeFile(source, "source", "utf8");
    await writeFile(valid, 'fragment source="./source.md"\nold\n/fragment', "utf8");
    await writeFile(
      invalid,
      'fragment source="./source.md" name="missing"\nold\n/fragment',
      "utf8",
    );

    const beforeValid = await readFile(valid, "utf8");
    const beforeInvalid = await readFile(invalid, "utf8");
    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.written).toEqual([]);
    expect(await readFile(valid, "utf8")).toBe(beforeValid);
    expect(await readFile(invalid, "utf8")).toBe(beforeInvalid);
    expect(result.diagnostics.some((diagnostic) => diagnostic.stage === "extract")).toBe(true);
  });
});
