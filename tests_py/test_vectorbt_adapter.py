"""Optional regression coverage for the source-available vectorbt adapter."""

from __future__ import annotations

import pytest

pytest.importorskip("vectorbt")

from reversal_scanner_backtest.models import Candle, ReversalLocation, SignalPolicy
from reversal_scanner_backtest.portfolio_vectorbt import (
    build_fixed_horizon_portfolio,
    summarize_portfolio,
)
from reversal_scanner_backtest.reversal_study import build_reversal_event


def test_vectorbt_replays_canonical_events_as_portfolio_layer() -> None:
    """Map one canonical event into a profitable fixed-horizon portfolio."""

    signal_candle = candle(10, 100, 102, 98, 100, 100)
    signal = ReversalLocation(
        level="alert",
        direction="bullish",
        market="SPX",
        price=signal_candle.close,
        entry_low=99.5,
        entry_high=100.5,
        invalidation=97,
        target=125,
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
        timestamp=signal_candle.end_time,
    )
    future = [
        candle(11, 100, 101, 99, 101, 100),
        candle(12, 101, 104, 100, 104, 100),
        candle(13, 104, 106, 103, 105, 100),
    ]
    event = build_reversal_event(signal, signal_candle, [signal_candle], future)
    portfolio = build_fixed_horizon_portfolio(
        [signal_candle, *future],
        [event],
        holding_bars=2,
    )
    summary = summarize_portfolio(portfolio)

    assert summary.total_trades == 1
    assert summary.total_return > 0
    assert summary.win_rate == 1


def candle(
    index: int,
    open_price: float,
    high: float,
    low: float,
    close: float,
    volume: float,
) -> Candle:
    """Build one deterministic five-minute candle."""

    return Candle(
        start_time=index * 300_000,
        end_time=index * 300_000 + 299_999,
        open=open_price,
        high=high,
        low=low,
        close=close,
        volume=volume,
        trade_count=10,
    )
