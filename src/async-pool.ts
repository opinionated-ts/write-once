/** Run indexed work with bounded concurrency, preserving result order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Number.isFinite(concurrency)
    ? Math.max(1, Math.min(items.length, Math.floor(concurrency)))
    : Math.min(items.length, 8);
  const results: R[] = [];
  let nextIndex = 0;
  let firstFailure: unknown;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        // eslint-disable-next-line no-await-in-loop
        results[index] = await operation(items[index]!, index);
      } catch (cause) {
        if (!failed) {
          failed = true;
          firstFailure = cause;
        }
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  if (failed) throw firstFailure;
  return results;
}
