// What the bot remembers between ticks and restarts: which articles it has
// already read, the analyses it paid for, the positions it opened, and the
// day's counters. Saved as JSON, written atomically.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { MINUTE } from './time.js';

const SEEN_TTL = 3 * 24 * 60 * MINUTE;

export function emptyState() {
  return {
    version: 1,
    day: null, // New York date the counters below belong to
    tradesToday: 0,
    halted: null, // { reason, at } once the daily loss limit trips
    lastPollAt: null,
    seen: {}, // article key -> first-seen ms
    analyses: [], // recent per-(article, symbol) analyses
    entries: {}, // symbol -> position the bot opened and manages
    lastExitAt: {}, // symbol -> ms, for the re-entry cooldown
    claudeCalls: [], // timestamps, for the hourly cost ceiling
  };
}

export class StateStore {
  constructor(file) {
    this.file = file;
    this.data = emptyState();
  }

  static forDir(dataDir, { dryRun = false } = {}) {
    return new StateStore(join(dataDir, dryRun ? 'state.dry-run.json' : 'state.json'));
  }

  load() {
    if (this.file && existsSync(this.file)) {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = { ...emptyState(), ...parsed };
    }
    return this;
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  prune(nowMs, maxAnalysisAgeMin) {
    const d = this.data;
    for (const [k, t] of Object.entries(d.seen)) if (nowMs - t > SEEN_TTL) delete d.seen[k];
    d.analyses = d.analyses.filter((a) => nowMs - a.publishedAt <= maxAnalysisAgeMin * MINUTE);
    d.claudeCalls = d.claudeCalls.filter((t) => nowMs - t < 60 * MINUTE);
  }
}

/** In-memory store for tests and one-off commands. */
export const memoryState = () => new StateStore(null);
