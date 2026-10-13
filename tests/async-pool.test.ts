import { describe, expect, it } from "vitest";

import { mapConcurrent } from "@/async-pool";

describe("mapConcurrent", () => {
  it("returns an empty result without invoking the operation for empty input", async () => {
    let calls = 0;
    const result = await mapConcurrent([], 2, async () => {
      calls += 1;
      return "unexpected";
    });

    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("caps active work and preserves input order", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapConcurrent([3, 2, 1, 0], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, value * 2));
      active -= 1;
      return value * 2;
    });

    expect(maximum).toBe(2);
    expect(result).toEqual([6, 4, 2, 0]);
  });

  it("keeps the default worker window bounded when no configured cap is supplied", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapConcurrent(
      Array.from({ length: 24 }, (_, index) => index),
      Infinity,
      async (value) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return value;
      },
    );

    expect(maximum).toBeLessThanOrEqual(8);
    expect(result).toEqual(Array.from({ length: 24 }, (_, index) => index));
  });

  it("stops scheduling new work after a failure and settles active work", async () => {
    const started: number[] = [];
    await expect(
      mapConcurrent([0, 1, 2, 3], 2, async (value) => {
        started.push(value);
        if (value === 0) throw new Error("failed");
        await Promise.resolve();
        return value;
      }),
    ).rejects.toThrow("failed");
    expect(started).not.toContain(2);
    expect(started).not.toContain(3);
  });
});
