import { isFailure, isSuccess } from "@opinionated-ts/result";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NormalizedWriteOnceConfig } from "@/config";
import type { GenerationHook, ResourceResolver } from "@/types";

import { validateConfig } from "@/config";
import { planDestinationFile } from "@/generation-plan";
import { createResourceReader } from "@/resource-reader";

const directories: string[] = [];

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "write-once-plan-"));
  directories.push(root);
  return root;
}

function normalized(
  root: string,
  overrides: Partial<NormalizedWriteOnceConfig> = {},
): NormalizedWriteOnceConfig {
  const result = validateConfig({}, root);
  if (isFailure(result)) throw result.error;
  return { ...result.value, ...overrides };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("planDestinationFile", () => {
  it("replaces only the body of generated blocks and preserves unrelated text and delimiters", async () => {
    const root = await createProject();
    const source = join(root, "source.md");
    await writeFile(source, "new content\n", "utf8");
    const destination = join(root, "README.md");
    const text = [
      "before",
      '<!-- fragment source="./source.md" -->',
      "old content",
      "<!-- /fragment -->",
      "after",
    ].join("\n");

    const result = await planDestinationFile({ destination, text, config: normalized(root) });

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.value.outputText).toBe(
      [
        "before",
        '<!-- fragment source="./source.md" -->',
        "new content",
        "<!-- /fragment -->",
        "after",
      ].join("\n"),
    );
    expect(text).toContain("old content");
  });

  it("uses the named, range, or whole extractor based on the selector", async () => {
    const root = await createProject();
    await writeFile(
      join(root, "source.md"),
      'fragment name="intro"\nhello\n/fragment\nworld',
      "utf8",
    );
    const destination = join(root, "README.md");
    const text = [
      'fragment source="./source.md" name="intro"',
      "old",
      "/fragment",
      'fragment source="./source.md" range="4:1-4:6"',
      "old",
      "/fragment",
    ].join("\n");

    const result = await planDestinationFile({ destination, text, config: normalized(root) });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.outputText).toContain("hello\n");
      expect(result.value.outputText).toContain("world");
    }
  });

  it("lets a pre-write hook replace the full marker block explicitly", async () => {
    const root = await createProject();
    await writeFile(join(root, "source.md"), "new", "utf8");
    const hook: GenerationHook = {
      id: "wrap",
      stage: "pre-write",
      run: ({ content }) => ({ fullText: `<!-- rebuilt -->\n${content}\n<!-- /rebuilt -->` }),
    };
    const text = '<!-- fragment source="./source.md" -->\nold\n<!-- /fragment -->';
    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text,
      config: normalized(root, { hooks: [hook] }),
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result))
      expect(result.value.outputText).toBe("<!-- rebuilt -->\nnew\n<!-- /rebuilt -->");
  });

  it("fails before producing a plan when source resolution or hooks fail", async () => {
    const root = await createProject();
    const text = 'fragment source="./missing.md"\nold\n/fragment';
    const failedSource = await planDestinationFile({
      destination: join(root, "README.md"),
      text,
      config: normalized(root),
    });
    expect(isFailure(failedSource)).toBe(true);
    if (isFailure(failedSource)) expect(failedSource.error.stage).toBe("resolve");

    await writeFile(join(root, "source.md"), "new", "utf8");
    const failedHook = await planDestinationFile({
      destination: join(root, "README.md"),
      text: 'fragment source="./source.md"\nold\n/fragment',
      config: normalized(root, {
        hooks: [
          {
            id: "broken",
            stage: "pre-write",
            run: () => {
              throw new Error("failed");
            },
          },
        ],
      }),
    });
    expect(isFailure(failedHook)).toBe(true);
    if (isFailure(failedHook)) expect(failedHook.error.stage).toBe("hook");
  });

  it("bounds concurrent resolution and keeps resolved results in reference order", async () => {
    const root = await createProject();
    await writeFile(join(root, "source.md"), "shared content", "utf8");
    let active = 0;
    let maximumActive = 0;
    const resolver: ResourceResolver = {
      id: "virtual",
      canResolve: (source) => source.startsWith("virtual:"),
      async resolve() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { root, path: "source.md" };
      },
    };
    const text = [
      'fragment source="virtual:first"',
      "old first",
      "/fragment",
      'fragment source="virtual:second"',
      "old second",
      "/fragment",
      'fragment source="virtual:third"',
      "old third",
      "/fragment",
    ].join("\n");

    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text,
      config: normalized(root, { maxConcurrency: 2, resolvers: [resolver] }),
    });

    expect(isSuccess(result)).toBe(true);
    expect(maximumActive).toBe(2);
    if (isSuccess(result)) {
      expect(result.value.outputText.match(/shared content/g)).toHaveLength(3);
    }
  });

  it("loads a shared source once for multiple selectors and releases it after the final consumer", async () => {
    const root = await createProject();
    const source = join(root, "source.md");
    await writeFile(
      source,
      'fragment name="first"\nalpha\n/fragment\nfragment name="second"\nbeta\n/fragment',
      "utf8",
    );
    const readText = vi.fn(async () => readFile(source, "utf8"));
    const reader = createResourceReader(readText);
    const destination = join(root, "README.md");
    const text = [
      'fragment source="./source.md" name="first"',
      "old one",
      "/fragment",
      'fragment source="./source.md" name="second"',
      "old two",
      "/fragment",
    ].join("\n");

    const result = await planDestinationFile({
      destination,
      text,
      config: normalized(root),
      reader,
    });

    expect(isSuccess(result)).toBe(true);
    expect(readText).toHaveBeenCalledTimes(1);
    if (isSuccess(result)) {
      expect(result.value.outputText).toContain("alpha");
      expect(result.value.outputText).toContain("beta");
    }
    await reader.clear();
  });

  it("rejects malformed and nested generated destinations before writing", async () => {
    const root = await createProject();
    const malformed = await planDestinationFile({
      destination: join(root, "README.md"),
      text: 'fragment source="./a"\n/fragment\n/fragment',
      config: normalized(root),
    });
    expect(isFailure(malformed)).toBe(true);

    const nested = await planDestinationFile({
      destination: join(root, "README.md"),
      text: [
        'fragment source="./a"',
        'fragment source="./b"',
        "body",
        "/fragment",
        "/fragment",
      ].join("\n"),
      config: normalized(root),
    });
    expect(isFailure(nested)).toBe(true);
  });
});
