import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
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
  it("uses the process working directory when cwd is omitted", async () => {
    const cwd = await createProject();
    await writeFile(join(cwd, "README.md"), "plain text", "utf8");
    const previous = process.cwd();

    try {
      process.chdir(cwd);
      const result = await runGenerate();
      expect(result.exitCode).toBe(0);
      expect(result.unchanged).toEqual([join(cwd, "README.md")]);
    } finally {
      process.chdir(previous);
    }
  });

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

  it("handles sources larger than the content budget in the staged pipeline", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    await writeFile(join(cwd, "one.md"), "first source content larger than budget", "utf8");
    await writeFile(join(cwd, "two.md"), "second source content larger than budget", "utf8");
    await writeFile(
      destination,
      [
        'fragment source="./one.md"',
        "old one",
        "/fragment",
        'fragment source="./two.md"',
        "old two",
        "/fragment",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(cwd, "write-once.config.json"),
      JSON.stringify({ include: ["README.md"], memoryBudgetMiB: 0.00001, maxConcurrency: 2 }),
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(0);
    const output = await readFile(destination, "utf8");
    expect(output).toContain("first source content larger than budget");
    expect(output).toContain("second source content larger than budget");
  });

  it("cleans spilled source content when generation fails after loading sources", async () => {
    const before = new Set(await readdir(tmpdir()));
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    await writeFile(join(cwd, "one.md"), "first source\nsecond line", "utf8");
    await writeFile(join(cwd, "two.md"), "another source\nanother line", "utf8");
    await writeFile(
      destination,
      [
        'fragment source="./one.md"',
        "old one",
        "/fragment",
        'fragment source="./two.md" range="99:1-100:1"',
        "old two",
        "/fragment",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(cwd, "write-once.config.json"),
      JSON.stringify({ include: ["README.md"], memoryBudgetMiB: 0.00001, maxConcurrency: 1 }),
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.written).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    const leftovers = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("write-once-content-") && !before.has(name),
    );
    expect(leftovers).toEqual([]);
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

  it("returns a discovery error when the root .gitignore cannot be read", async () => {
    const cwd = await createProject();
    await mkdir(join(cwd, ".gitignore"));
    await writeFile(join(cwd, "README.md"), "plain text", "utf8");

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.plannedCount).toBe(0);
    expect(result.diagnostics).toMatchObject([{ stage: "discovery", severity: "error" }]);
    expect(await readFile(join(cwd, "README.md"), "utf8")).toBe("plain text");
  });

  it("reports a preparer trigger failure without writing destination files", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    await writeFile(join(cwd, "source.md"), "new", "utf8");
    await writeFile(destination, 'fragment source="repo:source.md"\nold\n/fragment', "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `export default { preparers: [{ id: "broken", canPrepare() { throw new Error("trigger broke"); }, prepare() { return { resources: [] }; } }] };`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toMatchObject([
      { stage: "prepare", message: expect.stringContaining("Preparer trigger") },
    ]);
    expect(await readFile(destination, "utf8")).toBe(
      'fragment source="repo:source.md"\nold\n/fragment',
    );
  });

  it("reports write conflicts if a hook changes a destination after planning starts", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    await writeFile(join(cwd, "source.md"), "new", "utf8");
    await writeFile(destination, 'fragment source="./source.md"\nold\n/fragment', "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `import { writeFile } from "node:fs/promises";
export default { hooks: [{ id: "mutate-destination", stage: "pre-write", async run(context) { await writeFile(context.destination, "changed externally", "utf8"); return { text: context.content }; } }] };`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.stage === "write" && diagnostic.message.includes("changed after planning"),
      ),
    ).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("changed externally");
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
