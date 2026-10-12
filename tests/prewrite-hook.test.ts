import { isFailure, isSuccess } from "@opinionated-ts/result";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GenerationHook, HookContext } from "@/index";

import { validateConfig } from "@/config";
import { planDestinationFile } from "@/generation-plan";

const directories: string[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "write-once-hook-"));
  directories.push(root);
  await writeFile(join(root, "source.md"), "fresh\n", "utf8");
  const validated = validateConfig({}, root);
  if (isFailure(validated)) throw validated.error;
  return { root, config: validated.value };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("pre-write hook contract", () => {
  it("provides typed context and replaces only the exact body span", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const text = [
      'before <!-- fragment source="./source.md" --> trailing',
      "old body",
      "after <!-- /fragment --> tail",
    ].join("\n");
    let received: HookContext | undefined;
    const hook: GenerationHook = {
      id: "uppercase",
      stage: "pre-write",
      run: (context) => {
        received = context;
        return { text: context.content.toUpperCase() };
      },
    };

    const result = await planDestinationFile({
      destination,
      text,
      config: { ...config, hooks: [hook] },
    });

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.value.outputText).toBe(
      [
        'before <!-- fragment source="./source.md" --> trailing',
        "FRESH",
        "after <!-- /fragment --> tail",
      ].join("\n"),
    );
    expect(result.value.replacements[0]?.span).toEqual({
      start: text.indexOf("old body"),
      end: text.indexOf("after <!-- /fragment --> tail"),
    });
    expect(received).toMatchObject({
      stage: "pre-write",
      destination,
      sourceReference: "./source.md",
      selector: { kind: "whole" },
      content: "fresh\n",
      source: { location: join(root, "source.md"), text: "fresh\n" },
      marker: { span: { start: 0, end: text.length } },
    });
  });

  it("keeps closing delimiters on their own line for initially empty bodies", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const text = 'fragment source="./source.md"\n/fragment';
    const result = await planDestinationFile({ destination, text, config });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result))
      expect(result.value.outputText).toBe('fragment source="./source.md"\nfresh\n/fragment');
  });

  it("uses the full marker-line span only when fullText is explicit", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const text =
      'prefix <!-- fragment source="./source.md" --> suffix\nold\nsuffix <!-- /fragment --> trailing';
    const hook: GenerationHook = {
      id: "rebuild",
      stage: "pre-write",
      run: () => ({ fullText: "rebuilt block" }),
    };

    const result = await planDestinationFile({
      destination,
      text,
      config: { ...config, hooks: [hook] },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.replacements[0]?.span).toEqual({ start: 0, end: text.length });
      expect(result.value.outputText).toBe("rebuilt block");
    }
  });

  it("orders competing hooks by priority then registration order without chaining", async () => {
    const { root, config } = await setup();
    const text = 'fragment source="./source.md"\nold\n/fragment';
    const hooks: GenerationHook[] = [
      { id: "first", stage: "pre-write", priority: 10, run: () => ({ text: "first" }) },
      { id: "higher", stage: "pre-write", priority: 20, run: () => ({ text: "higher" }) },
      {
        id: "same-priority-later",
        stage: "pre-write",
        priority: 20,
        run: () => ({ text: "later" }),
      },
    ];

    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text,
      config: { ...config, hooks },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value.outputText).toContain("higher");
  });

  it("surfaces rejected hooks and leaves destination files untouched", async () => {
    const { root, config } = await setup();
    const destination = join(root, "README.md");
    const text = 'fragment source="./source.md"\nold\n/fragment';
    await writeFile(destination, text, "utf8");
    const hook: GenerationHook = {
      id: "reject",
      stage: "pre-write",
      run: async () => {
        throw new Error("hook rejected");
      },
    };

    const result = await planDestinationFile({
      destination,
      text,
      config: { ...config, hooks: [hook] },
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.stage).toBe("hook");
    expect(await readFile(destination, "utf8")).toBe(text);
  });
});
