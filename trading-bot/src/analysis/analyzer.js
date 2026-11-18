// Turns fresh articles into per-(article, symbol) analyses, using Claude when
// it is configured and within its hourly budget, and keywords otherwise.

import Anthropic from '@anthropic-ai/sdk';
import { keywordAnalysis } from './keywords.js';
import { ClaudeAnalyst } from './claude.js';
import { MINUTE } from '../time.js';

export const IMPACT = { none: 0, low: 0.33, medium: 0.66, high: 1 };
export const SENTIMENT = { bullish: 1, bearish: -1, neutral: 0 };

export class NewsAnalyzer {
  /**
   * @param {object} opts
   * @param {object} opts.config
   * @param {object} opts.state     StateStore (for the hourly call budget)
   * @param {object} opts.log
   * @param {ClaudeAnalyst|null} [opts.claude]  inject for tests; built from config otherwise
   */
  constructor({ config, state, log, claude, now = Date.now }) {
    this.config = config;
    this.state = state;
    this.log = log;
    this.now = now;
    const a = config.analysis;
    const wantClaude = a.provider === 'claude' || (a.provider === 'auto' && config.secrets?.hasAnthropicCredentials);
    this.claude = claude !== undefined ? claude
      : wantClaude ? new ClaudeAnalyst({ model: a.model, effort: a.effort, watchlist: config.watchlist }) : null;
    this.budgetWarnedAt = 0;
  }

  get method() {
    return this.claude ? `claude (${this.config.analysis.model}, effort ${this.config.analysis.effort})` : 'keywords only';
  }

  withinBudget(nowMs) {
    const calls = this.state.data.claudeCalls.filter((t) => nowMs - t < 60 * MINUTE);
    this.state.data.claudeCalls = calls;
    return calls.length < this.config.analysis.maxCallsPerHour;
  }

  async analyze(items) {
    const nowMs = this.now();
    const rows = [];
    const size = Math.max(1, this.config.analysis.batchSize);
    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      rows.push(...await this.analyzeBatch(batch, nowMs));
    }
    const byKey = new Map(items.map((it) => [it.key, it]));
    return rows.map((r) => {
      const item = byKey.get(r.articleKey);
      return {
        ...r,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        trust: item.trust,
        publishedAt: item.publishedAt,
        title: item.title,
        url: item.url,
        sentiment: SENTIMENT[r.direction] ?? 0,
        impact: IMPACT[r.impactLabel] ?? 0,
        analyzedAt: nowMs,
      };
    });
  }

  async analyzeBatch(batch, nowMs) {
    if (!this.claude) return batch.flatMap(keywordAnalysis);
    if (!this.withinBudget(nowMs)) {
      if (nowMs - this.budgetWarnedAt > 30 * MINUTE) {
        this.log.warn(`Claude budget of ${this.config.analysis.maxCallsPerHour} calls/hour reached; using keywords until it resets`);
        this.budgetWarnedAt = nowMs;
      }
      return batch.flatMap(keywordAnalysis);
    }
    this.state.data.claudeCalls.push(nowMs);
    try {
      const { rows, servedBy } = await this.claude.analyzeBatch(batch, nowMs);
      if (servedBy && servedBy !== this.config.analysis.model) {
        this.log.info(`analysis batch was served by fallback model ${servedBy}`);
      }
      return rows;
    } catch (err) {
      this.log.warn(`Claude analysis failed, using keywords for ${batch.length} article(s): ${describe(err)}`);
      return batch.flatMap(keywordAnalysis);
    }
  }
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'invalid or missing Anthropic API key';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited by the Claude API';
  if (err instanceof Anthropic.APIConnectionError) return 'could not reach the Claude API';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  return err.message;
}
