import { afterEach, describe, expect, it, vi } from "vitest";

import { createCliProgressReporter } from "@/cli/progress";

afterEach(() => {
  vi.useRealTimers();
});

describe("createCliProgressReporter", () => {
  it("keeps fast operations silent", async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const reporter = createCliProgressReporter({ isTTY: false, write, delayMs: 100 });

    reporter.report({
      pluginId: "github",
      phase: "start",
      message: 'Plugin "GitHub" is preparing resources.',
    });
    reporter.report({
      pluginId: "github",
      phase: "success",
      message: 'Plugin "GitHub" finished preparing resources.',
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(write).not.toHaveBeenCalled();
    reporter.dispose();
  });

  it("reports slow operations in non-TTY output and includes failure status", async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const reporter = createCliProgressReporter({ isTTY: false, write, delayMs: 10 });

    reporter.report({
      pluginId: "github",
      phase: "start",
      message: 'Plugin "GitHub" is preparing resources.',
    });
    await vi.advanceTimersByTimeAsync(10);
    reporter.report({
      pluginId: "github",
      phase: "progress",
      message: 'Plugin "GitHub": Fetching repository.',
    });
    reporter.report({
      pluginId: "github",
      phase: "failure",
      message: 'Plugin "GitHub" failed while preparing resources.',
    });

    expect(write.mock.calls.flat().join("")).toContain("is preparing resources");
    expect(write.mock.calls.flat().join("")).toContain("Fetching repository");
    expect(write.mock.calls.flat().join("")).toContain("failed while preparing");
    reporter.dispose();
  });

  it("clears the TTY spinner and reports successful completion", async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const reporter = createCliProgressReporter({ isTTY: true, write, delayMs: 10 });

    reporter.report({
      pluginId: "github",
      phase: "start",
      message: 'Plugin "GitHub" is preparing resources.',
    });
    await vi.advanceTimersByTimeAsync(10);
    reporter.report({
      pluginId: "github",
      phase: "success",
      message: 'Plugin "GitHub" finished preparing resources.',
    });

    const output = write.mock.calls.flat().join("");
    expect(output).toContain("\x1b[2K");
    expect(output).toContain('✓ Plugin "GitHub" finished preparing resources.');
    expect(vi.getTimerCount()).toBe(0);
    reporter.dispose();
  });

  it("truncates spinner updates to prevent wrapping in narrow terminals", async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const reporter = createCliProgressReporter({
      isTTY: true,
      columns: 32,
      write,
      delayMs: 10,
    });

    reporter.report({
      pluginId: "github",
      phase: "start",
      message: 'Plugin "GitHub": Resolving repository references and preparing local checkouts.',
    });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(80);

    const frames = write.mock.calls.flat().map(String);
    for (const frame of frames) {
      const line = frame.startsWith("\r\x1b[2K") ? frame.slice(5) : frame;
      expect(Array.from(line).length).toBeLessThan(32);
    }
    expect(frames.some((frame) => frame.includes("…"))).toBe(true);

    reporter.dispose();
  });
});
