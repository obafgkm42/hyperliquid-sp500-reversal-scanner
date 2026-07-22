# Current Evidence and Limitations

This document records the reviewed research run used to justify the
asymmetric live policy. It is a descriptive event study, not actual trading
performance and not proof that the scanner has a durable edge.

## Dataset and replay contract

- Market label: `SPX` historical proxy
- Coverage: January 2020 through July 2026
- Five-minute candles: `130,817`
- Dataset SHA-256: `29ef8459e29a0e82c8436963d4d50dcf1605835fc19ef01976a89ecaddc41d3d`
- Schema: `2`
- Replay: production-style 15-minute cadence, accelerating to five minutes in
  the New York final hour, with an 18-hour visible lookback
- Signal scope: strict alerts
- Entry: next bar open
- Slippage: `0.25` underlying points per fill
- Round-trip cost: `0.10` underlying points
- Gap-through-stop handling: worse opening price

The historical proxy is not the live Hyperliquid market. It contains no usable
volume, so VWAP falls back to average close. It contains no weekend candles and
has 174 unexpected within-session intervals. Those limitations reduce its
ability to reproduce the live near-24/7 scanner.

## Directional results

| Direction | Events | MFE at least 20 points | EOD average | Stop average | Stop PF |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bullish bottom reversal | 65 | 36.92% | 0.68 | 0.17 | 1.04 |
| Bearish top/crash monitor | 11 | 9.09% | -2.16 | -1.35 | 0.54 |

The bullish class performed better on these forward-outcome measures. Calling
it “more accurate” would overstate the evidence because the study does not use
a calibrated top/bottom label, the sample sizes differ materially, and the
observations are sparse.

## Combined stability result

The ten non-overlapping six-month test windows contained 62 events in total:

- MFE at least 20 points: `30.65%`
- EOD average: `-1.98` points
- current-stop average: `-1.18` points
- current-stop profit factor: `0.71`

The full-sample current-stop profit factor was `0.99`, with a session-cluster
bootstrap interval that crossed both loss and profit. These results do not meet
the project's promotion requirements for a tradable strategy.

## Permitted conclusion

The current evidence supports only this limited statement:

> In this historical proxy sample, bullish rejection candidates had better
> forward-outcome metrics than bearish candidates, so the live policy treats
> bullish setups as the primary research class and bearish setups as a stricter
> crash/stress monitor.

It does not support claims of profitability, calibrated accuracy, future
performance, option P&L, or investment suitability.
