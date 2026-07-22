"""Command-line runner for Python scientific backtests."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from reversal_scanner_backtest.models import Candle
from reversal_scanner_backtest.reversal_study import (
    ExecutionAssumptions,
    ReversalEvent,
    build_candle_session_index,
    build_cluster_bootstrap_summary,
    build_placebo_comparison,
    build_reversal_event,
    date_key,
    event_to_dict,
    render_reversal_summary_markdown,
    render_direction_summary_markdown,
    reversal_events_to_csv,
    set_backtest_session_time_zone,
    summary_to_dict,
    summarize_reversal_events,
    summarize_events_by_direction,
)
from reversal_scanner_backtest.signal_engine import analyze_frozen_signal_v1
from reversal_scanner_backtest.replay import (
    ReplaySettings,
    available_history,
    should_evaluate_candle,
)
from reversal_scanner_backtest.validation import (
    dataset_sha256,
    validate_candles,
)
from reversal_scanner_backtest.walk_forward import (
    build_walk_forward_summary,
    render_walk_forward_markdown,
)

BACKTEST_SCHEMA_VERSION = 2


def main() -> None:
    """Run the frozen-v1 reversal event study from candle JSON."""

    args = parse_args()
    set_backtest_session_time_zone(args.session_timezone)
    candles = load_candles(args.input)
    validation = validate_candles(
        candles,
        args.expected_interval_minutes,
        args.session_timezone,
    )
    if not validation.is_valid:
        raise ValueError("; ".join(validation.errors))
    replay_settings = ReplaySettings(
        mode=args.replay_mode,
        regular_scan_minutes=args.regular_scan_minutes,
        final_hour_scan_minutes=args.final_hour_scan_minutes,
        request_lookback_hours=args.request_lookback_hours,
        session_time_zone=args.session_timezone,
    )
    replay_settings.validate()
    execution_assumptions = ExecutionAssumptions(
        entry_mode=args.entry_mode,
        slippage_points=args.slippage_points,
        round_trip_cost_points=args.round_trip_cost_points,
    )
    execution_assumptions.validate()
    events = scan_reversal_events(
        candles,
        args.market,
        replay_settings,
        execution_assumptions,
        args.signal_scope,
    )
    summary = summarize_reversal_events(events)
    direction_summaries = summarize_events_by_direction(events)
    bootstrap = build_cluster_bootstrap_summary(
        events,
        args.bootstrap_runs,
        args.bootstrap_seed,
    )
    placebo = build_placebo_comparison(
        candles,
        events,
        args.placebo_runs,
        execution_assumptions,
    )
    walk_forward = build_walk_forward_summary(
        events,
        args.walk_forward_train_months,
        args.walk_forward_test_months,
    )

    output_dir = args.output_dir or args.output.parent
    events_dir = output_dir / "events"
    reports_dir = output_dir / "reports"
    events_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    event_dicts = [event_to_dict(event) for event in events]
    payload = {
        "schemaVersion": BACKTEST_SCHEMA_VERSION,
        "market": args.market,
        "input": str(args.input),
        "datasetSha256": dataset_sha256(args.input),
        "sourceTimeZone": args.source_timezone,
        "dataValidation": validation.to_dict(),
        "sessionTimeZone": args.session_timezone,
        "replay": {
            "mode": replay_settings.mode,
            "regularScanMinutes": replay_settings.regular_scan_minutes,
            "finalHourScanMinutes": replay_settings.final_hour_scan_minutes,
            "requestLookbackHours": replay_settings.request_lookback_hours,
            "signalScope": args.signal_scope,
        },
        "execution": {
            "entryMode": execution_assumptions.entry_mode,
            "slippagePointsPerFill": execution_assumptions.slippage_points,
            "roundTripCostPoints": execution_assumptions.round_trip_cost_points,
            "gapStopsUseWorseOpeningPrice": True,
        },
        "candleCount": len(candles),
        "range": None
        if not candles
        else {
            "start": candles[0].end_time,
            "end": candles[-1].end_time,
        },
        "summary": summary_to_dict(summary),
        "summaryByDirection": {
            direction: summary_to_dict(direction_summary)
            for direction, direction_summary in direction_summaries.items()
        },
        "clusterBootstrap": None if bootstrap is None else asdict(bootstrap),
        "placebo": placebo,
        "walkForward": (
            None if walk_forward is None else walk_forward.to_dict()
        ),
        "events": event_dicts,
    }

    (events_dir / "reversal_event_study.csv").write_text(f"{reversal_events_to_csv(events)}\n", encoding="utf-8")
    (events_dir / "reversal_event_study.json").write_text(f"{json.dumps(event_dicts, indent=2)}\n", encoding="utf-8")
    (reports_dir / "reversal_summary.md").write_text(
        render_reversal_summary_markdown(summary, placebo, bootstrap),
        encoding="utf-8",
    )
    (reports_dir / "walk_forward_summary.md").write_text(
        render_walk_forward_markdown(walk_forward),
        encoding="utf-8",
    )
    (reports_dir / "direction_summary.md").write_text(
        render_direction_summary_markdown(direction_summaries),
        encoding="utf-8",
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")

    print(f"Backtest {args.market} candles={len(candles)} signals={summary.signal_count}")
    for warning in validation.warnings:
        print(f"Data warning: {warning}")
    if args.source_timezone == "unspecified":
        print("Data warning: source timezone was not declared")
    print(
        " ".join(
            [
                f"mfe20={format_rate(summary.mfe20_rate)}",
                f"eod20={format_rate(summary.eod20_rate)}",
                f"swept={format_rate(summary.swept_invalidation_rate)}",
            ]
        )
    )
    print(f"Events CSV: {events_dir / 'reversal_event_study.csv'}")
    print(f"Summary: {reports_dir / 'reversal_summary.md'}")
    print(f"Walk-forward: {reports_dir / 'walk_forward_summary.md'}")
    print(f"Full JSON: {args.output}")


def scan_reversal_events(
    candles: list[Candle],
    market: str,
    replay_settings: ReplaySettings | None = None,
    execution_assumptions: ExecutionAssumptions | None = None,
    signal_scope: str = "alert",
) -> list[ReversalEvent]:
    """
    Replay the frozen signal one completed candle at a time.

    Only candles completed at or before the signal are passed into signal
    detection; forward candles are used only after a trigger has been selected.
    """

    settings = replay_settings or ReplaySettings(mode="every-bar")
    settings.validate()
    execution = execution_assumptions or ExecutionAssumptions()
    execution.validate()
    if signal_scope not in {"alert", "watch-and-alert"}:
        raise ValueError("signal_scope must be alert or watch-and-alert")
    sessions: dict[str, list[Candle]] = {}
    session_index = build_candle_session_index(candles)
    events = []
    for index, candle in enumerate(candles):
        session_key = date_key(candle.end_time)
        session = sessions.setdefault(session_key, [])
        session.append(candle)
        if not should_evaluate_candle(candle, settings):
            continue
        trigger_history = available_history(session, candle, settings)
        result = analyze_frozen_signal_v1(trigger_history, market)
        signal = (
            result.signal
            if signal_scope == "alert"
            else result.signal or result.watch
        )
        if signal is None or signal.timestamp != candle.end_time:
            continue
        indexed_session = session_index.get(candle.end_time)
        future_candles = candles[index + 1 :] if indexed_session is None else indexed_session[0][indexed_session[1] + 1 :]
        events.append(
            build_reversal_event(
                signal,
                candle,
                trigger_history,
                future_candles,
                execution,
            )
        )
    return events


def load_candles(path: Path) -> list[Candle]:
    """Load existing repo candle JSON into typed Python candles."""

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("input must be a JSON array of candle objects")
    return [Candle.from_dict(row) for row in raw]


def parse_args() -> argparse.Namespace:
    """Parse command-line options."""

    parser = argparse.ArgumentParser(description="Run Python frozen-v1 reversal event study.")
    parser.add_argument("--input", required=True, type=Path, help="Path to candle JSON in the repo candle shape.")
    parser.add_argument("--output", type=Path, default=Path("backtest/reversal_backtest.json"), help="Full JSON output path.")
    parser.add_argument("--output-dir", type=Path, default=None, help="Directory for reports and event tables.")
    parser.add_argument("--market", default="SPX", help="Market label for the study.")
    parser.add_argument("--placebo-runs", type=int, default=1000, help="Matched random placebo runs.")
    parser.add_argument(
        "--bootstrap-runs",
        type=int,
        default=2000,
        help="Session-cluster bootstrap runs for 95% confidence intervals.",
    )
    parser.add_argument(
        "--bootstrap-seed",
        type=int,
        default=42,
        help="Deterministic seed for session-cluster bootstrap.",
    )
    parser.add_argument(
        "--walk-forward-train-months",
        type=int,
        default=12,
        help="Calendar months in each rolling context window.",
    )
    parser.add_argument(
        "--walk-forward-test-months",
        type=int,
        default=6,
        help="Non-overlapping calendar months in each test window.",
    )
    parser.add_argument(
        "--replay-mode",
        choices=("live", "every-bar"),
        default="live",
        help="Use production cadence/lookback or evaluate every completed candle.",
    )
    parser.add_argument(
        "--regular-scan-minutes",
        type=int,
        default=15,
        help="Production scan interval outside the New York final hour.",
    )
    parser.add_argument(
        "--final-hour-scan-minutes",
        type=int,
        default=5,
        help="Production scan interval from 15:00 to 16:00 New York time.",
    )
    parser.add_argument(
        "--request-lookback-hours",
        type=int,
        default=18,
        help="Historical fetch window mirrored from the live candle request.",
    )
    parser.add_argument(
        "--expected-interval-minutes",
        type=int,
        default=5,
        help="Expected candle duration used by data validation.",
    )
    parser.add_argument(
        "--entry-mode",
        choices=("next-open", "signal-close"),
        default="next-open",
        help="Executable entry model; signal-close remains available for legacy comparison.",
    )
    parser.add_argument(
        "--signal-scope",
        choices=("alert", "watch-and-alert"),
        default="alert",
        help="Evaluate strict alerts only or every live notification opportunity.",
    )
    parser.add_argument(
        "--slippage-points",
        type=float,
        default=0,
        help="Adverse slippage applied to both entry and exit fills.",
    )
    parser.add_argument(
        "--round-trip-cost-points",
        type=float,
        default=0,
        help="Additional round-trip cost deducted from each completed trade.",
    )
    parser.add_argument("--session-timezone", default="America/New_York", help="Session timezone for grouping.")
    parser.add_argument(
        "--source-timezone",
        default="unspecified",
        help="Provenance label for the timezone used to encode source timestamps.",
    )
    return parser.parse_args()


def format_rate(value: float | None) -> str:
    """Format a nullable rate for console output."""

    return "n/a" if value is None else f"{value * 100:.2f}%"


if __name__ == "__main__":
    main()
