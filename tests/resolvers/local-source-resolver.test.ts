import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { localSourceResolver } from "@/resolvers/local-source-resolver";

const directories: string[] = [];

async function createProject() {
  const cwd = await mkdtemp(join(tmpdir(), "write-once-resolver-"));
  directories.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("localSourceResolver", () => {
  it("returns a root and relative path for project-relative sources without reading them", async () => {
    const cwd = await createProject();
    const resource = await localSourceResolver.resolve("docs/source.md", { cwd });

    expect(resource).toEqual({
      root: cwd,
      path: join("docs", "source.md"),
      metadata: { source: "docs/source.md", cwd },
    });
  });

  it("normalizes Windows-style separators for relative paths", async () => {
    const cwd = await createProject();
    const resource = await localSourceResolver.resolve("docs\\source.md", { cwd });

    expect(resource.root).toBe(cwd);
    expect(resource.path).toBe(join("docs", "source.md"));
  });

  it("uses the containing directory as the root for absolute paths", async () => {
    const cwd = await createProject();
    const source = join(cwd, "source:notes.md");
    const resource = await localSourceResolver.resolve(source, { cwd: "/" });

    expect(resource.root).toBe(dirname(source));
    expect(resource.path).toBe(basename(source));
  });

  it("does not claim remote or future repository source references", () => {
    const context = { cwd: "/tmp" };
    expect(localSourceResolver.canResolve("https://example.com/source.md", context)).toBe(false);
    expect(localSourceResolver.canResolve("@repo:source.md", context)).toBe(false);
    expect(localSourceResolver.canResolve("./source.md", context)).toBe(true);
  });

  it("rejects URL sources instead of attempting network access", () => {
    expect(() =>
      localSourceResolver.resolve("https://example.com/source.md", { cwd: "/tmp" }),
    ).toThrow(expect.objectContaining({ code: "SOURCE_RESOLUTION_ERROR" }));
  });
});
