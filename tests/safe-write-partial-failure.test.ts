import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DestinationPlan } from "@/generation-plan";

import { writeDestinationPlansWithOperations } from "@/safe-write";

const directories: string[] = [];

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "write-once-partial-"));
  directories.push(root);
  return root;
}

function plan(destination: string, originalText: string, outputText: string): DestinationPlan {
  return { destination, originalText, outputText, replacements: [] };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("partial atomic-write failures", () => {
  it("stringifies non-Error values thrown by the rename operation", async () => {
    const root = await createProject();
    const destination = join(root, "README.md");
    await writeFile(destination, "old", "utf8");

    const result = await writeDestinationPlansWithOperations([plan(destination, "old", "new")], {
      rename: async () => {
        throw "rename provider failed";
      },
    });

    expect(result.written).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("rename provider failed");
    expect(await readFile(destination, "utf8")).toBe("old");
    expect((await readdir(root)).toSorted()).toEqual(["README.md"]);
  });

  it("reports earlier successful renames without claiming rollback", async () => {
    const root = await createProject();
    const first = join(root, "a.md");
    const second = join(root, "b.md");
    await writeFile(first, "old-a", "utf8");
    await writeFile(second, "old-b", "utf8");

    const result = await writeDestinationPlansWithOperations(
      [plan(first, "old-a", "new-a"), plan(second, "old-b", "new-b")],
      {
        rename: async (temporary, destination) => {
          if (destination === second) throw new Error("simulated rename failure");
          await rename(temporary, destination);
        },
      },
    );

    expect(result.written).toEqual([first]);
    expect(result.diagnostics[0]?.message).toContain("after 1 earlier write(s)");
    expect(result.diagnostics[0]?.message).toContain("not rolled back");
    expect(await readFile(first, "utf8")).toBe("new-a");
    expect(await readFile(second, "utf8")).toBe("old-b");
    expect((await readdir(root)).toSorted()).toEqual(["a.md", "b.md"]);
  });
});
