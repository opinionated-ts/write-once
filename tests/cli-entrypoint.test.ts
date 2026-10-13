import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const entrypoint = resolve(import.meta.dirname, "../src/cli.ts");

async function createProject() {
  const cwd = await mkdtemp(join(tmpdir(), "write-once-cli-entrypoint-"));
  directories.push(cwd);
  return cwd;
}

function runCli(cwd: string) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
      const child = spawn("bun", [entrypoint, "generate"], { cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (exitCode) => resolveResult({ exitCode, stdout, stderr }));
    },
  );
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI entrypoint", () => {
  it("runs generation and reports unchanged destinations", async () => {
    const cwd = await createProject();
    const destination = join(cwd, "README.md");
    await writeFile(destination, "plain documentation", "utf8");

    const result = await runCli(cwd);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Updated 0 of 1 destination files; 1 unchanged.");
    expect(result.stderr).toBe("");
    expect(await readFile(destination, "utf8")).toBe("plain documentation");
  });

  it("prints diagnostics and exits unsuccessfully for malformed markers", async () => {
    const cwd = await createProject();
    await writeFile(
      join(cwd, "README.md"),
      'fragment source="./source.md"\\nmissing close',
      "utf8",
    );

    const result = await runCli(cwd);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("[marker]");
    expect(result.stdout).toBe("");
  });
});
