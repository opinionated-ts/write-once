import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { NormalizedWriteOnceConfig } from "@/config";

import { discoverDestinationFiles } from "@/discovery";

const directories: string[] = [];

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "write-once-discovery-"));
  directories.push(root);
  return root;
}

function config(
  root: string,
  include: string[] = ["**/*"],
  exclude: string[] = [],
): NormalizedWriteOnceConfig {
  return {
    root,
    include,
    exclude,
    respectGitignore: true,
    maxConcurrency: Number.POSITIVE_INFINITY,
    memoryBudgetMiB: 256,
    preparers: [],
    resolvers: [],
    extractors: [],
    hooks: [],
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("discoverDestinationFiles", () => {
  it("discovers matching files recursively in deterministic order", async () => {
    const root = await createProject();
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "z.md"), "z", "utf8");
    await writeFile(join(root, "docs", "a.md"), "a", "utf8");
    await writeFile(join(root, "docs", "b.txt"), "b", "utf8");

    const result = await discoverDestinationFiles(config(root, ["**/*.md"]));

    expect(result.files).toEqual([join(root, "docs", "a.md"), join(root, "z.md")]);
    expect(result.diagnostics).toEqual([]);
  });

  it("applies exclusions after includes and prunes excluded directories", async () => {
    const root = await createProject();
    await mkdir(join(root, "generated"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "README.md"), "readme", "utf8");
    await writeFile(join(root, "generated", "output.md"), "generated", "utf8");
    await writeFile(join(root, "node_modules", "package.md"), "dependency", "utf8");

    const result = await discoverDestinationFiles(
      config(root, ["**/*.md"], ["generated/**", "node_modules/**"]),
    );

    expect(result.files).toEqual([join(root, "README.md")]);
  });

  it("respects root and nested .gitignore files by default", async () => {
    const root = await createProject();
    await mkdir(join(root, "cache"));
    await mkdir(join(root, "packages", "app"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "cache/\n*.secret\n", "utf8");
    await writeFile(join(root, "README.md"), "readme", "utf8");
    await writeFile(join(root, "cache", "output.md"), "ignored directory", "utf8");
    await writeFile(join(root, "token.secret"), "ignored file", "utf8");
    await writeFile(join(root, "packages", ".gitignore"), "/*.md\n!/keep.md\n", "utf8");
    await writeFile(join(root, "packages", "ignored.md"), "ignored nested file", "utf8");
    await writeFile(join(root, "packages", "keep.md"), "re-included nested file", "utf8");
    await writeFile(join(root, "packages", "app", "README.md"), "nested README", "utf8");

    const result = await discoverDestinationFiles(config(root, ["**/*"], ["**/.gitignore"]));

    expect(result.files).toEqual([
      join(root, "README.md"),
      join(root, "packages", "app", "README.md"),
      join(root, "packages", "keep.md"),
    ]);
  });

  it("can disable .gitignore filtering through config", async () => {
    const root = await createProject();
    await writeFile(join(root, ".gitignore"), "ignored.md\n", "utf8");
    await writeFile(join(root, "ignored.md"), "content", "utf8");

    const result = await discoverDestinationFiles({
      ...config(root, ["**/*"]),
      respectGitignore: false,
    });

    expect(result.files).toContain(join(root, "ignored.md"));
  });

  it("reports no matches as a warning", async () => {
    const root = await createProject();
    await writeFile(join(root, "README.txt"), "text", "utf8");

    const result = await discoverDestinationFiles(config(root, ["**/*.md"]));

    expect(result.files).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ severity: "warning", stage: "discovery" }]);
  });

  it("reports unreadable or missing roots as errors", async () => {
    const root = await createProject();
    const result = await discoverDestinationFiles(config(join(root, "missing")));

    expect(result.files).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ severity: "error", stage: "discovery" }]);
  });

  it("reports invalid patterns instead of scanning", async () => {
    const root = await createProject();
    const result = await discoverDestinationFiles(config(root, ["!README.md"]));

    expect(result.files).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ severity: "error", stage: "discovery" }]);
  });

  it("rejects include patterns containing NUL characters", async () => {
    const root = await createProject();
    await writeFile(join(root, "README.md"), "readme", "utf8");

    const result = await discoverDestinationFiles(config(root, ["README\0.md"]));

    expect(result.files).toEqual([]);
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        stage: "discovery",
        message: expect.stringContaining("Invalid include pattern"),
      },
    ]);
  });

  it("sorts diagnostics from multiple unreadable nested .gitignore entries", async () => {
    const root = await createProject();
    await mkdir(join(root, "z"));
    await mkdir(join(root, "a"));
    await mkdir(join(root, "z", ".gitignore"));
    await mkdir(join(root, "a", ".gitignore"));

    const result = await discoverDestinationFiles(config(root));

    expect(result.files).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.file)).toEqual([
      join(root, "a", ".gitignore"),
      join(root, "z", ".gitignore"),
    ]);
  });

  it("reports invalid exclude patterns instead of scanning", async () => {
    const root = await createProject();
    await writeFile(join(root, "README.md"), "readme", "utf8");

    const result = await discoverDestinationFiles(config(root, ["**/*"], ["!README.md"]));

    expect(result.files).toEqual([]);
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        stage: "discovery",
        message: expect.stringContaining("Invalid exclude pattern"),
      },
    ]);
  });

  it("reports a .gitignore read failure and does not continue scanning that directory", async () => {
    const root = await createProject();
    await mkdir(join(root, ".gitignore"));
    await writeFile(join(root, "README.md"), "readme", "utf8");

    const result = await discoverDestinationFiles(config(root));

    expect(result.files).toEqual([]);
    expect(result.diagnostics).toMatchObject([
      {
        severity: "error",
        stage: "discovery",
        file: join(root, ".gitignore"),
        message: expect.stringContaining("Cannot read .gitignore"),
      },
    ]);
  });

  it("uses configured defaults without hiding dotfiles except for explicit default exclusions", async () => {
    const root = await createProject();
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, ".env"), "x", "utf8");
    await writeFile(join(root, ".git", "config"), "x", "utf8");
    await writeFile(join(root, "node_modules", "package.json"), "{}", "utf8");

    const result = await discoverDestinationFiles(
      config(root, ["**/*"], ["**/.git/**", "**/node_modules/**"]),
    );

    expect(result.files).toEqual([join(root, ".env")]);
  });
});
