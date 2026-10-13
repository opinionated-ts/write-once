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
    reader.clear();
    expect((await reader.read(source, "source", "resolver", context)).text).toBe("after clear");
    expect(readText).toHaveBeenCalledTimes(3);
  });
});
