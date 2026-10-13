import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ResourceContext } from "@/types";

import { normalizeResolvedResource } from "@/resource-path";

const directories: string[] = [];

async function createDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("normalizeResolvedResource", () => {
  it("normalizes roots and relative paths into a stable resource identity", async () => {
    const cwd = await createDirectory("write-once-path-");
    await writeFile(join(cwd, "source.md"), "source", "utf8");

    const result = await normalizeResolvedResource(
      { root: cwd, path: "docs/../source.md", metadata: { revision: "main" } },
      "source.md",
      "local",
      { cwd },
    );

    expect(result.root).toBe(cwd);
    expect(result.path).toBe("source.md");
    expect(result.id).toBe(`file:${join(cwd, "source.md")}`);
    expect(result.absolutePath).toBe(join(cwd, "source.md"));
    expect(result.metadata).toEqual({ revision: "main" });
  });

  it("rejects malformed resolver values and non-object metadata", async () => {
    const cwd = await createDirectory("write-once-path-");
    const context: ResourceContext = { cwd };

    await expect(normalizeResolvedResource(null, "source", "test", context)).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
      message: expect.stringContaining("invalid resource path"),
    });
    await expect(
      normalizeResolvedResource(
        { root: cwd, path: "source.md", metadata: [] },
        "source",
        "test",
        context,
      ),
    ).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
      message: expect.stringContaining("invalid metadata"),
    });
  });

  it("rejects a file used as the declared resource root", async () => {
    const cwd = await createDirectory("write-once-path-");
    const fileRoot = join(cwd, "not-a-directory");
    await writeFile(fileRoot, "file", "utf8");

    await expect(
      normalizeResolvedResource({ root: fileRoot, path: "source.md" }, "source", "test", { cwd }),
    ).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
      message: expect.stringContaining("Resolved root is not a directory"),
    });
  });

  it("rejects absolute paths and traversal outside the declared root", async () => {
    const cwd = await createDirectory("write-once-path-");
    const context: ResourceContext = { cwd };

    await expect(
      normalizeResolvedResource(
        { root: cwd, path: join(cwd, "source.md") },
        "source",
        "test",
        context,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_RESOLUTION_ERROR" });

    await expect(
      normalizeResolvedResource({ root: cwd, path: "../outside.md" }, "source", "test", context),
    ).rejects.toMatchObject({ code: "SOURCE_RESOLUTION_ERROR" });
  });

  it("rejects missing files and directories as source resources", async () => {
    const cwd = await createDirectory("write-once-path-");
    await mkdir(join(cwd, "folder"));
    const context: ResourceContext = { cwd };

    await expect(
      normalizeResolvedResource({ root: cwd, path: "missing.md" }, "missing.md", "local", context),
    ).rejects.toMatchObject({ code: "SOURCE_RESOLUTION_ERROR" });
    await expect(
      normalizeResolvedResource({ root: cwd, path: "folder" }, "folder", "local", context),
    ).rejects.toMatchObject({ code: "SOURCE_RESOLUTION_ERROR" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks that escape the declared root",
    async () => {
      const root = await createDirectory("write-once-root-");
      const outside = await createDirectory("write-once-outside-");
      await writeFile(join(outside, "secret.md"), "secret", "utf8");
      await symlink(join(outside, "secret.md"), join(root, "linked.md"));

      await expect(
        normalizeResolvedResource({ root, path: "linked.md" }, "linked.md", "local", { cwd: root }),
      ).rejects.toMatchObject({ code: "SOURCE_RESOLUTION_ERROR" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects prepared roots that symlink outside their temporary directory",
    async () => {
      const workingDirectory = await createDirectory("write-once-prepared-");
      const outside = await createDirectory("write-once-outside-");
      await symlink(outside, join(workingDirectory, "escaped"));

      await expect(
        normalizeResolvedResource(
          { root: join(workingDirectory, "escaped"), path: "source.md" },
          "repo:source.md",
          "repository",
          {
            cwd: workingDirectory,
            preparations: [
              {
                preparerId: "repository",
                workingDirectory,
                references: [],
                result: { resources: [] },
              },
            ],
          },
        ),
      ).rejects.toMatchObject({ code: "SOURCE_RESOLUTION_ERROR" });
    },
  );
});
