// Settings: the defaults below, overridden by an optional JSON file, with
// secrets and the trading mode taken from the environment.
//
// Every number here is a starting point, not a recommendation. Run on paper,
// read the journal, and change them deliberately.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const LIVE_CONFIRM_PHRASE = 'I-ACCEPT-REAL-MONEY-RISK';

export const DEFAULTS = {
  mode: 'paper', // 'paper' or 'live'; set with TRADING_MODE
  dryRun: false, // read everything, place nothing
  pollSeconds: 60,
  closedPollSeconds: 300, // while the market is shut
  dataDir: 'data',

  // The only symbols the bot will ever trade. Names are matched as whole
  // words, case-sensitively, so "Apple" matches but "apple pie" does not.
  watchlist: [
    { symbol: 'AAPL', names: ['Apple'] },
    { symbol: 'MSFT', names: ['Microsoft'] },
    { symbol: 'NVDA', names: ['Nvidia', 'NVIDIA'] },
    { symbol: 'AMZN', names: ['Amazon'] },
    { symbol: 'GOOGL', names: ['Alphabet', 'Google'] },
    { symbol: 'META', names: ['Meta Platforms', 'Facebook'] },
    { symbol: 'TSLA', names: ['Tesla'] },
    { symbol: 'AMD', names: ['Advanced Micro Devices'] },
    { symbol: 'NFLX', names: ['Netflix'] },
    { symbol: 'JPM', names: ['JPMorgan', 'JP Morgan'] },
  ],

  news: {
    lookbackMinutes: 120, // how far back to read on a fresh start
    maxArticlesPerPoll: 60,
    requestTimeoutMs: 15000,
    // trust: 0..1, how much a story from this source counts. Wire press
    // releases are primary sources but written by the company. SEC filings
    // are the company's legal disclosures.
    sources: [
      { id: 'alpaca', type: 'alpaca', name: 'Alpaca News (Benzinga)', trust: 0.75, enabled: true },
      {
        id: 'sec-8k', type: 'rss', name: 'SEC EDGAR 8-K filings', trust: 0.95, enabled: true,
        url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={symbol}&type=8-K&dateb=&owner=include&count=10&output=atom',
        requiresEnv: 'SEC_USER_AGENT',
      },
      {
        id: 'yahoo', type: 'rss', name: 'Yahoo Finance headlines', trust: 0.6, enabled: true,
        url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US',
      },
      {
        id: 'globenewswire', type: 'rss', name: 'GlobeNewswire (public companies)', trust: 0.7, enabled: true,
        url: 'https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies',
      },
      {
        id: 'prnewswire', type: 'rss', name: 'PR Newswire', trust: 0.7, enabled: true,
        url: 'https://www.prnewswire.com/rss/news-releases-list.rss',
      },
      {
        id: 'cnbc', type: 'rss', name: 'CNBC Top News', trust: 0.65, enabled: true,
        url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
      },
      {
        id: 'marketwatch', type: 'rss', name: 'MarketWatch Top Stories', trust: 0.65, enabled: true,
        url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
      },
    ],
  },

  analysis: {
    provider: 'auto', // 'claude', 'keywords', or 'auto' (Claude when a key is set)
    model: 'claude-opus-5-5',
    effort: 'medium', // low | medium | high | xhigh | max
    batchSize: 8, // articles per Claude request
    maxCallsPerHour: 60, // cost ceiling; extra articles fall back to keywords
  },

  signal: {
    halfLifeMinutes: 45, // a story's weight halves every this many minutes
    maxArticleAgeMinutes: 240,
    minConfidence: 0.5, // analyses below this are ignored
    entryThreshold: 0.6, // |score| needed to open a position
    exitThreshold: 0.3, // close when the score turns this far against you
    overnightCarryHours: 18, // pre-open news counts as fresh at the open; 0 to disable
  },

  // Trade only when the price is already moving the way the news says, but
  // has not run so far that the move is over.
  confirmation: {
    enabled: true,
    lookbackMinutes: 15,
    minMovePct: 0.1,
    maxChasePct: 3.0, // over the lookback window
    maxDayMovePct: 6.0, // from yesterday's close, so a gap counts as chasing
    requireVwap: true, // longs above session VWAP, shorts below
    feed: 'iex', // 'iex' on Alpaca's free plan, 'sip' with a paid one
  },

  risk: {
    riskPerTradePct: 0.5, // equity lost if a stop is hit
    stopLossPct: 1.5,
    takeProfitPct: 3.0,
    maxPositionPct: 10, // of equity, per position
    maxOpenPositions: 4,
    maxTradesPerDay: 10,
    maxDailyLossPct: 2.0, // account-wide; halts entries for the day
    flattenOnDailyLoss: true,
    maxHoldMinutes: 180,
    cooldownMinutes: 60, // before re-entering a symbol
    allowShort: false,
    minPrice: 5,
    skipOpenMinutes: 5, // no entries in the opening scramble
    noEntryMinutesBeforeClose: 30,
    flattenMinutesBeforeClose: 10,
    pdtGuard: true, // honour pattern-day-trader counters if the broker reports them
    // Trade with only part of the account. null uses the whole account.
    // { amount: 100, currency: 'GBP' } sizes every trade, and the daily loss
    // limit, as if the account held 100 pounds, converted to dollars at the
    // broker's rate each day. Set fxRate to fix the rate yourself. The
    // BOT_CAPITAL environment variable ("100 GBP", "£100") sets the same thing.
    capital: null,
    // Buy fractional shares when a whole share costs more than a position may.
    // The broker cannot attach a stop and target to a fractional order, so
    // the bot watches them itself, once per poll.
    allowFractional: true,
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge; arrays and scalars in `over` replace those in `base`. */
export function merge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export class ConfigError extends Error {}

function check(cond, msg) {
  if (!cond) throw new ConfigError(msg);
}

export function validate(cfg) {
  check(cfg.mode === 'paper' || cfg.mode === 'live', `mode must be "paper" or "live", got "${cfg.mode}"`);
  check(Array.isArray(cfg.watchlist) && cfg.watchlist.length > 0, 'watchlist must list at least one symbol');
  for (const w of cfg.watchlist) {
    check(typeof w.symbol === 'string' && /^[A-Z][A-Z.]{0,9}$/.test(w.symbol), `bad watchlist symbol: ${JSON.stringify(w.symbol)}`);
  }
  const r = cfg.risk;
  const pct = (name, v, max) => check(Number.isFinite(v) && v > 0 && v <= max, `risk.${name} must be between 0 and ${max}, got ${v}`);
  pct('riskPerTradePct', r.riskPerTradePct, 5);
  pct('stopLossPct', r.stopLossPct, 20);
  pct('takeProfitPct', r.takeProfitPct, 50);
  pct('maxPositionPct', r.maxPositionPct, 100);
  pct('maxDailyLossPct', r.maxDailyLossPct, 50);
  check(Number.isInteger(r.maxOpenPositions) && r.maxOpenPositions >= 1, 'risk.maxOpenPositions must be a whole number of at least 1');
  check(r.flattenMinutesBeforeClose < r.noEntryMinutesBeforeClose,
    'risk.flattenMinutesBeforeClose must be smaller than risk.noEntryMinutesBeforeClose');
  if (r.capital != null) {
    check(Number.isFinite(r.capital.amount) && r.capital.amount > 0, `risk.capital.amount must be a positive number, got ${r.capital.amount}`);
    check(/^[A-Z]{3}$/.test(r.capital.currency || ''), `risk.capital.currency must be a three-letter code such as GBP, got ${r.capital.currency}`);
    check(r.capital.fxRate == null || (Number.isFinite(r.capital.fxRate) && r.capital.fxRate > 0), 'risk.capital.fxRate must be a positive number');
  }
  const s = cfg.signal;
  check(s.entryThreshold > 0 && s.exitThreshold > 0, 'signal thresholds must be positive');
  check(['low', 'medium', 'high', 'xhigh', 'max'].includes(cfg.analysis.effort), `analysis.effort is not a valid level: ${cfg.analysis.effort}`);
  check(['auto', 'claude', 'keywords'].includes(cfg.analysis.provider), `analysis.provider must be auto, claude or keywords`);
  for (const src of cfg.news.sources) {
    check(src.trust >= 0 && src.trust <= 1, `news source ${src.id}: trust must be between 0 and 1`);
  }
  return cfg;
}

/**
 * Build the effective configuration.
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string|false} [opts.configPath] JSON file of overrides; false for none
 * @param {object} [opts.overrides] applied last (used by the CLI and tests)
 */
export function loadConfig({ env = process.env, configPath, overrides = {} } = {}) {
  let cfg = structuredClone(DEFAULTS);
  // configPath === false skips the file entirely (tests use this).
  const path = configPath === false ? null : configPath || env.BOT_CONFIG || (existsSync('config.json') ? 'config.json' : null);
  if (path) {
    const file = resolve(path);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new ConfigError(`could not read config file ${file}: ${err.message}`);
    }
    cfg = merge(cfg, parsed);
  }
  if (env.TRADING_MODE) cfg.mode = env.TRADING_MODE.trim().toLowerCase();
  if (env.BOT_CAPITAL) cfg.risk.capital = parseCapital(env.BOT_CAPITAL);
  cfg = merge(cfg, overrides);

  cfg.secrets = {
    alpacaKeyId: env.ALPACA_API_KEY_ID || '',
    alpacaSecretKey: env.ALPACA_API_SECRET_KEY || '',
    hasAnthropicCredentials: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    secUserAgent: env.SEC_USER_AGENT || '',
  };

  validate(cfg);

  if (cfg.mode === 'live' && !cfg.dryRun && env.LIVE_TRADING_CONFIRM !== LIVE_CONFIRM_PHRASE) {
    throw new ConfigError(
      `TRADING_MODE=live places real orders with real money. To allow it, also set ` +
      `LIVE_TRADING_CONFIRM=${LIVE_CONFIRM_PHRASE}`,
    );
  }
  return cfg;
}

const SYMBOL_CURRENCY = { '£': 'GBP', '$': 'USD', '€': 'EUR' };

/** "100 GBP", "£100", "250" (dollars) -> { amount, currency } */
export function parseCapital(text) {
  const m = String(text).trim().match(/^([£$€])?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]{3})?$/);
  if (!m) throw new ConfigError(`BOT_CAPITAL should look like "100 GBP" or "£100", got "${text}"`);
  const currency = (m[3] || SYMBOL_CURRENCY[m[1]] || 'USD').toUpperCase();
  return { amount: Number(m[2].replace(/,/g, '')), currency };
}

export function hasBrokerKeys(cfg) {
  return Boolean(cfg.secrets.alpacaKeyId && cfg.secrets.alpacaSecretKey);
}
