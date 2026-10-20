import { isFailure } from "@opinionated-ts/result";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { NormalizedWriteOnceConfig } from "@/config";

import { validateConfig } from "@/config";
import { scanDestinationFile } from "@/generation-plan";
import { cleanupPreparedResources, prepareSourceReferences } from "@/resource-preparation";

const directories: string[] = [];
const workspaces: string[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "write-once-preparation-unit-"));
  directories.push(root);
  await writeFile(
    join(root, "README.md"),
    ['fragment source="repo:source.md"', "old", "/fragment"].join("\n"),
    "utf8",
  );
  const validated = validateConfig({}, root);
  if (isFailure(validated)) throw validated.error;
  const scan = scanDestinationFile(
    join(root, "README.md"),
    ['fragment source="repo:source.md"', "old", "/fragment"].join("\n"),
  );
  if (!scan.ok) throw scan.error;
  return { root, config: validated.value, references: scan.value.references };
}

afterEach(async () => {
  await Promise.all(
    [...directories.splice(0), ...workspaces.splice(0)].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("prepareSourceReferences", () => {
  it("wraps a preparer trigger exception with its identity and source", async () => {
    const { config, references } = await setup();
    const configured: NormalizedWriteOnceConfig = {
      ...config,
      preparers: [
        {
          id: "broken-trigger",
          canPrepare: () => {
            throw new Error("trigger failed");
          },
          prepare: () => ({ resources: [] }),
        },
      ],
    };

    await expect(prepareSourceReferences(references, configured)).rejects.toMatchObject({
      name: "ResourcePreparationFailure",
      preparerId: "broken-trigger",
      message: expect.stringContaining('failed for source "repo:source.md"'),
    });
  });

  it("reuses a persistent preparer workspace while cleaning each run's temporary directory", async () => {
    const { config, references } = await setup();
    let workingDirectory = "";
    let workspaceDirectory = "";
    let preparationCount = 0;
    const configured: NormalizedWriteOnceConfig = {
      ...config,
      preparers: [
        {
          id: "persistent-provider",
          canPrepare: () => true,
          async prepare(_assigned, context) {
            preparationCount += 1;
            workingDirectory = context.workingDirectory;
            workspaceDirectory = context.workspaceDirectory;
            workspaces.push(workspaceDirectory);
            await mkdir(workspaceDirectory, { recursive: true });
            try {
              await access(join(workspaceDirectory, "cached.txt"));
            } catch {
              await writeFile(join(workspaceDirectory, "cached.txt"), "cached", "utf8");
            }
            return { resources: [{ root: workspaceDirectory }] };
          },
        },
      ],
    };

    const first = await prepareSourceReferences(references, configured);
    await expect(access(workingDirectory)).resolves.toBeUndefined();
    await expect(access(join(workspaceDirectory, "cached.txt"))).resolves.toBeUndefined();
    await cleanupPreparedResources(first);
    await expect(access(workingDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(workspaceDirectory, "cached.txt"))).resolves.toBeUndefined();

    const second = await prepareSourceReferences(references, configured);
    expect(second.preparations[0]?.workspaceDirectory).toBe(workspaceDirectory);
    expect(preparationCount).toBe(2);
    await cleanupPreparedResources(second);
  });

  it("cleans a preparer's temporary directory when preparation rejects with a non-Error value", async () => {
    const { config, references } = await setup();
    let workingDirectory = "";
    const configured: NormalizedWriteOnceConfig = {
      ...config,
      preparers: [
        {
          id: "broken-prepare",
          canPrepare: () => true,
          prepare: (_assigned, context) => {
            workingDirectory = context.workingDirectory;
            throw "provider unavailable";
          },
        },
      ],
    };

    let failure: unknown;
    try {
      await prepareSourceReferences(references, configured);
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toMatchObject({
      name: "ResourcePreparationFailure",
      preparerId: "broken-prepare",
      message: expect.stringContaining("provider unavailable"),
    });
    expect(workingDirectory).not.toBe("");
    await expect(access(workingDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
