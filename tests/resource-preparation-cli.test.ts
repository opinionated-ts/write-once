import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGenerate } from "@/cli/generate";

const directories: string[] = [];

async function createProject() {
  const cwd = await mkdtemp(join(tmpdir(), "write-once-preparation-"));
  directories.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("resource preparation", () => {
  it("batches references across destinations before resolving and exposes results to resolvers", async () => {
    const cwd = await createProject();
    await mkdir(join(cwd, "docs"));
    const first = join(cwd, "README.md");
    const second = join(cwd, "docs", "GUIDE.md");
    await writeFile(first, 'fragment source="repo:first"\nold\n/fragment', "utf8");
    await writeFile(second, 'fragment source="repo:second"\nold\n/fragment', "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default {
  include: ["**/*.md"],
  preparers: [{
    id: "repo",
    canPrepare: (reference) => reference.source.startsWith("repo:"),
    async prepare(references, context) {
      await appendFile(join(context.cwd, "events.log"), "prepare:" + references.length + "\\n");
      await mkdir(join(context.workingDirectory, "one"), { recursive: true });
      await mkdir(join(context.workingDirectory, "two"), { recursive: true });
      await writeFile(join(context.workingDirectory, "one", "source.md"), "prepared content");
      await writeFile(join(context.workingDirectory, "two", "source.md"), "prepared content");
      await writeFile(join(context.cwd, "prep.json"), JSON.stringify({
        count: references.length,
        workingDirectory: context.workingDirectory,
      }));
      return {
        resources: [
          { root: join(context.workingDirectory, "one"), references: [references[0]] },
          { root: join(context.workingDirectory, "two"), references: references.slice(1) },
        ],
        value: { count: references.length },
      };
    },
  }],
  resolvers: [{
    id: "repo",
    canResolve: (source) => source.startsWith("repo:"),
    async resolve(source, context) {
      await appendFile(join(context.cwd, "events.log"), "resolve\\n");
      const preparedResource = context.preparations?.[0]?.result.resources.find((resource) =>
        resource.references.some((reference) => reference.source === source),
      );
      if (preparedResource === undefined) throw new Error("Prepared resource mapping missing.");
      return { root: preparedResource.root, path: "source.md" };
    },
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });
    const preparation: unknown = JSON.parse(await readFile(join(cwd, "prep.json"), "utf8"));
    const events = (await readFile(join(cwd, "events.log"), "utf8")).trim().split("\n");

    expect(result.exitCode).toBe(0);
    expect(preparation).toMatchObject({ count: 2 });
    expect(preparation).toHaveProperty("workingDirectory");
    const workingDirectory =
      typeof preparation === "object" && preparation !== null && "workingDirectory" in preparation
        ? String(preparation.workingDirectory)
        : "";
    expect(workingDirectory).toContain(join("write-once", "repo-"));
    let workingDirectoryExists = true;
    try {
      await access(workingDirectory);
    } catch {
      workingDirectoryExists = false;
    }
    expect(workingDirectoryExists).toBe(false);
    expect(events).toEqual(["prepare:2", "resolve", "resolve"]);
    expect(await readFile(first, "utf8")).toContain("prepared content");
    expect(await readFile(second, "utf8")).toContain("prepared content");
  });

  it("fails generation and preserves destinations when a selected preparer fails", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    const original = 'fragment source="repo:missing"\nold\n/fragment';
    await writeFile(destination, original, "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `export default {
  include: ["README.md"],
  preparers: [{
    id: "repo",
    canPrepare: () => true,
    prepare: async () => {
      throw new Error("provider unavailable");
    },
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]?.stage).toBe("prepare");
    expect(result.diagnostics[0]?.message).toContain('Preparer "repo" failed');
    expect(await readFile(destination, "utf8")).toBe(original);
  });
});
