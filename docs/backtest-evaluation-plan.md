# Backtest Evaluation Plan

This project evaluates the frozen SP500 reversal-zone signal in two separate
layers:

1. a signal event study measured from the completed signal candle close; and
2. an executable trade-policy study with explicit entry, fill, cost, and
   portfolio assumptions.

Underlying MFE is not option PnL. Option premium, spread, implied volatility,
Greeks, expiry selection, and liquidity must remain explicitly unmodeled until
historical option quotes are available.

## Frozen Signal Contract

The live implementation remains `src/signal-engine.ts`. The local research port
is `python/reversal_scanner_backtest/signal_engine.py`. Python regression tests
compare frozen numeric constants with the TypeScript source and compare frozen
thresholds with `wrangler.toml` so drift fails validation.

The v1 thresholds remain:

- watch: price-R >= 2 and score >= 64;
- alert: price-R >= 3.5 and score >= 72;
- signal price: latest completed candle close;
- invalidation and target: frozen values emitted at signal time.

The score is a deterministic heuristic score, not a calibrated probability or
statistical confidence interval.

## Reproducible Runner

The default CLI contract uses schema version 2:

```bash
uv run reversal-scanner-backtest \
  --input path/to/candles.json \
  --output backtest/reversal_backtest.json \
  --output-dir backtest \
  --replay-mode live \
  --entry-mode next-open \
  --source-timezone America/Chicago \
  --slippage-points 0.25 \
  --round-trip-cost-points 0.10
```

Every output records the input SHA-256, schema version, source/session timezone,
data-quality results, replay cadence, lookback window, signal scope, and
execution assumptions. Reports created by older ignored runners that do not
contain this metadata are historical scratch evidence and must not be presented
as current reproducible results.

## Live Replay

`--replay-mode live` mirrors the production scanner:

- evaluate at the configured 15-minute cadence outside the New York final hour;
- evaluate every 5 minutes from 15:00 to 16:00 New York time;
- expose no more than the configured 18-hour candle request window; and
- group the active session in `America/New_York`.

`--replay-mode every-bar` is retained only for research sensitivity. It must be
labeled as such and cannot be compared directly with live alert counts.

Strict alerts are evaluated by default. `--signal-scope watch-and-alert` is a
separate notification-opportunity study and must not be mixed with alert-only
trade results.

## Data Contract

Before replay, the runner validates:

- monotonically increasing and unique candle timestamps;
- finite and internally valid OHLC values;
- exact candle duration;
- non-negative volume; and
- unexpected missing intervals inside a session date.

Zero-volume and no-weekend datasets produce explicit warnings. A zero-volume
dataset forces the signal VWAP calculation to fall back to average close and is
not equivalent to live Hyperliquid VWAP.

Naive Central Time text must be converted with IANA timezone rules rather than
a fixed offset:

```bash
node scripts/convert-ohlc-to-candles.mjs \
  --input path/to/SPX_CT.csv \
  --output data/local/spx-utc.json \
  --date-column datetime \
  --open-column open \
  --high-column high \
  --low-column low \
  --close-column close \
  --interval-minutes 5 \
  --date-format "yyyy-mm-dd hh:mm:ss" \
  --timezone America/Chicago
```

## Execution Contract

Signal-distribution metrics continue to use the signal close so MFE/MAE remain
comparable with the frozen event definition. Trade-policy metrics default to the
next bar open and:

- skip an entry if the frozen stop or target was already passed;
- use the worse opening price when a candle gaps through a stop;
- apply adverse slippage to entry and exit fills;
- deduct configured round-trip point cost; and
- calculate R from the actual entry-to-stop risk for every stop or delayed-entry
  variant.

Overlapping event rows remain valid signal observations. The experimental
vectorbt adapter uses a single shared position and can ignore overlapping
same-direction entries; its trade count must therefore never be presented as
the canonical event count.

## Statistical Evaluation

The required report contains:

- event and filled/skipped execution counts;
- separate bullish and bearish summaries in `reports/direction_summary.md`;
- MFE, MAE, EOD, stop/target, retry, and delayed-entry results;
- volatility- and session-range-matched placebo distributions;
- direction-aware placebo advantage percentiles, where lower MAE is better;
- session-date cluster-bootstrap 95% intervals for hit rate, EOD mean, stop
  expectancy, and profit factor; and
- explicit cost and fill assumptions.

Placebo candidates match weekday, exact five-minute clock slot, trailing ATR, and observed
session-range-in-ATR, and exclude the real event date. When fewer than 20 close
volatility matches exist, the comparison falls back to the time-matched pool and
should be treated as lower-confidence evidence.

## Walk-Forward And Promotion Gate

The runner now emits `reports/walk_forward_summary.md`. Its default frozen-rule
stability view uses a rolling 12-month context window and a following 6-month
test window, advancing by 6 months so test windows do not overlap. Train rows do
not select parameters; they provide past-regime context only.

Parameter selection remains future work. Any optimizer must use these same
chronological boundaries, may use past data only, and should also be tested with
24-month train / 6-month test folds. A final holdout must remain untouched until
all rules, costs, and metrics have been frozen.

Promotion requires all of the following:

- positive out-of-sample net expectancy with a cluster-aware interval that does
  not rely on treating clustered signals as independent;
- results that remain positive under predeclared slippage and cost scenarios;
- no single fold or crisis period contributing a dominant share of profit;
- acceptable drawdown and losing-streak behavior; and
- independently useful results for bullish reversal trades and bearish crash
  monitoring, evaluated as different tasks.

No threshold should be promoted from MFE percentile alone.
