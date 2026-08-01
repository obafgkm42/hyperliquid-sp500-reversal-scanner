"""Regression tests for production-style replay and candle validation."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import tomllib
from zoneinfo import ZoneInfo

from reversal_scanner_backtest.cli import reinterpret_naive_local_candle
from reversal_scanner_backtest.models import (
    Candle,
    ReversalLocation,
    SignalPolicy,
)
from reversal_scanner_backtest.replay import (
    ReplaySettings,
    available_history,
    build_delivery_decision,
    is_request_boundary,
    notification_delivery_time,
    should_evaluate_candle,
)
from reversal_scanner_backtest.validation import validate_candles
from reversal_scanner_backtest import signal_engine


def test_live_replay_catches_up_every_completed_candle() -> None:
    settings = ReplaySettings(mode="live")

    assert should_evaluate_candle(candle_ending_before("2025-01-06T14:45:00-05:00"), settings) is True
    assert should_evaluate_candle(candle_ending_before("2025-01-06T14:50:00-05:00"), settings) is True
    assert should_evaluate_candle(candle_ending_before("2025-01-06T15:05:00-05:00"), settings) is True
    assert should_evaluate_candle(candle_ending_before("2025-01-06T15:10:00-05:00"), settings) is True


def test_live_requests_keep_regular_and_final_hour_cadence() -> None:
    settings = ReplaySettings(mode="live")

    assert is_request_boundary(candle_ending_before("2025-01-06T14:45:00-05:00"), settings) is True
    assert is_request_boundary(candle_ending_before("2025-01-06T14:50:00-05:00"), settings) is False
    assert is_request_boundary(candle_ending_before("2025-01-06T15:05:00-05:00"), settings) is True
    assert is_request_boundary(candle_ending_before("2025-01-06T15:10:00-05:00"), settings) is True


def test_live_replay_clips_history_to_request_lookback() -> None:
    settings = ReplaySettings(mode="live", request_lookback_hours=18)
    trigger = candle_ending_before("2025-01-06T23:00:00-05:00")
    too_old = candle_ending_before("2025-01-06T04:55:00-05:00")
    retained = candle_ending_before("2025-01-06T05:05:00-05:00")

    assert available_history([too_old, retained, trigger], trigger, settings) == [retained, trigger]


def test_live_delivery_waits_for_next_real_request_boundary() -> None:
    settings = ReplaySettings(mode="live")
    candle = candle_ending_before("2025-01-06T11:35:00-05:00")

    delivered_at = notification_delivery_time(candle, settings)

    assert datetime.fromtimestamp(
        delivered_at / 1000,
        tz=ZoneInfo("America/New_York"),
    ).isoformat() == "2025-01-06T11:45:00-05:00"


def test_delivery_revalidation_expires_a_stopped_signal() -> None:
    settings = ReplaySettings(mode="live")
    signal_candle = candle_ending_before(
        "2025-01-06T11:35:00-05:00"
    )
    stopped = Candle(
        start_time=signal_candle.end_time + 1,
        end_time=signal_candle.end_time + 300_000,
        open=100,
        high=101,
        low=94,
        close=100,
        volume=100,
        trade_count=10,
    )
    delivery_bar = Candle(
        start_time=stopped.end_time + 1 + 300_000,
        end_time=stopped.end_time + 600_000,
        open=100,
        high=101,
        low=99,
        close=100,
        volume=100,
        trade_count=10,
    )
    signal = reversal_signal(signal_candle)

    decision = build_delivery_decision(
        [signal_candle, stopped, delivery_bar],
        0,
        signal,
        settings,
    )

    assert decision.status == "invalidated_before_delivery"
    assert decision.observed_at == delivery_bar.start_time


def test_validation_reports_zero_volume_and_rejects_bad_ohlc() -> None:
    valid = candle_ending_before("2025-01-06T09:35:00-05:00", volume=0)
    invalid = Candle(
        start_time=valid.start_time + 300_000,
        end_time=valid.end_time + 300_000,
        open=105,
        high=104,
        low=100,
        close=101,
        volume=0,
        trade_count=0,
    )

    report = validate_candles([valid, invalid], 5, "America/New_York")

    assert report.is_valid is False
    assert report.invalid_ohlc_rows == 1
    assert report.zero_volume_rate == 1
    assert any("VWAP will fall back" in warning for warning in report.warnings)


def test_naive_chicago_timestamp_is_converted_with_dst() -> None:
    winter = reinterpret_naive_local_candle(
        candle_ending_before("2008-01-02T08:35:00+00:00"),
        ZoneInfo("America/Chicago"),
    )
    summer = reinterpret_naive_local_candle(
        candle_ending_before("2020-06-15T08:35:00+00:00"),
        ZoneInfo("America/Chicago"),
    )

    assert datetime.fromtimestamp(
        winter.start_time / 1000,
        tz=ZoneInfo("America/New_York"),
    ).strftime("%H:%M") == "09:30"
    assert datetime.fromtimestamp(
        summer.start_time / 1000,
        tz=ZoneInfo("America/New_York"),
    ).strftime("%H:%M") == "09:30"


def test_rth_validation_rejects_misaligned_session_open() -> None:
    candle = candle_ending_before("2025-01-06T04:35:00-05:00")

    report = validate_candles(
        [candle],
        5,
        "America/New_York",
        "rth",
    )

    assert report.is_valid is False
    assert report.session_open_mismatch_dates == 1


def test_frozen_python_parameters_match_typescript_and_runtime_defaults() -> None:
    project_root = Path(__file__).resolve().parents[1]
    type_script = (project_root / "src/signal-engine.ts").read_text(encoding="utf-8")
    shared_constants = {
        "MINIMUM_SESSION_CANDLES": signal_engine.MINIMUM_SESSION_CANDLES,
        "ATR_WINDOW": signal_engine.ATR_WINDOW,
        "RANGE_EXTREME_FRACTION": signal_engine.RANGE_EXTREME_FRACTION,
        "MINIMUM_WICK_RATIO": signal_engine.MINIMUM_WICK_RATIO,
        "MINIMUM_BODY_RATIO": signal_engine.MINIMUM_BODY_RATIO,
        "MINIMUM_CLOSE_REJECTION": signal_engine.MINIMUM_CLOSE_REJECTION,
        "VOLUME_SPIKE_MULTIPLIER": signal_engine.VOLUME_SPIKE_MULTIPLIER,
        "BULLISH_MINIMUM_DISTANCE_FROM_VWAP_ATR": signal_engine.BULLISH_MINIMUM_DISTANCE_FROM_VWAP_ATR,
        "BEARISH_MINIMUM_DISTANCE_FROM_VWAP_ATR": signal_engine.BEARISH_MINIMUM_DISTANCE_FROM_VWAP_ATR,
        "MINIMUM_SESSION_RANGE_ATR": signal_engine.MINIMUM_SESSION_RANGE_ATR,
        "MAXIMUM_POLICY_RISK_ATR": signal_engine.MAXIMUM_POLICY_RISK_ATR,
    }
    for name, python_value in shared_constants.items():
        match = re.search(rf"const {name} = ([0-9.]+);", type_script)
        assert match is not None
        assert float(match.group(1)) == python_value

    runtime = tomllib.loads((project_root / "wrangler.toml").read_text(encoding="utf-8"))["vars"]
    thresholds = signal_engine.FROZEN_SIGNAL_V1_THRESHOLDS
    assert float(runtime["MINIMUM_WATCH_PRICE_R"]) == thresholds.minimum_watch_price_r
    assert float(runtime["MINIMUM_WATCH_CONFIDENCE_SCORE"]) == thresholds.minimum_watch_confidence_score
    assert float(runtime["MINIMUM_PRICE_R"]) == thresholds.minimum_price_r
    assert float(runtime["MINIMUM_CONFIDENCE_SCORE"]) == thresholds.minimum_confidence_score


def candle_ending_before(value: str, volume: float = 100) -> Candle:
    """Build a five-minute candle ending one millisecond before a boundary."""

    boundary = datetime.fromisoformat(value).astimezone(ZoneInfo("UTC"))
    end_time = int(boundary.timestamp() * 1000) - 1
    return Candle(
        start_time=end_time - 299_999,
        end_time=end_time,
        open=100,
        high=101,
        low=99,
        close=100,
        volume=volume,
        trade_count=10,
    )


def reversal_signal(candle: Candle) -> ReversalLocation:
    """Build a simple delivery-revalidation signal."""

    return ReversalLocation(
        level="alert",
        direction="bullish",
        market="SPX",
        price=100,
        entry_low=99,
        entry_high=101,
        invalidation=95,
        target=110,
        session_high=110,
        session_low=95,
        vwap=105,
        price_risk_reward=2,
        confidence_score=80,
        policy=SignalPolicy(
            name="test",
            role="bullish_reversal_zone",
            alert_eligible=True,
            watch_eligible=True,
            reasons=[],
        ),
        reasons=[],
        timestamp=candle.end_time,
    )
