import { isFailure, isSuccess } from "@opinionated-ts/result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateConfig } from "@/config";
import { planDestinationFile, selectorFor } from "@/generation-plan";
import { createResourceReader } from "@/resource-reader";

const directories: string[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "write-once-plan-extra-"));
  directories.push(root);
  await writeFile(join(root, "source.md"), "generated", "utf8");
  const config = validateConfig({}, root);
  if (isFailure(config)) throw config.error;
  return { root, config: config.value };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generation plan edge cases", () => {
  it("returns invalid selector ranges as typed Result failures", () => {
    const result = selectorFor("./source.md", undefined, "invalid");
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toMatchObject({
        code: "CONTENT_EXTRACTION_ERROR",
        message: 'Invalid source range "invalid".',
      });
    }
  });

  it("preserves line and column for marker syntax diagnostics", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const result = await planDestinationFile({
      destination,
      text: ["first line", '  fragment source="./source.md" source="./other.md"', "/fragment"].join(
        "\n",
      ),
      config,
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toMatchObject({
        markerLocation: {
          resource: destination,
          start: { line: 2, column: 33 },
        },
      });
    }
  });

  it("preserves line and column for marker structure diagnostics", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const result = await planDestinationFile({
      destination,
      text: ["first line", '  fragment source="./source.md"'].join("\n"),
      config,
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toMatchObject({
        markerLocation: {
          resource: destination,
          start: { line: 2, column: 3 },
        },
      });
    }
  });

  it("preserves inline delimiter wrappers across multiple generated blocks", async () => {
    const { root, config } = await setup();
    const text = [
      'before <!-- fragment source="./source.md" --> trailing',
      "old first",
      "after <!-- /fragment --> tail",
      "between blocks",
      'prefix <!-- fragment source="./source.md" --> suffix',
      "old second",
      "suffix <!-- /fragment --> trailing",
    ].join("\n");

    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text,
      config,
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.outputText).toBe(
        [
          'before <!-- fragment source="./source.md" --> trailing',
          "generated",
          "after <!-- /fragment --> tail",
          "between blocks",
          'prefix <!-- fragment source="./source.md" --> suffix',
          "generated",
          "suffix <!-- /fragment --> trailing",
        ].join("\n"),
      );
    }
  });

  it("keeps an injected reader usable after a planning read fails", async () => {
    const { root, config } = await setup();
    const readText = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary I/O failure"))
      .mockResolvedValueOnce("recovered content");
    const reader = createResourceReader(readText);
    const destination = join(root, "README.md");
    const text = 'fragment source="./source.md"\nold\n/fragment';

    const failed = await planDestinationFile({ destination, text, config, reader });
    expect(isFailure(failed)).toBe(true);
    if (isFailure(failed)) expect(failed.error.stage).toBe("resolve");

    const recovered = await planDestinationFile({ destination, text, config, reader });
    expect(isSuccess(recovered)).toBe(true);
    if (isSuccess(recovered)) expect(recovered.value.outputText).toContain("recovered content");
    expect(readText).toHaveBeenCalledTimes(2);
    await reader.clear();
  });

  it("rejects sources unsupported by every registered resolver before reading", async () => {
    const { root, config } = await setup();
    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text: 'fragment source="unsupported:resource"\nold\n/fragment',
      config: { ...config, resolvers: [] },
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.stage).toBe("resolve");
      expect(result.error.message).toContain('could not resolve source "unsupported:resource"');
    }
  });

  it("preserves typed built-in extraction errors in pipeline diagnostics", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const result = await planDestinationFile({
      destination,
      text: ['fragment source="./source.md" name="missing"', "old", "/fragment"].join("\n"),
      config,
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.stage).toBe("extract");
      expect(result.error.cause).toMatchObject({ code: "CONTENT_EXTRACTION_ERROR" });
    }
  });

  it("reports extractor failures with extraction-stage diagnostics", async () => {
    const { root, config } = await setup();
    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text: 'fragment source="./source.md"\nold\n/fragment',
      config: {
        ...config,
        extractors: [
          {
            id: "broken-extractor",
            canExtract: () => true,
            extract: () => {
              throw new Error("source format is invalid");
            },
          },
        ],
      },
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.stage).toBe("extract");
      expect(result.error.message).toContain('Could not extract content from source "./source.md"');
      expect(result.error.cause).toMatchObject({ message: "source format is invalid" });
    }
  });

  it("rejects hooks that return neither a body nor a full replacement", async () => {
    const { root, config } = await setup();
    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text: 'fragment source="./source.md"\nold\n/fragment',
      config: {
        ...config,
        hooks: [{ id: "invalid-output", stage: "pre-write", run: () => JSON.parse("null") }],
      },
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.stage).toBe("hook");
      expect(result.error.message).toBe(
        'Hook "invalid-output" must return exactly one of text or fullText.',
      );
    }
  });

  it("awaits async hooks and rejects conflicting replacement representations", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const text = 'fragment source="./source.md"\nold\n/fragment';

    const asyncResult = await planDestinationFile({
      destination,
      text,
      config: {
        ...config,
        hooks: [
          {
            id: "async",
            stage: "pre-write",
            run: async ({ text: hookText }) => ({ text: hookText.toUpperCase() }),
          },
        ],
      },
    });
    expect(isSuccess(asyncResult)).toBe(true);
    if (isSuccess(asyncResult)) expect(asyncResult.value.outputText).toContain("GENERATED");

    const conflictingResult = await planDestinationFile({
      destination,
      text,
      config: {
        ...config,
        hooks: [
          {
            id: "conflicting",
            stage: "pre-write",
            run: () => JSON.parse('{"text":"body","fullText":"whole block"}'),
          },
        ],
      },
    });
    expect(isFailure(conflictingResult)).toBe(true);
    if (isFailure(conflictingResult)) {
      expect(conflictingResult.error.stage).toBe("hook");
      expect(conflictingResult.error.message).toBe(
        'Hook "conflicting" must return exactly one of text or fullText.',
      );
    }
  });
});
