import { isFailure, isSuccess } from "@opinionated-ts/result";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GenerationHook, HookContext } from "@/types";

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
        return { text: context.text.toUpperCase() };
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
      text: "fresh\n",
      fullText: text,
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
      run: () => ({
        fullText:
          'prefix <!-- fragment source="./source.md" --> suffix\nrebuilt\nsuffix <!-- /fragment --> trailing',
      }),
    };

    const result = await planDestinationFile({
      destination,
      text,
      config: { ...config, hooks: [hook] },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.replacements[0]?.span).toEqual({ start: 0, end: text.length });
      expect(result.value.outputText).toBe(
        'prefix <!-- fragment source="./source.md" --> suffix\nrebuilt\nsuffix <!-- /fragment --> trailing',
      );
    }
  });

  it("chains pre-write hooks in registration order", async () => {
    const { root, config } = await setup();
    const text = 'fragment source="./source.md"\nold\n/fragment';
    const received: HookContext[] = [];
    const hooks: GenerationHook[] = [
      {
        id: "first",
        stage: "pre-write",
        run: (context) => {
          received.push(context);
          return { text: "first" };
        },
      },
      {
        id: "second",
        stage: "pre-write",
        run: (context) => {
          received.push(context);
          return { text: context.text + " second" };
        },
      },
    ];

    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text,
      config: { ...config, hooks },
    });

    expect(isSuccess(result)).toBe(true);
    expect(received).toHaveLength(2);
    expect(received[0]?.text).toBe("fresh\n");
    expect(received[1]?.text).toBe("first");
    expect(received[1]?.fullText).toBe(text);
    if (isSuccess(result)) expect(result.value.outputText).toContain("first second");
  });

  it("derives text from a fullText hook result for the next hook", async () => {
    const { root, config } = await setup();
    const text =
      'prefix <!-- fragment source="./source.md" --> suffix\nold\nsuffix <!-- /fragment --> trailing';
    let received: HookContext | undefined;
    const hooks: GenerationHook[] = [
      {
        id: "rebuild",
        stage: "pre-write",
        run: () => ({
          fullText:
            'prefix <!-- fragment source="./source.md" --> suffix\nrebuilt\nsuffix <!-- /fragment --> trailing',
        }),
      },
      {
        id: "decorate",
        stage: "pre-write",
        run: (context) => {
          received = context;
          return { text: `[${context.text.trim()}]` };
        },
      },
    ];

    const result = await planDestinationFile({
      destination: join(root, "README.md"),
      text,
      config: { ...config, hooks },
    });

    expect(isSuccess(result)).toBe(true);
    expect(received?.text).toBe("rebuilt\n");
    expect(received?.fullText).toContain("rebuilt");
    if (isSuccess(result)) {
      expect(result.value.outputText).toContain("[rebuilt]");
      expect(result.value.outputText).toContain("suffix <!-- /fragment --> trailing");
    }
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
