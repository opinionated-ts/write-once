import { isFailure, isSuccess } from "@opinionated-ts/result";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadWriteOnceConfig } from "@/config-loader";

const directories: string[] = [];

async function createProject() {
  const cwd = await mkdtemp(join(tmpdir(), "write-once-config-"));
  directories.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("loadWriteOnceConfig", () => {
  it("uses defaults when no config file exists", async () => {
    const cwd = await createProject();
    const result = await loadWriteOnceConfig({ cwd });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.config.root).toBe(cwd);
      expect(result.value.config.include).toEqual(["**/*"]);
      expect(result.value.configFile).toBeUndefined();
    }
  });

  it.each([
    ["write-once.config.json", JSON.stringify({ root: "docs", include: ["**/*.md"] })],
    ["write-once.config.yaml", "root: docs\ninclude:\n  - '**/*.md'\n"],
    ["write-once.config.yml", "root: docs\ninclude:\n  - '**/*.md'\n"],
    ["write-once.config.ts", "export default { root: 'docs', include: ['**/*.md'] };"],
    ["write-once.config.js", "export default { root: 'docs', include: ['**/*.md'] };"],
  ])("loads %s through c12", async (filename, content) => {
    const cwd = await createProject();
    await writeFile(join(cwd, filename), content, "utf8");

    const result = await loadWriteOnceConfig({ cwd });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.config.root).toBe(join(cwd, "docs"));
      expect(result.value.config.include).toEqual(["**/*.md"]);
    }
  });

  it("reports ambiguous discovery and allows explicit selection", async () => {
    const cwd = await createProject();
    await writeFile(join(cwd, "write-once.config.json"), JSON.stringify({ root: "one" }), "utf8");
    await mkdir(join(cwd, ".config"));
    await writeFile(join(cwd, ".config", "write-once.config.yaml"), "root: two\n", "utf8");

    const ambiguous = await loadWriteOnceConfig({ cwd });
    expect(isFailure(ambiguous)).toBe(true);
    if (isFailure(ambiguous))
      expect(ambiguous.error.message).toContain("Multiple write-once configuration files");

    const selected = await loadWriteOnceConfig({
      cwd,
      configPath: ".config/write-once.config.yaml",
    });
    expect(isSuccess(selected)).toBe(true);
    if (isSuccess(selected)) expect(selected.value.config.root).toBe(join(cwd, "two"));
  });

  it("rejects missing explicit files, invalid content, and invalid config values", async () => {
    const cwd = await createProject();

    const missing = await loadWriteOnceConfig({ cwd, configPath: "missing.json" });
    expect(isFailure(missing)).toBe(true);

    await writeFile(join(cwd, "write-once.config.json"), JSON.stringify({ root: "" }), "utf8");
    const invalid = await loadWriteOnceConfig({ cwd });
    expect(isFailure(invalid)).toBe(true);
    if (isFailure(invalid)) expect(invalid.error.code).toBe("CONFIG_VALIDATION_ERROR");

    await writeFile(join(cwd, "bad.json"), "{ invalid", "utf8");
    const malformed = await loadWriteOnceConfig({ cwd, configPath: "bad.json" });
    expect(isFailure(malformed)).toBe(true);
    if (isFailure(malformed)) expect(malformed.error.code).toBe("CONFIG_LOAD_ERROR");
  });
});
