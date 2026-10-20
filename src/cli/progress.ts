import type { GenerationProgressEvent, GenerationProgressReporter } from "../types.js";

export interface CliProgressOptions {
  isTTY: boolean;
  write: (text: string) => void;
  columns?: number;
  delayMs?: number;
}

interface ActiveOperation {
  message: string;
}

const SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;

function fitTerminalLine(text: string, columns: number | undefined): string {
  // Leave the final terminal column unused to avoid delayed-wrap behavior.
  if (columns === undefined || columns < 1) return text;
  const maxLength = Math.max(1, columns - 1);
  const characters = Array.from(text);
  if (characters.length <= maxLength) return text;
  if (maxLength <= 1) return "…";
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}

// Keep a single delayed indicator for concurrent plugin operations.
export function createCliProgressReporter(options: CliProgressOptions): {
  report: GenerationProgressReporter;
  dispose(): void;
} {
  const active = new Map<string, ActiveOperation>();
  const delayMs = options.delayMs ?? 250;
  let visible = false;
  let frame = 0;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let spinner: ReturnType<typeof setInterval> | undefined;

  const render = () => {
    if (!options.isTTY || active.size === 0) return;
    const operations = [...active.entries()];
    const [, operation] = operations[frame % operations.length]!;
    const suffix = operations.length > 1 ? ` (+${operations.length - 1} more)` : "";
    const line = `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${operation.message}${suffix}`;
    options.write(`\r\x1b[2K${fitTerminalLine(line, options.columns)}`);
    frame += 1;
  };

  const show = () => {
    delay = undefined;
    if (active.size === 0 || visible) return;
    visible = true;
    if (options.isTTY) {
      render();
      spinner = setInterval(render, 80);
      return;
    }
    for (const operation of active.values()) options.write(`${operation.message}\n`);
  };

  const stopIndicators = () => {
    if (delay !== undefined) clearTimeout(delay);
    if (spinner !== undefined) clearInterval(spinner);
    delay = undefined;
    spinner = undefined;
  };

  const report = (event: GenerationProgressEvent) => {
    if (event.phase === "start") {
      active.set(event.pluginId, { message: event.message });
      if (visible) {
        if (options.isTTY) render();
        else options.write(`${event.message}\n`);
      } else if (delay === undefined) {
        delay = setTimeout(show, delayMs);
      }
      return;
    }

    const operation = active.get(event.pluginId);
    if (event.phase === "progress") {
      if (operation !== undefined) operation.message = event.message;
      if (visible) {
        if (options.isTTY) render();
        else options.write(`${event.message}\n`);
      }
      return;
    }

    active.delete(event.pluginId);
    if (visible) {
      if (options.isTTY) {
        options.write(`\r\x1b[2K${event.phase === "success" ? "✓" : "✗"} ${event.message}\n`);
      } else {
        options.write(`${event.message}\n`);
      }
    }

    if (active.size === 0) {
      stopIndicators();
      visible = false;
      return;
    }
    if (options.isTTY) render();
  };

  return {
    report,
    dispose() {
      stopIndicators();
      if (options.isTTY && visible) options.write("\r\x1b[2K");
      active.clear();
      visible = false;
    },
  };
}
