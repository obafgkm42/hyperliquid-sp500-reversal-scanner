# Hyperliquid SP500 Reversal Scanner

An experimental, read-only Cloudflare Worker that watches Hyperliquid's
`xyz:SP500` five-minute candles for extreme-price rejection setups. It can send
watch alerts, stricter reversal-zone alerts, status briefs, and deployment
notices to a Discord webhook. It never places, modifies, or cancels orders.

> [!WARNING]
> **NFA — Not Financial Advice.** This project is research and monitoring
> software, not investment, commodity trading, legal, tax, or accounting
> advice. Backtests and event studies are hypothetical, are not actual trading
> results, and do not establish that the scanner is profitable. Read
> [DISCLAIMER.md](DISCLAIMER.md) before using or redistributing alerts.

The project is not affiliated with or endorsed by Hyperliquid, Discord,
Cloudflare, the National Futures Association (NFA), the Commodity Futures
Trading Commission (CFTC), the Securities and Exchange Commission (SEC), or
the owner or operator of any referenced market index.

![Synthetic examples of qualifying and non-qualifying rejection candles](docs/reversal-signal-candle-examples.svg)

## What the scanner detects

A candidate must:

- make a fresh high or low inside the available lookback;
- close back from that extreme with a rejection candle;
- remain in the outer 20% of the observed range;
- have a bounded invalidation beyond the rejection wick;
- offer sufficient underlying-price reward toward VWAP, the session midpoint,
  or an opening-range level; and
- pass the configured price-R and heuristic score thresholds.

`WATCH` is an early notification. `ALERT` preserves the stricter filter. The
reported score is a deterministic heuristic, not a calibrated probability.

The scanner operates on the Hyperliquid `xyz:SP500` perpetual market. That
market is not the official cash SPX index. Basis, funding, oracle, liquidity,
and venue-specific price differences are possible.

## Why bullish and bearish signals are asymmetric

The current policy treats bullish bottom-reversal candidates as the primary
research class. Bearish top-reversal candidates are retained only under a
stricter crash/stress-monitor policy.

That choice is based on one schema-v2 research run covering 2020–2026:

| Direction | Events | MFE at least 20 points | EOD average | Current-stop PF |
| --- | ---: | ---: | ---: | ---: |
| Bullish bottom reversal | 65 | 36.92% | 0.68 points | 1.04 |
| Bearish top/crash monitor | 11 | 9.09% | -2.16 points | 0.54 |

The bullish side had better forward-outcome metrics in that sample, but this is
not a calibrated top/bottom accuracy estimate. The classes are imbalanced, the
dataset has no usable volume, and the combined non-overlapping walk-forward
current-stop profit factor was `0.71`. The result does **not** clear the
project's promotion gate for a tradable strategy.

See [Current evidence](docs/current-evidence.md) for the assumptions,
limitations, and reproducibility metadata. Do not quote the directional table
without its limitations.

## Architecture

```text
Cloudflare Cron
      |
      v
cadence and brief gate
      |
      v
Hyperliquid public candleSnapshot API
      |
      v
fresh extreme -> rejection -> price-R filters
      |
      v
asymmetric regime policy
      |
      v
Discord webhook watch / alert / brief
```

The live Worker stays in TypeScript under `src/`. Local event-study and
backtest tooling stays in Python under `python/reversal_scanner_backtest/`.
Research dependencies and outputs are not part of the Worker runtime.

## Schedule

Cloudflare invokes the Worker every five minutes. The Worker applies a cadence
gate:

- normally every `REGULAR_SCAN_MINUTES` (default `15`);
- every `FINAL_HOUR_SCAN_MINUTES` (default `5`) from 15:00–16:00 New York time;
- status briefs every `BRIEF_INTERVAL_MINUTES` (default `30`); and
- New York weekends throttled to at most once per hour.

The final-hour time-zone check only aligns the faster cadence with the New York
cash-market close. Hyperliquid scanning otherwise remains near-24/7.

## Configuration

Public defaults live in `wrangler.toml`. Store credentials only as Cloudflare
secrets:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put MANUAL_SCAN_TOKEN
```

For local development, copy `.env.example` to `.dev.vars`. Never commit the
real webhook URL or token.

An optional `SCANNER_STATE` KV binding makes version notices exactly once per
deployed version:

```toml
[[kv_namespaces]]
binding = "SCANNER_STATE"
id = "replace-with-kv-namespace-id"
```

## Development

Requirements:

- Node.js 22 or newer;
- Python 3.12; and
- `uv` for the local Python research environment.

```bash
npm ci
npm test
npm run typecheck
uv sync --dev
uv run pytest
```

The core environment does not install vectorbt. The optional portfolio adapter
uses vectorbt 1.x, whose Apache-2.0 base license includes the Commons Clause
commercial restriction. Review [Third-party notices](THIRD_PARTY_NOTICES.md)
before installing it:

```bash
uv sync --dev --extra portfolio
uv run pytest tests_py/test_vectorbt_adapter.py
```

The optional adapter has a narrower dependency-compatibility range than the core
environment, so it is validated separately in Linux CI.

Run the local Worker:

```bash
npm run dev
```

Trigger a local scheduled event:

```text
http://localhost:8787/cdn-cgi/handler/scheduled
```

Run an authenticated, non-notifying manual scan:

```bash
curl http://localhost:8787/scan \
  -H "Authorization: Bearer $MANUAL_SCAN_TOKEN"
```

## Reproducible smoke run

The repository contains only synthetic candle data. It does not redistribute
third-party historical market data.

```bash
uv run reversal-scanner-backtest \
  --input tests/fixtures/synthetic-candles.json \
  --output backtest/smoke/reversal_backtest.json \
  --output-dir backtest/smoke \
  --replay-mode every-bar \
  --source-timezone UTC \
  --placebo-runs 0 \
  --bootstrap-runs 0
```

Generated outputs under `backtest/` are ignored by Git.

## Research contract

The schema-v2 runner:

- records the dataset SHA-256 and validation warnings;
- separates signal-close MFE/MAE from executable next-open trade metrics;
- models gap-through stops, adverse slippage, and round-trip costs;
- reports bullish and bearish directions separately;
- uses session-cluster confidence intervals; and
- emits non-overlapping walk-forward summaries.

Bring your own lawfully obtained candle data. A Hugging Face helper is included
for downloading a specifically selected dataset file, but every dataset has
its own license and usage conditions. Review its dataset card before download
or use.

See [Backtest evaluation plan](docs/backtest-evaluation-plan.md) for the full
data, execution, statistical, and promotion contracts.

## Deployment

After reviewing the applicable service terms and setting secrets:

```bash
npm run deploy
```

Deployment does not make the alerts compliant in every jurisdiction. Public,
paid, personalized, or account-linked alert services can create obligations
that do not apply to private, impersonal research software. See
[COMPLIANCE.md](COMPLIANCE.md).

## Security, compliance, and license

- [Disclaimer and hypothetical-performance notice](DISCLAIMER.md)
- [Service and regulatory compliance notes](COMPLIANCE.md)
- [Third-party dependency notices](THIRD_PARTY_NOTICES.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [MIT License](LICENSE)

The MIT License covers this repository's original code and documentation. It
does not grant rights to third-party market data, service marks, APIs, or
datasets.
