// Console output plus an append-only JSONL journal per trading day. The
// journal records every decision with its reasons, so you can audit why the
// bot did (or did not) trade.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nyDateKey } from './time.js';

export function createLogger({ dataDir, quiet = false, now = Date.now, write = true } = {}) {
  if (write && dataDir) mkdirSync(dataDir, { recursive: true });
  const events = [];

  function record(level, type, message, data) {
    const at = now();
    const entry = { at: new Date(at).toISOString(), level, type, message, ...(data ? { data } : {}) };
    events.push(entry);
    if (write && dataDir) {
      try {
        appendFileSync(join(dataDir, `journal-${nyDateKey(at)}.jsonl`), JSON.stringify(entry) + '\n');
      } catch (err) {
        if (!quiet) console.error(`[journal] could not write: ${err.message}`);
      }
    }
    if (!quiet) {
      const time = entry.at.slice(11, 19);
      const line = `${time} ${level.toUpperCase().padEnd(5)} ${message}`;
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
    }
    return entry;
  }

  return {
    events,
    info: (message, data) => record('info', 'info', message, data),
    warn: (message, data) => record('warn', 'warn', message, data),
    error: (message, data) => record('error', 'error', message, data),
    /** A structured decision or action: signal, order, exit, halt... */
    event: (type, message, data) => record('info', type, message, data),
  };
}

export const silentLogger = () => createLogger({ quiet: true, write: false });
