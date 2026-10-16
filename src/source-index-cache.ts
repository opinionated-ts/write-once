import type { ResolvedContent } from "./types.js";

import { scanMarkers, type ScanMarkersOptions } from "./marker-scanner.js";
import { getTextLines, type TextLine } from "./text-index.js";

export interface SourceIndexCache {
  scanMarkers(
    resource: ResolvedContent,
    options?: ScanMarkersOptions,
  ): ReturnType<typeof scanMarkers>;
  getTextLines(resource: ResolvedContent): TextLine[];
  clear(): void;
}

interface CachedSourceIndexes {
  markers?: ReturnType<typeof scanMarkers>;
  lines?: TextLine[];
}

// Create indexes scoped to one generation run; callers must clear them at run completion.
export function createSourceIndexCache(): SourceIndexCache {
  const indexes = new Map<string, CachedSourceIndexes>();

  function forResource(resource: ResolvedContent): CachedSourceIndexes {
    let cached = indexes.get(resource.id);
    if (cached === undefined) {
      cached = {};
      indexes.set(resource.id, cached);
    }
    return cached;
  }

  return {
    scanMarkers(resource, options) {
      const cached = forResource(resource);
      cached.markers ??= scanMarkers(resource.text, options ?? { resource: resource.location });
      return cached.markers;
    },
    getTextLines(resource) {
      const cached = forResource(resource);
      cached.lines ??= getTextLines(resource.text);
      return cached.lines;
    },
    clear() {
      indexes.clear();
    },
  };
}
