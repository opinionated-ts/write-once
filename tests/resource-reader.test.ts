import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { NormalizedResourcePath } from "@/resource-path";
import type { ResourceContext } from "@/types";

import { createResourceReader } from "@/resource-reader";

const context: ResourceContext = { cwd: "/project" };

function resource(
  id: string,
  absolutePath: string,
  metadata?: Readonly<Record<string, unknown>>,
): NormalizedResourcePath {
  return {
    id,
    root: "/project",
    path: absolutePath.slice("/project/".length),
    location: absolutePath,
    absolutePath,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

describe("createResourceReader", () => {
  it("deduplicates concurrent and sequential reads by normalized resource identity", async () => {
    let readCount = 0;
    const readText = vi.fn(async () => {
      readCount += 1;
      await Promise.resolve();
      return `contents:${readCount}`;
    });
    const reader = createResourceReader(readText);
    const source = resource("file:/project/source.md", "/project/source.md");

    const [first, concurrent] = await Promise.all([
      reader.read(source, "source-a", "resolver", context),
      reader.read(source, "source-b", "resolver", context),
    ]);
    const sequential = await reader.read(source, "source-c", "resolver", context);

    expect(readText).toHaveBeenCalledTimes(1);
    expect(first.text).toBe(concurrent.text);
    expect(sequential.text).toBe(first.text);
  });

  it("keeps metadata per resolved reference while sharing the file text", async () => {
    const readText = vi.fn(async () => "shared text");
    const reader = createResourceReader(readText);
    const first = resource("file:/project/source.md", "/project/source.md", { revision: "one" });
    const second = resource("file:/project/source.md", "/project/source.md", { revision: "two" });

    const loadedFirst = await reader.read(first, "repo:first", "resolver", context);
    const loadedSecond = await reader.read(second, "repo:second", "resolver", context);

    expect(readText).toHaveBeenCalledTimes(1);
    expect(loadedFirst.text).toBe(loadedSecond.text);
    expect(loadedFirst.metadata).toEqual({ revision: "one" });
    expect(loadedSecond.metadata).toEqual({ revision: "two" });
  });

  it("does not deduplicate equal relative paths under different roots", async () => {
    const readText = vi.fn(async (path: string) => path);
    const reader = createResourceReader(readText);
    const first = resource("file:/project/source.md", "/project/source.md");
    const second = {
      ...resource("file:/other/source.md", "/other/source.md"),
      root: "/other",
    };

    await reader.read(first, "first", "resolver", context);
    await reader.read(second, "second", "resolver", context);

    expect(readText).toHaveBeenCalledTimes(2);
  });

  it("spills inactive content to respect a small budget and releases it after the final consumer", async () => {
    const readText = vi.fn(async (path: string) => "content:" + path);
    const reader = createResourceReader(readText, 0.00001);
    const first = resource("file:/project/first.md", "/project/first.md");
    const second = resource("file:/project/second.md", "/project/second.md");
    reader.setConsumers(
      new Map([
        [first.id, 2],
        [second.id, 1],
      ]),
    );

    const firstRead = await reader.read(first, "first", "resolver", context);
    await reader.release(first.id);
    const secondRead = await reader.read(second, "second", "resolver", context);
    await reader.release(second.id);
    const firstAgain = await reader.read(first, "first", "resolver", context);

    expect(firstAgain.text).toBe(firstRead.text);
    expect(secondRead.text).toContain("second.md");
    expect(readText).toHaveBeenCalledTimes(2);

    await reader.release(first.id);
    await reader.clear();
  });

  it("stores spilled source content in a private temporary directory", async () => {
    const before = new Set(await readdir(tmpdir()));
    const reader = createResourceReader(
      vi.fn(async (path: string) => `content:${path}`),
      0.00001,
    );
    const first = resource("file:/project/private-first.md", "/project/private-first.md");
    const second = resource("file:/project/private-second.md", "/project/private-second.md");
    reader.setConsumers(
      new Map([
        [first.id, 2],
        [second.id, 1],
      ]),
    );

    await reader.read(first, "first", "resolver", context);
    await reader.release(first.id);
    await reader.read(second, "second", "resolver", context);

    const created = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("write-once-content-") && !before.has(name),
    );
    expect(created).toHaveLength(1);
    const directory = join(tmpdir(), created[0]!);
    const directoryStat = await stat(directory);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);

    if (process.platform !== "win32") {
      expect(directoryStat.mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, files[0]!))).mode & 0o777).toBe(0o600);
    }

    await reader.clear();
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains shared content until every registered consumer releases it", async () => {
    const readText = vi.fn(async () => "shared content");
    const reader = createResourceReader(readText);
    const source = resource("file:/project/shared.md", "/project/shared.md");
    reader.setConsumers(new Map([[source.id, 2]]));

    const first = await reader.read(source, "first", "resolver", context);
    const second = await reader.read(source, "second", "resolver", context);
    await reader.release(source.id);

    const stillCached = await reader.read(source, "third", "resolver", context);
    expect(stillCached.text).toBe(first.text);
    expect(second.text).toBe(first.text);
    expect(readText).toHaveBeenCalledTimes(1);

    await reader.release(source.id);
    await reader.release(source.id);
    const afterFinalRelease = await reader.read(source, "fourth", "resolver", context);
    expect(afterFinalRelease.text).toBe("shared content");
    expect(readText).toHaveBeenCalledTimes(2);
    await reader.clear();
  });

  it("preloads an oversized file without rereading the original source", async () => {
    const readText = vi.fn(async () => "a source larger than the configured budget");
    const reader = createResourceReader(readText, 0.00001);
    const source = resource("file:/project/large.md", "/project/large.md");
    reader.setConsumers(new Map([[source.id, 1]]));

    await reader.preload(source, "large", "resolver", context);
    const loaded = await reader.read(source, "large", "resolver", context);

    expect(loaded.text).toBe("a source larger than the configured budget");
    expect(readText).toHaveBeenCalledTimes(1);
    await reader.release(source.id);
    await reader.clear();
  });

  it("shares a failed in-flight read and permits a later retry", async () => {
    let rejectRead!: (cause: Error) => void;
    const readText = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectRead = reject;
          }),
      )
      .mockResolvedValueOnce("recovered after concurrent failure");
    const reader = createResourceReader(readText);
    const source = resource(
      "file:/project/concurrent-failure.md",
      "/project/concurrent-failure.md",
    );

    const first = reader.read(source, "source", "resolver", context);
    const second = reader.read(source, "source", "resolver", context);
    rejectRead(new Error("read failed"));

    const failures = await Promise.allSettled([first, second]);
    expect(failures.map((failure) => failure.status)).toEqual(["rejected", "rejected"]);
    expect(readText).toHaveBeenCalledTimes(1);

    const retried = await reader.read(source, "source", "resolver", context);
    expect(retried.text).toBe("recovered after concurrent failure");
    expect(readText).toHaveBeenCalledTimes(2);
    await reader.clear();
  });

  it("updates registered consumer counts for content that is already cached", async () => {
    const readText = vi.fn(async () => "cached before consumer registration");
    const reader = createResourceReader(readText);
    const source = resource("file:/project/late-consumers.md", "/project/late-consumers.md");

    await reader.read(source, "source", "resolver", context);
    reader.setConsumers(new Map([[source.id, 2]]));
    await reader.release(source.id);
    expect((await reader.read(source, "source", "resolver", context)).text).toBe(
      "cached before consumer registration",
    );
    await reader.release(source.id);
    await reader.release(source.id);

    expect(readText).toHaveBeenCalledTimes(1);
    await reader.clear();
  });

  it("releases a spilled entry without subtracting payload bytes twice", async () => {
    const readText = vi.fn(async (path: string) => `contents:${path}`);
    const reader = createResourceReader(readText, 0.00001);
    const source = resource("file:/project/spilled-release.md", "/project/spilled-release.md");
    reader.setConsumers(new Map([[source.id, 2]]));

    await reader.read(source, "source", "resolver", context);
    await reader.release(source.id);
    await reader.release(source.id);
    expect(readText).toHaveBeenCalledTimes(1);
    await reader.release(source.id);
    await reader.clear();
  });

  it("reports non-Error read failures and safely ignores releases for unknown resources", async () => {
    const reader = createResourceReader(vi.fn().mockRejectedValue("disk unavailable"));
    const source = resource("file:/project/non-error.md", "/project/non-error.md");

    await expect(reader.read(source, "source", "resolver", context)).rejects.toMatchObject({
      message: expect.stringContaining("disk unavailable"),
    });
    await expect(reader.release("file:/project/never-read.md")).resolves.toBeUndefined();
    await reader.clear();
  });

  it("allows repeated releases without making active-consumer counts negative", async () => {
    const reader = createResourceReader(vi.fn().mockResolvedValue("content"));
    const source = resource("file:/project/release.md", "/project/release.md");
    reader.setConsumers(new Map([[source.id, 2]]));

    await reader.read(source, "source", "resolver", context);
    await reader.release(source.id);
    await reader.release(source.id);
    await reader.release(source.id);

    expect((await reader.read(source, "source", "resolver", context)).text).toBe("content");
    await reader.clear();
  });

  it("retries failed reads and clears cached content when requested", async () => {
    const readText = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary read error"))
      .mockResolvedValueOnce("recovered")
      .mockResolvedValueOnce("after clear");
    const reader = createResourceReader(readText);
    const source = resource("file:/project/source.md", "/project/source.md");

    await expect(reader.read(source, "source", "resolver", context)).rejects.toMatchObject({
      code: "SOURCE_RESOLUTION_ERROR",
    });
    expect((await reader.read(source, "source", "resolver", context)).text).toBe("recovered");
    await reader.clear();
    expect((await reader.read(source, "source", "resolver", context)).text).toBe("after clear");
    expect(readText).toHaveBeenCalledTimes(3);
  });
});
