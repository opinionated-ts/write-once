import { describe, expect, it } from "vitest";

import type {
  HookOutput,
  PluginContribution,
  ResolvedResource,
  SourceSelector,
  TextSpan,
} from "@/index";

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

  it("supports resources with text or extractor metadata", () => {
    const textResource: ResolvedResource = {
      id: "local:readme",
      location: "./README.md",
      text: "# Readme",
    };
    const metadataResource: ResolvedResource = {
      id: "remote:repo:file",
      location: "repo://owner/project/README.md",
      metadata: { revision: "main" },
    };

    expect(textResource.text).toBe("# Readme");
    expect(metadataResource.metadata["revision"]).toBe("main");
  });

  it("allows plugins to contribute any combination of capabilities", () => {
    const hookOnlyPlugin: PluginContribution = {
      name: "markdown",
      hooks: [],
    };

    expect(hookOnlyPlugin.hooks).toEqual([]);
    expect(hookOnlyPlugin.resolvers).toBeUndefined();
    expect(hookOnlyPlugin.extractors).toBeUndefined();
  });

  it("distinguishes body-only and full-block hook output", () => {
    const bodyOutput: HookOutput = { text: "generated body" };
    const fullOutput: HookOutput = { fullText: "<!-- custom block -->" };

    expect(bodyOutput.text).toBe("generated body");
    expect(fullOutput.fullText).toBe("<!-- custom block -->");
  });
});
