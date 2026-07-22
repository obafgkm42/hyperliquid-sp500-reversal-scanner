"""Regression tests for production-style replay and candle validation."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import tomllib
from zoneinfo import ZoneInfo

from reversal_scanner_backtest.models import Candle
from reversal_scanner_backtest.replay import (
    ReplaySettings,
    available_history,
    should_evaluate_candle,
)
from reversal_scanner_backtest.validation import validate_candles
from reversal_scanner_backtest import signal_engine


def test_live_replay_uses_regular_and_final_hour_cadence() -> None:
    settings = ReplaySettings(mode="live")

    assert should_evaluate_candle(candle_ending_before("2025-01-06T14:45:00-05:00"), settings) is True
    assert should_evaluate_candle(candle_ending_before("2025-01-06T14:50:00-05:00"), settings) is False
    assert should_evaluate_candle(candle_ending_before("2025-01-06T15:05:00-05:00"), settings) is True
    assert should_evaluate_candle(candle_ending_before("2025-01-06T15:10:00-05:00"), settings) is True


def test_live_replay_clips_history_to_request_lookback() -> None:
    settings = ReplaySettings(mode="live", request_lookback_hours=18)
    trigger = candle_ending_before("2025-01-06T23:00:00-05:00")
    too_old = candle_ending_before("2025-01-06T04:55:00-05:00")
    retained = candle_ending_before("2025-01-06T05:05:00-05:00")

    assert available_history([too_old, retained, trigger], trigger, settings) == [retained, trigger]


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
