import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = resolve(SPIKE_ROOT, 'out');

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Misst die Laufzeit eines Vorgangs in Millisekunden. */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const result = await fn();
  return [result, performance.now() - t0];
}

/**
 * Beobachtet den Speicherverbrauch (RSS) im Hintergrund und liefert das
 * Maximum. Für die PDF-Messung entscheidend: interessant ist nicht der
 * Endwert, sondern die Spitze während des Schreibens.
 */
export function watchRss(intervalMs = 100): { stop: () => { peakMb: number; samples: number } } {
  let peak = process.memoryUsage.rss();
  let samples = 1;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
    samples++;
  }, intervalMs);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      peak = Math.max(peak, process.memoryUsage.rss());
      return { peakMb: peak / 1024 / 1024, samples };
    },
  };
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${((ms % 60_000) / 1000).toFixed(0)} s`;
}

export function fmtMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Läuft `worker` über `items` mit begrenzter Nebenläufigkeit. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}
