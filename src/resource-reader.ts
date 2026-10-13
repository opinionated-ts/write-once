import { readFile } from "node:fs/promises";

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
  clear(): void;
}

type ReadText = (path: string) => Promise<string>;

/** Shares in-flight and completed file reads by normalized root + relative path. */
export function createResourceReader(
  readText: ReadText = (path) => readFile(path, "utf8"),
): ResourceReader {
  const contents = new Map<string, Promise<string>>();

  return {
    async read(resource, source, resolverId, context) {
      let pending = contents.get(resource.id);
      if (pending === undefined) {
        pending = readText(resource.absolutePath);
        contents.set(resource.id, pending);
      }

      let text: string;
      try {
        text = await pending;
      } catch (cause) {
        contents.delete(resource.id);
        throw SourceResolutionError({
          message: `Could not read source "${source}" resolved by "${resolverId}": ${cause instanceof Error ? cause.message : String(cause)}`,
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
        id: resource.id,
        location: resource.location,
        text,
        ...(resource.metadata === undefined ? {} : { metadata: resource.metadata }),
      };
    },
    clear() {
      contents.clear();
    },
  };
}
