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
          {
            root: join(context.workingDirectory, "one"),
            metadata: { source: references[0]?.source, path: "source.md" },
          },
          {
            root: join(context.workingDirectory, "two"),
            metadata: { source: references[1]?.source, path: "source.md" },
          },
        ],
        metadata: { count: references.length },
      };
    },
  }],
  resolvers: [{
    id: "repo",
    canResolve: (source) => source.startsWith("repo:"),
    async resolve(source, context) {
      await appendFile(join(context.cwd, "events.log"), "resolve\\n");
      const preparation = context.preparation?.result;
      if (preparation?.metadata?.count !== 2) throw new Error("Batch metadata missing.");
      const preparedResource = preparation.resources.find(
        (resource) => resource.metadata?.source === source,
      );
      if (preparedResource === undefined) throw new Error("Prepared resource mapping missing.");
      return {
        root: preparedResource.root,
        path: String(preparedResource.metadata?.path),
      };
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

  it("allows one prepared root to satisfy multiple references", async () => {
    const cwd = await createProject();
    const first = join(cwd, "README.md");
    const second = join(cwd, "GUIDE.md");
    await writeFile(first, 'fragment source="example:first.md"\nold\n/fragment', "utf8");
    await writeFile(second, 'fragment source="example:second.md"\nold\n/fragment', "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default {
  include: ["README.md", "GUIDE.md"],
  preparers: [{
    id: "example",
    canPrepare: (reference) => reference.source.startsWith("example:"),
    async prepare(references, context) {
      const root = context.workingDirectory;
      await mkdir(root, { recursive: true });
      for (const reference of references) {
        const name = reference.source.slice("example:".length);
        await writeFile(join(root, name), name, "utf8");
      }
      return { resources: [{ root }] };
    },
  }],
  resolvers: [{
    id: "example",
    canResolve: (source, context) => source.startsWith("example:") && context.preparation !== undefined,
    resolve: (source, context) => ({
      root: context.preparation!.result.resources[0]!.root,
      path: source.slice("example:".length),
    }),
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(0);
    expect(await readFile(first, "utf8")).toContain("first");
    expect(await readFile(second, "utf8")).toContain("second");
  });

  it("rejects prepared resources whose roots escape the assigned working directory", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    const original = 'fragment source="repo:outside"\nold\n/fragment';
    await writeFile(destination, original, "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `export default {
  include: ["README.md"],
  preparers: [{
    id: "repo",
    canPrepare: () => true,
    prepare: async (references) => ({
      resources: [{ root: "../../outside" }],
    }),
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        stage: "prepare",
        message: expect.stringContaining("must remain inside"),
      },
    ]);
    expect(await readFile(destination, "utf8")).toBe(original);
  });

  it("rejects resolver roots not declared by the assigned preparation", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    const original = 'fragment source="repo:unrelated"\nold\n/fragment';
    await writeFile(destination, original, "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default {
  include: ["README.md"],
  preparers: [{
    id: "repo",
    canPrepare: () => true,
    async prepare(_references, context) {
      await mkdir(join(context.workingDirectory, "declared"));
      await mkdir(join(context.workingDirectory, "unrelated"));
      await writeFile(join(context.workingDirectory, "declared", "source.md"), "prepared");
      await writeFile(join(context.workingDirectory, "unrelated", "source.md"), "unrelated");
      return { resources: [{ root: join(context.workingDirectory, "declared") }] };
    },
  }],
  resolvers: [{
    id: "repo",
    canResolve: (source) => source.startsWith("repo:"),
    resolve: (_source, context) => ({
      root: join(context.preparation!.workingDirectory, "unrelated"),
      path: "source.md",
    }),
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]).toMatchObject({
      stage: "resolve",
      source: "repo:unrelated",
      message: expect.stringContaining("not declared by the assigned preparation"),
    });
    expect(result.diagnostics[0]?.message).toContain("unrelated");
    expect(await readFile(destination, "utf8")).toBe(original);
  });

  it.each(["resource", "batch"])("rejects non-object %s metadata", async (scope) => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    const original = 'fragment source="repo:invalid-metadata"\nold\n/fragment';
    await writeFile(destination, original, "utf8");
    const resourceMetadata =
      scope === "resource" ? "metadata: []" : "metadata: { source: references[0]?.source }";
    const batchMetadata =
      scope === "batch" ? "metadata: []" : "metadata: { count: references.length }";
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `export default {
  include: ["README.md"],
  preparers: [{
    id: "repo",
    canPrepare: () => true,
    prepare: async (references, context) => ({
      resources: [{ root: context.workingDirectory, ${resourceMetadata} }],
      ${batchMetadata},
    }),
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]).toMatchObject({
      stage: "prepare",
      message: expect.stringContaining("valid prepared resources and object metadata"),
    });
    expect(await readFile(destination, "utf8")).toBe(original);
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
