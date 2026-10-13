import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DestinationPlan } from "@/generation-plan";

import { writeDestinationPlans } from "@/safe-write";

const directories: string[] = [];

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "write-once-write-"));
  directories.push(root);
  return root;
}

function plan(destination: string, originalText: string, outputText: string): DestinationPlan {
  return { destination, originalText, outputText, replacements: [] };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("writeDestinationPlans", () => {
  it("rejects duplicate destinations before staging and preserves their content", async () => {
    const root = await createProject();
    const destination = join(root, "README.md");
    await writeFile(destination, "original", "utf8");

    const result = await writeDestinationPlans([
      plan(destination, "original", "first output"),
      plan(destination, "original", "second output"),
    ]);

    expect(result.written).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("appears more than once");
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(root)).toEqual(["README.md"]);
  });

  it("reports a missing destination as a staging failure without creating files", async () => {
    const root = await createProject();
    const destination = join(root, "missing.md");

    const result = await writeDestinationPlans([plan(destination, "old", "new")]);

    expect(result.written).toEqual([]);
    expect(result.diagnostics).toMatchObject([
      {
        stage: "write",
        file: destination,
        message: expect.stringContaining("Could not stage destination output"),
      },
    ]);
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses to overwrite a destination changed after planning", async () => {
    const root = await createProject();
    const destination = join(root, "README.md");
    await writeFile(destination, "newer content", "utf8");

    const result = await writeDestinationPlans([
      plan(destination, "old planned content", "generated"),
    ]);

    expect(result.written).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("changed after planning");
    expect(await readFile(destination, "utf8")).toBe("newer content");
    expect(await readdir(root)).toEqual(["README.md"]);
  });

  it("atomically replaces changed files and preserves file permissions", async () => {
    const root = await createProject();
    const destination = join(root, "README.md");
    await writeFile(destination, "old\r\ncontent", { encoding: "utf8", mode: 0o640 });
    const before = await stat(destination);

    const result = await writeDestinationPlans([
      plan(destination, "old\r\ncontent", "new\r\ncontent"),
    ]);

    expect(result.written).toEqual([destination]);
    expect(result.diagnostics).toEqual([]);
    expect(await readFile(destination, "utf8")).toBe("new\r\ncontent");
    expect((await stat(destination)).mode & 0o777).toBe(before.mode & 0o777);
    expect((await readdir(root)).toSorted()).toEqual(["README.md"]);
  });

  it("does not rewrite unchanged files", async () => {
    const root = await createProject();
    const destination = join(root, "README.md");
    await writeFile(destination, "same", "utf8");
    const before = await stat(destination);

    const result = await writeDestinationPlans([plan(destination, "same", "same")]);

    expect(result.unchanged).toEqual([destination]);
    expect(result.written).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect((await stat(destination)).mtimeMs).toBe(before.mtimeMs);
  });

  it("refuses stale plans before modifying any destination", async () => {
    const root = await createProject();
    const first = join(root, "a.md");
    const second = join(root, "b.md");
    await writeFile(first, "old-a", "utf8");
    await writeFile(second, "newer-b", "utf8");

    const result = await writeDestinationPlans([
      plan(first, "old-a", "generated-a"),
      plan(second, "old-b", "generated-b"),
    ]);

    expect(result.written).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ severity: "error", stage: "write", file: second }]);
    expect(await readFile(first, "utf8")).toBe("old-a");
    expect(await readFile(second, "utf8")).toBe("newer-b");
  });

  it("stages all files before replacing any and rejects duplicate destinations", async () => {
    const root = await createProject();
    const first = join(root, "a.md");
    const missing = join(root, "missing.md");
    await writeFile(first, "old", "utf8");

    const result = await writeDestinationPlans([
      plan(first, "old", "new"),
      plan(missing, "old-missing", "new-missing"),
    ]);

    expect(result.written).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(await readFile(first, "utf8")).toBe("old");

    const duplicate = await writeDestinationPlans([
      plan(first, "old", "one"),
      plan(first, "old", "two"),
    ]);
    expect(duplicate.written).toEqual([]);
    expect(duplicate.diagnostics[0]?.message).toContain("appears more than once");
  });

  it("leaves no temporary sibling files after a successful write", async () => {
    const root = await createProject();
    const destination = join(root, "README.md");
    await writeFile(destination, "original", "utf8");
    const result = await writeDestinationPlans([plan(destination, "original", "replacement")]);

    expect(result.written).toEqual([destination]);
    expect(await readFile(destination, "utf8")).toBe("replacement");
    expect((await readdir(root)).toSorted()).toEqual(["README.md"]);
  });
});
