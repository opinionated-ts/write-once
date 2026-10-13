import { isSuccess } from "@opinionated-ts/result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ContentExtractor, ResourceResolver } from "@/types";

import { validateConfig } from "@/config";
import { planDestinationFile } from "@/generation-plan";

const directories: string[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "write-once-order-"));
  directories.push(root);
  const validated = validateConfig({}, root);
  if (!validated.ok) throw validated.error;
  return { root, config: validated.value };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("registration-order selection", () => {
  it("selects the first compatible resolver", async () => {
    const { root, config } = await setup();
    const resolvers: ResourceResolver[] = [
      {
        id: "first",
        canResolve: () => true,
        resolve: () => ({ id: "first", location: "first", text: "first resolver" }),
      },
      {
        id: "second",
        canResolve: () => true,
        resolve: () => ({ id: "second", location: "second", text: "second resolver" }),
      },
    ];
    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text: 'fragment source="virtual:source"\nold\n/fragment',
      config: { ...config, resolvers },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value.outputText).toContain("first resolver");
  });

  it("selects the first compatible extractor", async () => {
    const { root, config } = await setup();
    await writeFile(join(root, "source.md"), "source text", "utf8");
    const extractors: ContentExtractor[] = [
      {
        id: "first",
        canExtract: () => true,
        extract: () => ({ text: "first extractor" }),
      },
      {
        id: "second",
        canExtract: () => true,
        extract: () => ({ text: "second extractor" }),
      },
    ];
    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text: 'fragment source="./source.md"\nold\n/fragment',
      config: { ...config, extractors },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value.outputText).toContain("first extractor");
  });
});
