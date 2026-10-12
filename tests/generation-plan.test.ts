import { isFailure, isSuccess } from "@opinionated-ts/result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GenerationHook, NormalizedWriteOnceConfig } from "@/index";

import { validateConfig } from "@/config";
import { planDestinationFile } from "@/generation-plan";

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
