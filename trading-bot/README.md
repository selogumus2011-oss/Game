# News Trading Bot

An intraday trading bot for US stocks. It reads news from sources you choose,
has Claude judge how each story is likely to move the stock over the next few
hours, waits for the price to agree, and then buys (or, if you allow it, shorts)
through [Alpaca](https://alpaca.markets) with a stop-loss and a take-profit
attached to every order. It closes everything before the market closes.

It starts in **paper trading** mode, with simulated money on Alpaca's paper
account. Live trading needs two deliberate settings.

> **Read this first.** No bot can reliably predict prices. News moves markets
> fast, and professional firms read the same headlines in microseconds; by the
> time an RSS feed updates, much of the move is often over. Most retail day
> traders lose money. Use this to learn and experiment on paper. Only risk money
> you can afford to lose, and only after weeks of paper results you have read
> and understood. This is software, not financial advice.

---

## How it decides

Every minute (every five while the market is shut):

1. **Collect.** It fetches new articles from every enabled source and maps each
   one to symbols on your watchlist. An article about a company that is not on
   the watchlist is ignored, so a headline can never make it trade something
   you did not choose. The same story from two outlets is merged and the more
   trusted copy is kept.
2. **Analyse.** Claude reads each article and returns, for each watchlist symbol
   it mentions, a *direction* (bullish, bearish, neutral), an *impact* (none to
   high), a *confidence* (0 to 1), and whether it is *new* or a *follow-up*,
   *recap* or *opinion*. The model is told to discount stories describing moves
   that already happened, press-release spin and passing mentions. Each article
   is analysed once and the result is saved.
3. **Score.** Each symbol's score is the sum of its analyses:

   ```
   direction × impact × confidence × source trust × novelty weight × freshness
   ```

   Freshness halves every 45 minutes. News released between yesterday afternoon
   and this morning's open is treated as fresh at the open. A single brand-new,
   high-impact, fully confident story from a fully trusted source scores 1.0.
   The default bar to trade is 0.6.
4. **Confirm.** A strong score is not enough. The price must already be moving
   the same way, by at least 0.1% over the last 15 minutes. It must not have run
   more than 3% in that window, or 6% from yesterday's close. It must also be on
   the right side of the day's volume-weighted average price (VWAP).
5. **Size and order.** The position is sized so that hitting the stop loses
   0.5% of the account. It is capped at 10% of the account in one stock, and by
   buying power. The order is a *bracket*: a market entry with a stop-loss 1.5%
   away and a take-profit 3% away, both held at the broker. They protect the
   position even if the bot crashes.
6. **Exit.** A position closes when its stop or target fills, when the news
   turns against it, after three hours, or ten minutes before the close.

## Safety rails

- **Paper by default.** Live mode needs `TRADING_MODE=live` *and*
  `LIVE_TRADING_CONFIRM=I-ACCEPT-REAL-MONEY-RISK`.
- **Your other holdings are left alone.** The bot only sells or closes positions
  it opened itself. It will not trade a symbol you already hold.
- **Daily loss limit.** If the account falls 2% on the day, the bot stops
  opening trades and closes its own positions until the next day. With a
  trading budget, the 2% is measured on the bot's own P&L against the budget.
- **Limits.** At most four positions and ten trades a day. No entries in the
  first five minutes or the last thirty. A one-hour cooldown applies before
  re-entering a symbol. There is a $5 minimum share price, and no shorting
  unless you turn it on.
- **Pattern-day-trader guard.** If the broker reports day-trade counters, the
  bot will not open a fourth day trade in five days on an account under
  $25,000.
- **One copy at a time.** A lock file stops two bots trading the same account.
- **Cost ceiling.** At most 60 Claude requests an hour. Anything past that is
  scored by the keyword fallback.
- **Dry run.** `--dry-run` reads live data and logs every order it *would*
  place, without placing it.
- **Audit trail.** Every analysis, skip, order and exit is written with its
  reasons to `data/journal-YYYY-MM-DD.jsonl`.

## Setup

You need Node.js 22 or newer.

```bash
cd trading-bot
npm install
cp .env.example .env
```

Then fill in `.env`:

1. **Alpaca keys.** Sign up at alpaca.markets, open the *paper trading*
   dashboard, and generate an API key. Put it in `ALPACA_API_KEY_ID` and
   `ALPACA_API_SECRET_KEY`. These also unlock Alpaca's news feed and the price
   data the bot needs.
2. **Anthropic key.** Create one at console.anthropic.com and put it in
   `ANTHROPIC_API_KEY`. Without it the bot falls back to keyword matching. That
   is far weaker and on its own rarely reaches the entry threshold.
3. **SEC filings (optional).** The SEC asks automated readers to identify
   themselves. Set `SEC_USER_AGENT` to your name and email, for example
   `Jane Doe jane@example.com`, to turn on the 8-K filings source.

Check that the news sources respond before trading:

```bash
npm run sources
```

## Commands

```bash
npm run signals     # read and score the news now; no broker needed, no orders
npm run sources     # test every news source
npm run status      # account, the bot's positions, your positions, open orders
npm run dry-run     # run against live data, place nothing
npm start           # run and trade (paper unless configured otherwise)
npm run once        # a single cycle, then exit
npm run flatten     # close the positions the bot opened
npm test            # the test suite; no network or keys needed
```

`Ctrl+C` stops the bot after the current cycle. Open bracket orders stay at the
broker, so positions keep their stop and target.

To close *every* position in the account, including ones the bot did not open:

```bash
node src/index.js flatten --all --yes
```

## Trading a small amount

A paper account starts with $100,000 of pretend money. To have the bot behave
as if it had a small pot, set a budget in `.env`:

```
BOT_CAPITAL=£100
```

The bot converts it to dollars at the broker's live rate once a day. Every
position, the total it holds at once, and the daily loss limit are then sized
from the budget, and the rest of the account is ignored. If the rate cannot be
fetched, it stops trading rather than guess. Give the rate yourself with
`risk.capital.fxRate` in `config.json` if that keeps happening.

With £100, the default 10% position limit is about £10. That is less than one
share of most large companies, so the bot buys **fractional shares**. The
broker cannot attach a stop and target to a fractional order, so the bot
watches them itself, once a minute. That has two consequences:

- A fast fall can go past the stop before the bot's next check.
- While the bot is not running, a fractional position has no stop at all. If
  you stop it during the day and will not restart it, run `npm run flatten`.

A position of about £10 also means gains and losses are pennies. That is fine
for testing whether the signals work. To let each trade use more of the budget,
raise `risk.maxPositionPct` in `config.json`.

## Configuration

Every setting and its default is in `src/config.js`, with a comment. To change
any of them, create `config.json` next to this README. It only needs the keys
you want to change. `config.example.json` shows the shape. The watchlist is the
setting most worth changing. Pick liquid stocks you understand, and give each
one the names the press uses for it, so headlines match.

News sources are configured the same way, under `news.sources`. Each has a
`trust` from 0 to 1. Add any RSS or Atom feed with `"type": "rss"` and its
`url`. Put `{symbol}` in the URL for a per-symbol feed.

| Source | Default trust | Notes |
| --- | --- | --- |
| SEC EDGAR 8-K filings | 0.95 | The company's legal disclosures. Needs `SEC_USER_AGENT`. |
| Alpaca News (Benzinga) | 0.75 | Needs Alpaca keys. |
| GlobeNewswire, PR Newswire | 0.70 | Company press releases: primary, but promotional. |
| CNBC, MarketWatch | 0.65 | General market news. |
| Yahoo Finance headlines | 0.60 | Per-symbol aggregator. |

## What Claude costs

Each request scores up to eight articles, using `claude-opus-5-5` at medium
effort. A batch is roughly 2,000 input and 2,000 output tokens, including the
model's reasoning, so about $0.05. That is an estimate, not a measurement. A
ten-stock watchlist on an ordinary day might need a few dozen batches. The
hourly ceiling bounds the worst case at 60 requests an hour. Lower
`analysis.effort` to `low` to spend less. Raise `analysis.batchSize` for fewer,
larger requests.

If a request is declined by a safety classifier, it is automatically retried on
Anthropic's recommended fallback model, through the API's server-side
`fallbacks` option. If that also fails, the batch is scored by keywords.

## Known limits

- **Unverified feed addresses.** The default RSS URLs could not be tested from
  the environment this was built in, and outlets move their feeds. Run
  `npm run sources` and replace any that fail.
- **Partial price data on the free plan.** Alpaca's free plan uses the IEX feed,
  a few percent of US volume. Prices are accurate, but volume and VWAP are
  approximate. Set `confirmation.feed` to `sip` with a paid data plan.
- **The loss limit counts the whole account.** If you hold other stocks in the
  same account, their moves count toward the daily limit. A dedicated account
  for the bot is simpler.
- **Day-trade counters may be missing.** Alpaca's current published account
  schema does not list them. When the broker does not report them, the guard
  cannot act. Check the rules that apply to your account.
- **No backtesting.** The way to judge it is weeks of paper trading and a careful
  read of the journal.
- **Untrusted article text.** Article text is passed to Claude as untrusted
  data, with instructions to ignore anything it says. Only watchlist symbols
  can be traded, and every risk limit still applies. A planted article can still
  skew one analysis, which is why source trust and price confirmation exist.

## Layout

```
src/
  index.js          command line
  bot.js            the trading loop
  config.js         defaults, overrides, live-mode guard
  news/             feed parser, symbol matching, source collector
  analysis/         Claude analyst, keyword fallback, dispatcher
  strategy/         scoring, price confirmation, sizing and risk rules
  broker/           Alpaca client, dry-run wrapper, simulator for tests
  state.js, log.js  saved state and the decision journal
test/               unit and end-to-end tests against the simulator
```
