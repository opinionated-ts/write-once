import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("resolves relative paths from the provided project root and preserves text", async () => {
    const cwd = await createProject();
    await mkdir(join(cwd, "docs"));
    await writeFile(join(cwd, "docs", "source.md"), "line one\r\nline two", "utf8");

    const resource = await localSourceResolver.resolve("docs/source.md", { cwd });

    expect(resource.location).toBe(join(cwd, "docs", "source.md"));
    expect(resource.id).toBe(`file:${resource.location}`);
    expect(resource.text).toBe("line one\r\nline two");
  });

  it("normalizes Windows-style separators for relative paths", async () => {
    const cwd = await createProject();
    await mkdir(join(cwd, "docs"));
    await writeFile(join(cwd, "docs", "source.md"), "content", "utf8");

    const resource = await localSourceResolver.resolve("docs\\source.md", { cwd });

    expect(resource.text).toBe("content");
  });

  it("accepts absolute paths and preserves colons in local filenames", async () => {
    const cwd = await createProject();
    const source = join(cwd, "source:notes.md");
    await writeFile(source, "content", "utf8");

    const resource = await localSourceResolver.resolve(source, { cwd: "/" });

    expect(resource.location).toBe(source);
    expect(resource.text).toBe("content");
  });

  it("reports directories and invalid paths as typed resolution errors", async () => {
    const cwd = await createProject();
    await mkdir(join(cwd, "directory"));

    await expect(localSourceResolver.resolve("directory", { cwd })).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
    });
    await expect(localSourceResolver.resolve("bad\0path", { cwd })).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
    });
  });

  it("does not claim remote or future repository source references", () => {
    const context = { cwd: "/tmp" };
    expect(localSourceResolver.canResolve("https://example.com/source.md", context)).toBe(false);
    expect(localSourceResolver.canResolve("@repo:source.md", context)).toBe(false);
    expect(localSourceResolver.canResolve("./source.md", context)).toBe(true);
  });

  it("throws an actionable typed error for missing sources", async () => {
    const cwd = await createProject();

    await expect(localSourceResolver.resolve("missing.md", { cwd })).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
      message: expect.stringContaining('Could not read source "missing.md"'),
    });
  });

  it("rejects URL sources instead of attempting network access", async () => {
    await expect(
      localSourceResolver.resolve("https://example.com/source.md", { cwd: "/tmp" }),
    ).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
      message: "Only local file sources are supported by the built-in resolver.",
    });
  });
});
