import { describe, expect, it } from "vitest";

import type { MarkerBlock, ResourcePreparer, SourceReferenceContext } from "@/types";

import { assignPreparerReferences, selectPreparer } from "@/preparer-selection";

function referenceFor(source: string): SourceReferenceContext {
  const location = {
    resource: "/project/README.md",
    start: { line: 1, column: 1 },
    end: { line: 1, column: 1 },
  };
  const token = {
    raw: "",
    attributes: { source },
    span: { start: 0, end: 0 },
    lineSpan: { start: 0, end: 0 },
    location,
  };
  const marker = {
    opening: { ...token, kind: "open" },
    closing: { ...token, kind: "close" },
    span: { start: 0, end: 0 },
    bodySpan: { start: 0, end: 0 },
  } satisfies MarkerBlock;

  return {
    source,
    selector: { kind: "whole" },
    destination: "/project/README.md",
    marker,
  };
}

describe("selectPreparer", () => {
  it("selects the first matching preparer and stops evaluating triggers", () => {
    const calls: string[] = [];
    const preparers: ResourcePreparer[] = [
      {
        id: "skip",
        canPrepare: () => {
          calls.push("skip");
          return false;
        },
        prepare: () => ({ resources: [] }),
      },
      {
        id: "first-match",
        canPrepare: () => {
          calls.push("first-match");
          return true;
        },
        prepare: () => ({ resources: [] }),
      },
      {
        id: "later-match",
        canPrepare: () => {
          calls.push("later-match");
          return true;
        },
        prepare: () => ({ resources: [] }),
      },
    ];
    const reference = referenceFor("repo:docs/guide.md");

    const selected = selectPreparer(preparers, reference, { cwd: "/project" });

    expect(selected?.id).toBe("first-match");
    expect(calls).toEqual(["skip", "first-match"]);
  });

  it("keeps references unassigned when no preparer matches and omits empty batches", () => {
    const preparer: ResourcePreparer = {
      id: "repo-only",
      canPrepare: () => false,
      prepare: () => ({ resources: [] }),
    };
    const reference = referenceFor("./local.md");

    const assignment = assignPreparerReferences([preparer], [reference], () => ({
      cwd: "/project",
    }));

    expect(assignment.batches).toEqual([]);
    expect(assignment.unassigned).toEqual([reference]);
  });

  it("leaves unmatched references available for resolver-only handling", () => {
    const preparer: ResourcePreparer = {
      id: "repo-only",
      canPrepare: () => false,
      prepare: () => ({ resources: [] }),
    };
    const reference = referenceFor("./local.md");

    expect(selectPreparer([preparer], reference, { cwd: "/project" })).toBeUndefined();
  });
});
