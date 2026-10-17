import { describe, expect, it } from "vitest";

import type {
  GenerationHook,
  HookOutput,
  PluginContribution,
  PluginFactory,
  ResourcePreparer,
  ResourceResolver,
  ResolvedContent,
  ResolvedResource,
  SourceSelector,
  TextSpan,
} from "@/index";

const providerFactory: PluginFactory = () => ({ preparers: [], resolvers: [] });
const extractorFactory: PluginFactory = () => ({ extractors: [] });
const mixedFactory: PluginFactory = () => ({ extractors: [], hooks: [] });

describe("public types", () => {
  it("models source selection as a discriminated union", () => {
    const whole: SourceSelector = { kind: "whole" };
    const named: SourceSelector = { kind: "named", name: "intro" };
    const range: SourceSelector = {
      kind: "range",
      range: {
        start: { line: 1, column: 1 },
        end: { line: 2, column: 1 },
      },
    };

    expect([whole.kind, named.kind, range.kind]).toEqual(["whole", "named", "range"]);
  });

  it("represents string offsets as half-open spans", () => {
    const span: TextSpan = { start: 0, end: 5 };

    expect(span.end - span.start).toBe(5);
  });

  it("distinguishes path-only resolver output from loaded resource content", () => {
    const resource: ResolvedResource = {
      root: "/project",
      path: "docs/guide.md",
      metadata: { revision: "main" },
    };
    const resolver: ResourceResolver = {
      id: "repository",
      canResolve: (source) => source.startsWith("repo:"),
      resolve: () => resource,
    };
    const loaded: ResolvedContent = {
      ...resource,
      id: "file:/project/docs/guide.md",
      location: "/project/docs/guide.md",
      text: "# Guide",
    };

    expect(resolver.resolve("repo:docs/guide.md", { cwd: "/project" })).toEqual(resource);
    expect(loaded.text).toBe("# Guide");
    expect(resource.metadata?.["revision"]).toBe("main");
  });

  it("models batched preparation and path-based resources", () => {
    const preparer: ResourcePreparer = {
      id: "repository",
      canPrepare: (reference) => reference.source.startsWith("repo:"),
      prepare: async (_references, context) => ({
        resources: [{ root: context.workingDirectory, metadata: { revision: "main" } }],
        metadata: { cacheKey: "opaque-to-core" },
      }),
    };

    expect(preparer.id).toBe("repository");
  });

  it("allows plugins to contribute any combination of capabilities", () => {
    const markdownHook: GenerationHook = {
      id: "markdown-fence",
      stage: "pre-write",
      run: ({ text }) => ({ text: "```text\n" + text + "\n```" }),
    };
    const hookOnlyPlugin: PluginContribution = {
      name: "markdown",
      hooks: [markdownHook],
    };

    expect(hookOnlyPlugin.hooks).toEqual([markdownHook]);
    expect(hookOnlyPlugin.resolvers).toBeUndefined();
    expect(hookOnlyPlugin.extractors).toBeUndefined();

    expect([providerFactory(), extractorFactory(), mixedFactory()]).toHaveLength(3);
  });

  it("distinguishes body-only and full-block hook output", () => {
    const bodyOutput: HookOutput = { text: "generated body" };
    const fullOutput: HookOutput = { fullText: "<!-- custom block -->" };

    expect(bodyOutput.text).toBe("generated body");
    expect(fullOutput.fullText).toBe("<!-- custom block -->");

    // @ts-expect-error A hook cannot return both replacement representations.
    const invalidOutput: HookOutput = { text: "body", fullText: "full block" };
    expect(invalidOutput).toBeDefined();
  });
});
