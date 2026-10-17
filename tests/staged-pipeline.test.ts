import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGenerate } from "@/cli/generate";

const directories: string[] = [];

async function createProject() {
  const cwd = await mkdtemp(join(tmpdir(), "write-once-staged-pipeline-"));
  directories.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("staged resource pipeline", () => {
  it("waits for every preparation batch before resolving any source", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    await writeFile(
      destination,
      [
        'fragment source="alpha:first"',
        "old alpha",
        "/fragment",
        'fragment source="beta:second"',
        "old beta",
        "/fragment",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function record(cwd: string, event: string) {
  await appendFile(join(cwd, "events.log"), event + "\\n");
}

export default {
  include: ["README.md"],
  maxConcurrency: 2,
  preparers: [
    {
      id: "alpha",
      canPrepare: (reference) => reference.source.startsWith("alpha:"),
      async prepare(references, context) {
        await record(context.cwd, "alpha:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeFile(join(context.workingDirectory, "source.md"), "alpha content");
        await record(context.cwd, "alpha:end");
        return {
          resources: [{ root: context.workingDirectory, metadata: { source: references[0]?.source } }],
          metadata: { count: references.length },
        };
      },
    },
    {
      id: "beta",
      canPrepare: (reference) => reference.source.startsWith("beta:"),
      async prepare(references, context) {
        await record(context.cwd, "beta:start");
        await writeFile(join(context.workingDirectory, "source.md"), "beta content");
        await record(context.cwd, "beta:end");
        return {
          resources: [{ root: context.workingDirectory, metadata: { source: references[0]?.source } }],
          metadata: { count: references.length },
        };
      },
    },
  ],
  resolvers: [
    {
      id: "prepared",
      canResolve: (source) => source.startsWith("alpha:") || source.startsWith("beta:"),
      async resolve(source, context) {
        await record(context.cwd, "resolve:" + source);
        const resource = context.preparations?.flatMap((batch) => batch.result.resources).find(
          (item) => item.metadata?.source === source,
        );
        if (resource === undefined) throw new Error("Prepared resource mapping missing.");
        return { root: resource.root, path: "source.md" };
      },
    },
  ],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });
    const events = (await readFile(join(cwd, "events.log"), "utf8")).trim().split("\n");
    const lastPreparation = Math.max(events.indexOf("alpha:end"), events.indexOf("beta:end"));
    const firstResolution = events.findIndex((event) => event.startsWith("resolve:"));

    expect(result.exitCode).toBe(0);
    expect(lastPreparation).toBeGreaterThanOrEqual(0);
    expect(firstResolution).toBeGreaterThan(lastPreparation);
    expect(await readFile(destination, "utf8")).toContain("alpha content");
    expect(await readFile(destination, "utf8")).toContain("beta content");
  });

  it("reports unsupported references without modifying destinations", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    const original = [
      'fragment source="https://example.com/source.md"',
      "old content",
      "/fragment",
    ].join("\n");
    await writeFile(destination, original, "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      'export default { include: ["README.md"] };',
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]).toMatchObject({
      stage: "resolve",
      source: "https://example.com/source.md",
    });
    expect(result.diagnostics[0]?.message).toContain("No resolver supports source");
    expect(await readFile(destination, "utf8")).toBe(original);
  });

  it("does not write any destination when a later destination fails during planning", async () => {
    const cwd = await createProject();
    const firstDestination = join(cwd, "A.md");
    const secondDestination = join(cwd, "B.md");
    const firstOriginal = 'fragment source="./source.md"\nold A\n/fragment';
    const secondOriginal = 'fragment source="./source.md"\nold B\n/fragment';
    await writeFile(firstDestination, firstOriginal, "utf8");
    await writeFile(secondDestination, secondOriginal, "utf8");
    await writeFile(join(cwd, "source.md"), "new content", "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `export default {
  include: ["*.md"],
  hooks: [{
    id: "fail-on-B",
    stage: "pre-write",
    run({ destination, content }) {
      if (destination.endsWith("B.md")) throw new Error("intentional hook failure");
      return { text: content };
    },
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic.stage === "hook")).toBe(true);
    expect(await readFile(firstDestination, "utf8")).toBe(firstOriginal);
    expect(await readFile(secondDestination, "utf8")).toBe(secondOriginal);
  });

  it("preserves destinations and contextual errors when a selected resolver fails", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    const original = 'fragment source="virtual:missing"\nold content\n/fragment';
    await writeFile(destination, original, "utf8");
    await writeFile(
      join(cwd, "write-once.config.ts"),
      `export default {
  include: ["README.md"],
  resolvers: [{
    id: "virtual",
    canResolve: (source) => source.startsWith("virtual:"),
    resolve: () => { throw new Error("provider unavailable"); },
  }],
};
`,
      "utf8",
    );

    const result = await runGenerate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]).toMatchObject({
      stage: "resolve",
      source: "virtual:missing",
    });
    expect(result.diagnostics[0]?.message).toContain('Resolver "virtual" could not resolve');
    expect(await readFile(destination, "utf8")).toBe(original);
  });
});
