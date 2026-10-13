import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NormalizedResourcePath } from "./resource-path.js";
import type { ResolvedContent, ResourceContext } from "./types.js";

import { SourceResolutionError } from "./errors/source-resolution-error.js";

export interface ResourceReader {
  read(
    resource: NormalizedResourcePath,
    source: string,
    resolverId: string,
    context: ResourceContext,
  ): Promise<ResolvedContent>;
  setConsumers(consumers: ReadonlyMap<string, number>): void;
  preload(
    resource: NormalizedResourcePath,
    source: string,
    resolverId: string,
    context: ResourceContext,
  ): Promise<void>;
  release(resourceId: string): Promise<void>;
  clear(): Promise<void>;
}

type ReadText = (path: string) => Promise<string>;

interface CachedContent {
  text?: string;
  pending?: Promise<string>;
  spoolPath?: string;
  bytes: number;
  active: number;
  remaining: number;
}

/**
 * Shares source reads by normalized identity and applies a per-run content budget.
 * The budget accounts for retained UTF-16 payload bytes and observed process heap growth.
 * Inactive cached strings spill to a private temporary file when the budget is reached;
 * the original source is still read only once per run.
 */
export function createResourceReader(
  readText: ReadText = (path) => readFile(path, "utf8"),
  memoryBudgetMiB = Number.POSITIVE_INFINITY,
): ResourceReader {
  const contents = new Map<string, CachedContent>();
  const budgetBytes = memoryBudgetMiB * 1024 * 1024;
  const baselineHeapUsed = process.memoryUsage().heapUsed;
  let retainedBytes = 0;
  let consumerCounts = new Map<string, number>();
  let budgetLock = Promise.resolve();
  const spoolDirectory = join(tmpdir(), "write-once-content-" + randomUUID());

  async function withBudgetLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = budgetLock;
    let unlock!: () => void;
    budgetLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
    }
  }

  async function spill(entry: CachedContent): Promise<void> {
    if (entry.text === undefined || entry.active > 0) return;
    if (entry.spoolPath === undefined) {
      entry.spoolPath = join(spoolDirectory, randomUUID() + ".txt");
      await mkdir(spoolDirectory, { recursive: true });
      await writeFile(entry.spoolPath, entry.text, "utf8");
    }
    if (entry.active > 0) return;
    retainedBytes -= entry.bytes;
    entry.text = undefined;
  }

  function exceedsBudget(requiredBytes: number): boolean {
    const retainedPayloadBytes = retainedBytes + requiredBytes;
    const processHeapDelta = Math.max(0, process.memoryUsage().heapUsed - baselineHeapUsed);
    return Math.max(retainedPayloadBytes, processHeapDelta) > budgetBytes;
  }

  async function makeRoomUnsafe(requiredBytes: number, except?: CachedContent): Promise<void> {
    if (!exceedsBudget(requiredBytes)) return;
    // oxlint-disable no-await-in-loop
    for (const entry of contents.values()) {
      if (entry === except || entry.text === undefined || entry.active > 0) continue;
      await spill(entry);
      if (!exceedsBudget(requiredBytes)) return;
    }
    // oxlint-enable no-await-in-loop
    // A single file larger than the budget must still be processable.
  }

  async function makeRoom(requiredBytes: number, except?: CachedContent): Promise<void> {
    await withBudgetLock(() => makeRoomUnsafe(requiredBytes, except));
  }

  async function cacheText(entry: CachedContent, text: string): Promise<void> {
    const bytes = Buffer.byteLength(text, "utf16le");
    await withBudgetLock(async () => {
      if (entry.text !== undefined) return;
      await makeRoomUnsafe(bytes, entry);
      entry.bytes = bytes;
      entry.text = text;
      retainedBytes += bytes;
    });
  }

  return {
    async read(resource, source, resolverId, context) {
      let entry = contents.get(resource.id);
      if (entry === undefined) {
        entry = {
          bytes: 0,
          active: 0,
          remaining: consumerCounts.get(resource.id) ?? Number.POSITIVE_INFINITY,
        };
        contents.set(resource.id, entry);
      }

      let text: string;
      try {
        if (entry.text !== undefined) {
          text = entry.text;
        } else if (entry.pending !== undefined) {
          text = await entry.pending;
        } else if (entry.spoolPath !== undefined) {
          text = await readFile(entry.spoolPath, "utf8");
          await cacheText(entry, text);
        } else {
          entry.pending = readText(resource.absolutePath);
          text = await entry.pending;
          entry.pending = undefined;
          await cacheText(entry, text);
        }
        entry.active += 1;
      } catch (cause) {
        entry.pending = undefined;
        contents.delete(resource.id);
        throw SourceResolutionError({
          message:
            'Could not read source "' +
            source +
            '" resolved by "' +
            resolverId +
            '": ' +
            (cause instanceof Error ? cause.message : String(cause)),
          context: {
            public: {
              source,
              resolverId,
              root: resource.root,
              path: resource.path,
              cwd: context.cwd,
              destination: context.destination,
            },
            cause,
          },
        });
      }

      return {
        root: resource.root,
        path: resource.path,
        id: resource.id,
        location: resource.location,
        text,
        ...(resource.metadata === undefined ? {} : { metadata: resource.metadata }),
      };
    },
    setConsumers(consumers) {
      consumerCounts = new Map(consumers);
      for (const [id, entry] of contents) {
        entry.remaining = consumerCounts.get(id) ?? Number.POSITIVE_INFINITY;
      }
    },
    async preload(resource, source, resolverId, context) {
      await this.read(resource, source, resolverId, context);
      const cached = contents.get(resource.id);
      if (cached !== undefined) {
        cached.active = Math.max(0, cached.active - 1);
        await makeRoom(0);
      }
    },
    async release(resourceId) {
      const entry = contents.get(resourceId);
      if (entry === undefined) return;
      entry.active = Math.max(0, entry.active - 1);
      if (entry.remaining !== Number.POSITIVE_INFINITY) {
        entry.remaining = Math.max(0, entry.remaining - 1);
      }
      if (entry.remaining > 0) {
        await makeRoom(0);
        return;
      }
      await withBudgetLock(async () => {
        if (entry.text !== undefined) retainedBytes -= entry.bytes;
        contents.delete(resourceId);
      });
      if (entry.spoolPath !== undefined) await unlink(entry.spoolPath).catch(() => undefined);
    },
    async clear() {
      const paths = [...contents.values()]
        .map((entry) => entry.spoolPath)
        .filter((path): path is string => path !== undefined);
      contents.clear();
      retainedBytes = 0;
      consumerCounts.clear();
      await Promise.all(paths.map((path) => unlink(path).catch(() => undefined)));
      await rm(spoolDirectory, { recursive: true, force: true });
    },
  };
}
