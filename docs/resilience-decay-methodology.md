# Resilience Decay Methodology

Resilience decay is an event-level diagnostic for the Hyperliquid
`xyz:SP500` proxy. It asks whether comparable intraday drawdowns are repairing
less effectively than earlier drawdowns. It is not a crash probability, trade
signal, or permission to change the frozen reversal rules.

## Live observation contract

The Worker derives a fixed half-hour grid from completed five-minute RTH
candles. Every scheduled RTH scan rebuilds the available grid and writes all
new boundaries as one ordered batch. This makes sampling independent of
`BRIEF_INTERVAL_MINUTES`, catches up after a missed scan, and retains one KV
read plus at most one write per invocation.

A shock starts when a half-hour close is at least `0.6%` below the cumulative
session high. While the event is active, the trough follows the lowest observed
half-hour close. The event completes at the first of:

- recovery to within `0.6%` of the pre-shock session high; or
- the New York cash-session close.

Completion freezes the event trough. A separate sell-off can start another
event, but it cannot rewrite the severity of the completed event.

## Event score

At one hour, two hours, and the session close, the Worker records both the
checkpoint price and the trough known at that checkpoint. This prevents a low
that occurs later from leaking into an earlier recovery ratio.

For checkpoint `h`:

```text
recovery(h) = clamp(
  (price(h) - trough_known_at_h)
  / (pre_shock_session_high - trough_known_at_h),
  0,
  1
)
```

An event is scored only when all three checkpoints are available:

```text
event score = 35% * one-hour recovery
            + 45% * two-hour recovery
            + 20% * close recovery
```

The stored score is expressed on a `0–100` scale. Late-session shocks that
cannot reach the two-hour checkpoint remain unscored rather than receiving
renormalized weights. Logs report both scored and unscored shock counts so this
complete-case rule is visible.

## Decay classification

Classification requires eight scored shocks:

- recent resilience: mean of the latest three scored shocks;
- baseline resilience: mean of the preceding five scored shocks;
- decay delta: recent minus baseline;
- recent slope: ordinary least-squares slope across the three recent scores;
- decay pressure: `2 * negative decay delta + 2 * negative slope`, clamped to
  `0–100`.

Statuses are deterministic:

- `INSUFFICIENT_DATA`: fewer than eight comparable scored shocks;
- `FRAGILE`: recent resilience is below `55`;
- `FADING`: recent resilience is at least `55` and decay delta is at most
  `-15`; and
- `RESILIENT`: neither condition is met.

Only `FADING` is eligible for the detailed Discord field. It does not alter
compact content, colors, mentions, fragility levels, or signal decisions.

## State compatibility and data quality

State schema v2 stores a trough alongside each checkpoint. Version-one events
are migrated without inventing historical troughs; affected checkpoint values
therefore remain unscored and age out naturally. Duplicate and out-of-order
snapshots are ignored. Persisted snapshots and events are runtime-validated
before use; an invalid state is rebuilt from the next valid batch.

## Verification

The TypeScript tests cover:

- shock start, trough, recovery, close, and session rollover;
- checkpoint-specific troughs and absence of future leakage;
- trough freezing across a later independent sell-off;
- duplicate, out-of-order, catch-up, bounded-state, and v1 migration behavior;
- score weights, minimum sample size, slope, pressure bounds, and exact status
  thresholds;
- the scheduled Worker-to-KV path; and
- Discord field and mention-routing regressions.

Run the executable checks with:

```bash
npm test
npm run typecheck
```

Before this diagnostic is allowed to change any alert or trading behavior, a
separate historical replay should preserve the exact half-hour observation
grid, use only information available at each checkpoint, report the share and
time-of-day distribution of unscored shocks, use session-cluster uncertainty,
and test parameter stability out of sample.

## Known limitations

- The `0.6%`, weight, `55`, and `-15` parameters are transparent heuristics,
  not statistically calibrated thresholds.
- Half-hour closes can miss faster intrainterval lows and recoveries.
- Multiple shocks from one session are dependent observations.
- Requiring a two-hour checkpoint selects against late-session shocks.
- Eight events is enough to compute the diagnostic, not enough to establish a
  stable predictive relationship.
- `xyz:SP500` is a venue-specific perpetual proxy, not official cash SPX.

These limitations are why resilience decay remains presentation-only.
