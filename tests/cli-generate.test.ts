import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGenerate } from "@/cli/generate";

const directories: string[] = [];

async function createProject() {
  const cwd = await mkdtemp(join(tmpdir(), "write-once-cli-"));
  directories.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runGenerate", () => {
  it("uses defaults and generates files without a config", async () => {
    const cwd = await createProject();
    await writeFile(join(cwd, "source.md"), "new source", "utf8");
    const destination = join(cwd, "README.md");
    await writeFile(destination, 'fragment source="./source.md"\nold\n/fragment', "utf8");

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(0);
    expect(result.written).toEqual([destination]);
    expect(await readFile(destination, "utf8")).toBe(
      'fragment source="./source.md"\nnew source\n/fragment',
    );
  });

  it("uses an explicit config path and reports config failures", async () => {
    const cwd = await createProject();
    await writeFile(join(cwd, "targets.json"), JSON.stringify({ include: ["README.md"] }), "utf8");
    const destination = join(cwd, "README.md");
    await writeFile(destination, "unmarked text", "utf8");

    const result = await runGenerate({ cwd, configPath: "targets.json" });

    expect(result.exitCode).toBe(0);
    expect(result.unchanged).toEqual([destination]);

    const missing = await runGenerate({ cwd, configPath: "missing.json" });
    expect(missing.exitCode).toBe(1);
    expect(missing.diagnostics[0]?.stage).toBe("config");
  });

  it("does not write any destination when one destination has invalid markers", async () => {
    const cwd = await createProject();
    const valid = join(cwd, "a.md");
    const invalid = join(cwd, "b.md");
    await writeFile(join(cwd, "source.md"), "new", "utf8");
    await writeFile(valid, 'fragment source="./source.md"\nold\n/fragment', "utf8");
    await writeFile(invalid, 'fragment source="./source.md"\nmissing closing marker', "utf8");

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.written).toEqual([]);
    expect(await readFile(valid, "utf8")).toBe('fragment source="./source.md"\nold\n/fragment');
    expect(result.diagnostics.some((diagnostic) => diagnostic.stage === "marker")).toBe(true);
  });
});
