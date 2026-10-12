import { isFailure, isSuccess } from "@opinionated-ts/result";
import { describe, expect, it } from "vitest";

import type { ContentExtractor, GenerationHook, ResourceResolver } from "@/types";

import { validateConfig } from "@/config";

const resolver: ResourceResolver = {
  id: "local",
  canResolve: () => true,
  resolve: () => ({ id: "local:a", location: "/project/a", text: "text" }),
};
const extractor: ContentExtractor = {
  id: "text",
  canExtract: () => true,
  extract: (resource) => ({ text: resource.text ?? "" }),
};
const hook: GenerationHook = {
  id: "format",
  stage: "pre-write",
  run: ({ content }) => ({ text: content }),
};

describe("validateConfig", () => {
  it("normalizes optional config using the provided working directory", () => {
    const result = validateConfig(
      { root: "packages/docs", include: ["**/*.md"], exclude: ["generated/**"] },
      "/repo",
    );

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.value).toEqual({
      root: "/repo/packages/docs",
      include: ["**/*.md"],
      exclude: ["generated/**"],
      resolvers: [],
      extractors: [],
      hooks: [],
    });
  });

  it("uses built-in defaults when config is absent", () => {
    const result = validateConfig({}, "/repo");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.root).toBe("/repo");
      expect(result.value.include).toEqual(["**/*"]);
      expect(result.value.exclude).toEqual(["**/.git/**", "**/node_modules/**"]);
    }
  });

  it("accepts independent resolver, extractor, and hook contributions", () => {
    const result = validateConfig(
      { resolvers: [resolver], extractors: [extractor], hooks: [hook] },
      "/repo",
    );

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.resolvers).toEqual([resolver]);
      expect(result.value.extractors).toEqual([extractor]);
      expect(result.value.hooks).toEqual([hook]);
    }
  });

  it.each([
    [null, "Configuration must be an object."],
    [{ root: "" }, '"root" must be a non-empty path string.'],
    [{ include: [""] }, '"include" must be an array of non-empty pattern strings.'],
    [{ exclude: "dist/**" }, '"exclude" must be an array of non-empty pattern strings.'],
    [
      { resolvers: [{}] },
      '"resolvers" must contain resolver objects with id, canResolve, and resolve.',
    ],
    [
      { extractors: [{}] },
      '"extractors" must contain extractor objects with id, canExtract, and extract.',
    ],
    [{ hooks: [{}] }, '"hooks" must contain hook objects with id, stage, and run.'],
    [{ resolvers: [resolver, resolver] }, "unique within each capability category"],
  ])("rejects invalid config %#", (config, message) => {
    const result = validateConfig(config, "/repo");

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.message).toContain(message);
  });
});
