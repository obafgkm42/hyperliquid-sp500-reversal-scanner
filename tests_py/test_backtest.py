from __future__ import annotations

from dataclasses import replace

import pytest

from reversal_scanner_backtest.models import Candle, ReversalLocation, SignalPolicy
from reversal_scanner_backtest.reversal_study import (
    ExecutionAssumptions,
    PlaceboCandidate,
    build_cluster_bootstrap_summary,
    build_placebo_sample,
    build_reversal_event,
    compare_metric,
    summarize_placebo_samples,
    summarize_reversal_events,
    time_of_day_bucket,
    volatility_is_similar,
)
from reversal_scanner_backtest.signal_engine import analyze_frozen_signal_v1
from reversal_scanner_backtest.walk_forward import build_walk_forward_summary


def test_frozen_signal_uses_only_completed_candles() -> None:
    candles = [
        candle(0, 125, 130, 91.2, 126, 100),
        candle(1, 126, 129, 92, 125, 100),
        candle(2, 125, 128, 93, 124, 100),
        candle(3, 124, 127, 94, 123, 100),
        candle(4, 123, 126, 95, 122, 100),
        candle(5, 122, 125, 96, 121, 100),
        candle(6, 92.6, 93.1, 91.2, 92.5, 100),
        candle(7, 92.5, 93, 91.2, 92.4, 100),
        candle(8, 92.4, 92.9, 91.2, 92.3, 100),
        candle(9, 92.3, 92.8, 91.2, 92.2, 100),
        candle(10, 92.2, 92.7, 91.2, 92.1, 100),
        candle(11, 92.1, 92.6, 91.2, 92, 100),
        candle(12, 92, 92.5, 91.2, 91.9, 100),
        candle(13, 91.9, 92.4, 91.2, 91.8, 100),
        candle(14, 91.8, 92.3, 91.2, 91.7, 100),
        candle(15, 91.7, 92.2, 91.2, 91.6, 100),
        candle(16, 91.6, 92.1, 91.2, 91.5, 100),
        candle(17, 91.5, 92, 91.2, 91.4, 100),
        candle(18, 91.4, 91.9, 91.2, 91.3, 100),
        candle(19, 91.1, 92, 91, 91.8, 500),
    ]

    result = analyze_frozen_signal_v1(candles, "SPX")

    assert result.signal is not None
    assert result.signal.direction == "bullish"
    assert result.signal.price == 91.8
    assert "fresh lookback low rejected" in result.signal.reasons


def test_reversal_event_measures_sweep_recovery_and_stop_out() -> None:
    signal_candle = candle(10, 100, 102, 98, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 97, 125)
    event = build_reversal_event(
        signal,
        signal_candle,
        [candle(0, 110, 112, 108, 110, 100), signal_candle],
        [
            candle(11, 100, 101, 96, 97, 100),
            candle(12, 97, 103, 96.5, 101, 100),
            candle(13, 101, 121, 100, 120, 100),
        ],
    )

    assert event.eod_directional_points == 20
    assert event.mfe_points == 21
    assert event.mae_points == 4
    assert event.hit20_mfe is True
    assert event.swept_invalidation is True
    assert event.recovered_after_sweep is True
    assert event.hit20_after_sweep is True
    assert event.sweep_depth_points == 1
    assert event.mae_before_mfe20_points == 4
    assert event.stop_out_study is not None
    assert event.stop_out_study.stopped_out is True
    assert event.stop_out_study.first_stop_out_loss_points == -3
    assert event.stop_out_study.swept_then_reversed is True
    assert event.stop_out_study.points_after_stopout == 23
    assert event.stop_out_study.time_from_stopout_to_reversal_minutes == 10
    assert event.stop_out_study.max_adverse_before_post_stop20_points == 3.5


def test_summary_includes_retry_and_delayed_entry_policies() -> None:
    signal_candle = candle(10, 100, 102, 98, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 97, 125)
    event = build_reversal_event(
        signal,
        signal_candle,
        [signal_candle],
        [
            candle(11, 100, 101, 96, 98, 100),
            candle(12, 97, 103, 96.5, 101, 100),
            candle(13, 101, 121, 100, 120, 100),
        ],
    )

    summary = summarize_reversal_events([event])

    assert summary.stop_out_study.swept_then_reversed_rate == 1
    assert summary.stop_out_study.avg_points_after_stopout == 23
    assert summary.stop_out_study.median_minutes_from_stopout_to_reversal == 10
    assert summary.stop_out_study.reentry_after_stopout.trades == 1
    assert summary.stop_out_study.one_retry_policy.trades == 1
    assert summary.stop_out_study.two_retry_policy.avg_points is not None
    assert summary.stop_out_study.two_retry_policy.avg_points > 0
    assert summary.stop_out_study.delayed_entry5m.trades == 1
    assert summary.stop_out_study.delayed_entry_after_confirmation.trades == 1


def test_same_candle_stop_and_target_ambiguity_modes() -> None:
    signal_candle = candle(10, 100, 101, 99, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 95, 105)
    event = build_reversal_event(signal, signal_candle, [signal_candle], [candle(11, 100, 106, 94, 101, 100)])

    assert event.current_stop["conservative"].points == -5
    assert event.current_stop["optimistic"].points == 5
    assert event.current_stop["ambiguous_excluded"].ambiguous is True

    summary = summarize_reversal_events([event])
    assert summary.current_stop_performance["ambiguous_excluded"].ambiguous_trades == 1
    assert summary.current_stop_performance["ambiguous_excluded"].trades == 0


def test_next_open_execution_applies_slippage_cost_and_actual_risk() -> None:
    signal_candle = candle(10, 100, 101, 99, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 95, 105)
    event = build_reversal_event(
        signal,
        signal_candle,
        [signal_candle],
        [candle(11, 101, 106, 100, 105, 100)],
        ExecutionAssumptions(
            entry_mode="next-open",
            slippage_points=0.25,
            round_trip_cost_points=0.1,
        ),
    )

    assert event.execution_status == "filled"
    assert event.execution_entry_price == 101.25
    assert event.execution_risk_points == pytest.approx(6.6)
    assert event.current_stop["conservative"].points == pytest.approx(3.4)


def test_gap_through_stop_uses_worse_opening_fill() -> None:
    signal_candle = candle(10, 100, 101, 99, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 95, 110)
    event = build_reversal_event(
        signal,
        signal_candle,
        [signal_candle],
        [candle(11, 93, 94, 90, 92, 100)],
    )

    assert event.current_stop["conservative"].exit_reason == "gap_stop"
    assert event.current_stop["conservative"].points == -7


def test_fixed_stop_r_uses_fixed_stop_risk() -> None:
    signal_candle = candle(10, 100, 101, 99, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 97, 125)
    event = build_reversal_event(
        signal,
        signal_candle,
        [signal_candle],
        [candle(11, 100, 101, 89, 90, 100)],
    )

    assert event.fixed_stops["10pt"]["conservative"].points == -10
    assert event.fixed_stops["10pt"]["conservative"].r == -1


def test_late_session_metrics_stay_inside_new_york_session_date() -> None:
    signal_candle = candle_at("2025-01-04T00:55:00.000Z", 100, 101, 99, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 95, 120)
    event = build_reversal_event(
        signal,
        signal_candle,
        [signal_candle],
        [
            candle_at("2025-01-04T01:00:00.000Z", 100, 110, 99, 108, 100),
            candle_at("2025-01-06T14:35:00.000Z", 108, 140, 107, 139, 100),
        ],
    )

    assert event.date == "2025-01-03"
    assert event.eod_close == 108
    assert event.mfe_points == 10


def test_time_of_day_buckets_use_new_york_cash_session_boundaries() -> None:
    assert time_of_day_bucket(candle_at("2025-01-06T14:20:00.000Z", 1, 1, 1, 1, 1).end_time) == "premarket"
    assert time_of_day_bucket(candle_at("2025-01-06T14:45:00.000Z", 1, 1, 1, 1, 1).end_time) == "first_30_minutes"
    assert time_of_day_bucket(candle_at("2025-01-06T16:00:00.000Z", 1, 1, 1, 1, 1).end_time) == "midday"
    assert time_of_day_bucket(candle_at("2025-01-06T20:45:00.000Z", 1, 1, 1, 1, 1).end_time) == "final_30_minutes"


def test_placebo_sample_matches_full_event_metrics() -> None:
    signal_candle = candle(10, 100, 102, 98, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 97, 125)
    future = [
        candle(11, 100, 101, 96, 97, 100),
        candle(12, 97, 103, 96.5, 101, 100),
        candle(13, 101, 121, 100, 120, 100),
    ]
    event = build_reversal_event(signal, signal_candle, [signal_candle], future)
    event_summary = summarize_reversal_events([event])

    sample_summary = summarize_placebo_samples(
        [build_placebo_sample(signal, future)],
    )

    assert sample_summary == {
        "hit20MfeRate": event_summary.mfe20_rate,
        "hit20EodRate": event_summary.eod20_rate,
        "medianMfePoints": event_summary.mfe_median_points,
        "medianMaePoints": event_summary.mae_median_points,
        "currentStopAvgPoints": event_summary.current_stop_performance[
            "conservative"
        ].avg_points,
        "currentStopProfitFactor": event_summary.current_stop_performance[
            "conservative"
        ].profit_factor,
    }


def test_placebo_volatility_match_rejects_unfair_candidates() -> None:
    signal_candle = candle(10, 100, 102, 98, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 97, 125)
    history = [
        candle(index, 100, 102, 98, 100, 100)
        for index in range(4, 11)
    ]
    event = build_reversal_event(
        signal,
        signal_candle,
        history,
        [candle(11, 100, 104, 99, 103, 100)],
    )
    matched = PlaceboCandidate(
        candle=signal_candle,
        atr_points=event.atr_points,
        session_range_in_atr=event.session_range_in_atr,
        date="2024-01-01",
    )
    too_volatile = PlaceboCandidate(
        candle=signal_candle,
        atr_points=event.atr_points * 2,
        session_range_in_atr=event.session_range_in_atr,
        date="2024-01-01",
    )

    assert volatility_is_similar(matched, event) is True
    assert volatility_is_similar(too_volatile, event) is False


def test_cluster_bootstrap_is_deterministic_by_session() -> None:
    signal_candle = candle(10, 100, 102, 98, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 97, 125)
    event = build_reversal_event(
        signal,
        signal_candle,
        [signal_candle],
        [candle(11, 100, 104, 99, 103, 100)],
    )

    summary = build_cluster_bootstrap_summary([event], runs=25, seed=7)

    assert summary is not None
    assert summary.cluster_count == 1
    assert summary.mfe20_rate.lower_95 == summary.mfe20_rate.estimate
    assert summary.mfe20_rate.upper_95 == summary.mfe20_rate.estimate


def test_lower_mae_uses_inverted_advantage_percentile() -> None:
    comparison = compare_metric(10, [5, 6, 7], higher_is_better=False)

    assert comparison["rawPercentileRank"] == 1
    assert comparison["advantagePercentile"] == 0


def test_walk_forward_uses_past_train_and_non_overlapping_test_months() -> None:
    signal_candle = candle(10, 100, 102, 98, 100, 100)
    signal = signal_from_candle(signal_candle, "bullish", 97, 125)
    base_event = build_reversal_event(
        signal,
        signal_candle,
        [signal_candle],
        [candle(11, 100, 104, 99, 103, 100)],
    )
    dates = [
        f"{year:04d}-{month:02d}-15"
        for year, month in [
            (2024 + month_index // 12, month_index % 12 + 1)
            for month_index in range(18)
        ]
    ]
    events = [replace(base_event, date=value) for value in dates]

    summary = build_walk_forward_summary(events, train_months=12, test_months=6)

    assert summary is not None
    assert summary.fold_count == 1
    assert summary.folds[0].train.events == 12
    assert summary.folds[0].test.events == 6
    assert summary.folds[0].test_start == "2025-01-01"
    assert summary.folds[0].test_end_exclusive == "2025-07-01"


def candle(index: int, open_: float, high: float, low: float, close: float, volume: float) -> Candle:
    return Candle(
        start_time=index * 300_000,
        end_time=index * 300_000 + 299_999,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
        trade_count=10,
    )


def candle_at(value: str, open_: float, high: float, low: float, close: float, volume: float) -> Candle:
    import datetime as dt

    end_time = int(dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    return Candle(
        start_time=end_time - 299_999,
        end_time=end_time,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
        trade_count=10,
    )


def signal_from_candle(candle_: Candle, direction: str, invalidation: float, target: float) -> ReversalLocation:
    return ReversalLocation(
        level="alert",
        direction=direction,
        market="SPX",
        price=candle_.close,
        entry_low=candle_.close - 0.5,
        entry_high=candle_.close + 0.5,
        invalidation=invalidation,
        target=target,
        session_high=120,
        session_low=90,
        vwap=105,
        price_risk_reward=4,
        confidence_score=80,
        policy=SignalPolicy(
            name="test",
            role="bullish_reversal_zone",
            alert_eligible=True,
            watch_eligible=True,
            reasons=[],
        ),
        reasons=[],
        timestamp=candle_.end_time,
    )
