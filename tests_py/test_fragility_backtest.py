"""Regression tests for the frozen fragility event-study contract."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import re
import json
from zoneinfo import ZoneInfo

from reversal_scanner_backtest.fragility_cli import (
    apply_proxy_volume,
    build_streaming_replay,
    load_candles_streaming,
)
from reversal_scanner_backtest.fragility_study import (
    FragilityReplaySettings,
    analyze_price_fragility,
    build_fragility_observations,
    frozen_fragility_thresholds,
    summarize_fragility_observations,
)
from reversal_scanner_backtest.models import Candle


def test_price_only_fragility_classifies_resilient_and_partial() -> None:
    result = analyze_price_fragility(
        candles_from_closes(
            [100, 100.1, 100.2, 100.15, 100.3, 100.4, 100.5]
        )
    )

    assert result.level == "resilient"
    assert result.score == 0
    assert result.available_indicator_count == 4
    assert result.data_quality == "partial"
    assert [
        item.indicator_id
        for item in result.indicators
        if item.state == "unavailable"
    ] == ["mega_cap_breadth", "equity_cross_confirmation"]


def test_price_only_fragility_can_reach_partial_panic() -> None:
    result = analyze_price_fragility(
        candles_from_closes(
            [
                100,
                99.95,
                99.9,
                99.45,
                99.4,
                99.35,
                98.9,
                98.85,
                98.8,
            ]
        )
    )

    assert result.level == "panic"
    assert result.score == 80
    assert result.stressed_indicator_count == 4


def test_scheduled_replay_uses_future_only_for_outcomes() -> None:
    settings = FragilityReplaySettings(bootstrap_runs=0)
    stable_future = session_candles(
        [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
    )
    weak_future = session_candles(
        [100, 100, 100, 100, 100, 100, 99.8, 99.4, 99, 99, 99, 99]
    )

    stable = build_fragility_observations(stable_future, settings)
    weak = build_fragility_observations(weak_future, settings)

    assert len(stable) == 2
    assert len(weak) == 2
    assert stable[0].session_time == "10:00"
    assert stable[0].snapshot == weak[0].snapshot
    assert stable[0].outcomes["30m"].drawdown_event is False
    assert weak[0].outcomes["30m"].drawdown_event is True


def test_replay_requires_a_complete_forward_horizon() -> None:
    observations = build_fragility_observations(
        session_candles([100] * 10),
        FragilityReplaySettings(bootstrap_runs=0),
    )

    assert len(observations) == 1
    assert observations[0].outcomes["30m"].drawdown_event is None
    assert observations[0].outcomes["eod"].drawdown_event is False


def test_summary_and_bootstrap_are_deterministic() -> None:
    settings = FragilityReplaySettings(
        bootstrap_runs=20,
        bootstrap_seed=7,
        bootstrap_block_sessions=2,
    )
    first = session_candles([100] * 12, "2025-01-06")
    second = session_candles(
        [100, 100, 100, 100, 100, 100, 99.8, 99.4, 99, 99, 99, 99],
        "2025-01-07",
    )
    observations = build_fragility_observations(first + second, settings)

    first_summary = summarize_fragility_observations(observations, settings)
    second_summary = summarize_fragility_observations(observations, settings)

    assert first_summary == second_summary
    assert first_summary["observationCount"] == 4
    assert first_summary["movingBlockBootstrap"]["runs"] == 20


def test_aligned_proxy_volume_preserves_primary_prices() -> None:
    primary = session_candles([100, 101])
    proxy = [
        Candle(
            start_time=item.start_time,
            end_time=item.end_time,
            open=10,
            high=11,
            low=9,
            close=10,
            volume=1_000 + index,
            trade_count=10,
        )
        for index, item in enumerate(primary)
    ]

    merged, coverage = apply_proxy_volume(primary, proxy)

    assert coverage == 1
    assert [item.close for item in merged] == [100, 101]
    assert [item.volume for item in merged] == [1000, 1001]


def test_streaming_loader_matches_repo_candle_shape(tmp_path: Path) -> None:
    source = tmp_path / "candles.json"
    expected = session_candles([100, 101])
    source.write_text(
        json.dumps([item.to_dict() for item in expected]),
        encoding="utf-8",
    )

    loaded = load_candles_streaming(source)

    assert loaded == expected


def test_streaming_replay_matches_in_memory_replay(tmp_path: Path) -> None:
    source = tmp_path / "candles.json"
    settings = FragilityReplaySettings(bootstrap_runs=0)
    candles = session_candles([100] * 12, "2025-01-06") + session_candles(
        [100, 100, 100, 100, 100, 100, 99.8, 99.4, 99, 99, 99, 99],
        "2025-01-07",
    )
    source.write_text(
        json.dumps([item.to_dict() for item in candles]),
        encoding="utf-8",
    )

    replay = build_streaming_replay(
        source,
        source_time_zone="UTC",
        source_timestamp_mode="utc-epoch",
        settings=settings,
    )

    assert replay.validation.is_valid
    assert replay.candle_count == len(candles)
    assert replay.first_timestamp == candles[0].start_time
    assert replay.last_timestamp == candles[-1].end_time
    assert replay.observations == build_fragility_observations(
        candles,
        settings,
    )


def test_frozen_fragility_parameters_match_typescript() -> None:
    project_root = Path(__file__).resolve().parents[1]
    type_script = (project_root / "src/market-fragility.ts").read_text(
        encoding="utf-8"
    )
    thresholds = frozen_fragility_thresholds()
    shared = {
        "MINIMUM_PRICE_CANDLES": thresholds["minimumPriceCandles"],
        "FRAGILITY_ATR_WINDOW": thresholds["atrWindow"],
        "SESSION_LOSS_THRESHOLD": thresholds["sessionLossThreshold"],
        "VWAP_GAP_ATR_THRESHOLD": thresholds["vwapGapAtrThreshold"],
        "VWAP_CONFIRMATION_CANDLES": thresholds[
            "vwapConfirmationCandles"
        ],
        "POOR_CLOSE_LOCATION_THRESHOLD": thresholds[
            "poorCloseLocationThreshold"
        ],
        "TAIL_LOOKBACK_RETURNS": thresholds["tailLookbackReturns"],
        "LARGE_DOWN_RETURN_FLOOR": thresholds["largeDownReturnFloor"],
        "LARGE_DOWN_RETURN_MEDIAN_MULTIPLIER": thresholds[
            "largeDownReturnMedianMultiplier"
        ],
        "LARGE_DOWN_RETURN_COUNT": thresholds["largeDownReturnCount"],
        "BREADTH_MINIMUM_ASSETS": thresholds["breadthMinimumAssets"],
        "BREADTH_DECLINE_THRESHOLD": thresholds[
            "breadthDeclineThreshold"
        ],
        "BREADTH_STRESS_RATIO": thresholds["breadthStressRatio"],
        "CROSS_ASSET_LOSS_THRESHOLD": thresholds[
            "crossAssetLossThreshold"
        ],
        "TOTAL_INDICATOR_COUNT": thresholds["totalIndicatorCount"],
        "MINIMUM_AVAILABLE_INDICATORS": thresholds[
            "minimumAvailableIndicators"
        ],
    }
    for name, python_value in shared.items():
        match = re.search(rf"const {name} = (-?[0-9.]+);", type_script)
        assert match is not None
        assert float(match.group(1)) == float(python_value)


def candles_from_closes(closes: list[float]) -> list[Candle]:
    """Build deterministic candles matching the TypeScript fixtures."""

    start = datetime.fromisoformat("2026-07-31T09:30:00-04:00")
    result: list[Candle] = []
    for index, close in enumerate(closes):
        open_price = close if index == 0 else closes[index - 1]
        start_time = int((start + timedelta(minutes=5 * index)).timestamp() * 1000)
        result.append(
            Candle(
                start_time=start_time,
                end_time=start_time + 299_999,
                open=open_price,
                high=max(open_price, close) + 0.05,
                low=min(open_price, close) - 0.05,
                close=close,
                volume=100,
                trade_count=10,
            )
        )
    return result


def session_candles(
    closes: list[float],
    session_date: str = "2025-01-06",
) -> list[Candle]:
    """Build one New York RTH session from 09:30 onward."""

    start = datetime.fromisoformat(f"{session_date}T09:30:00").replace(
        tzinfo=ZoneInfo("America/New_York")
    )
    result: list[Candle] = []
    for index, close in enumerate(closes):
        open_price = close if index == 0 else closes[index - 1]
        start_time = int((start + timedelta(minutes=index * 5)).timestamp() * 1000)
        result.append(
            Candle(
                start_time=start_time,
                end_time=start_time + 299_999,
                open=open_price,
                high=max(open_price, close) + 0.05,
                low=min(open_price, close) - 0.05,
                close=close,
                volume=100,
                trade_count=10,
            )
        )
    return result
