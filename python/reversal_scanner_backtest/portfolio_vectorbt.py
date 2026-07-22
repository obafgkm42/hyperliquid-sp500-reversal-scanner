"""Portfolio-level replay helpers backed by vectorbt."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import pandas as pd
import vectorbt as vbt

from reversal_scanner_backtest.models import Candle
from reversal_scanner_backtest.reversal_study import ReversalEvent, parse_iso_millis


@dataclass(frozen=True)
class VectorbtPortfolioSummary:
    """Small stable summary extracted from a vectorbt Portfolio."""

    total_return: float
    max_drawdown: float
    total_trades: int
    win_rate: float | None


def build_close_series(candles: list[Candle]) -> pd.Series:
    """Convert repo candles into a UTC-indexed close series for vectorbt."""

    index = [datetime.fromtimestamp(candle.end_time / 1000, tz=UTC) for candle in candles]
    return pd.Series([candle.close for candle in candles], index=pd.DatetimeIndex(index, name="timestamp"), name="close")


def build_fixed_horizon_signals(
    close: pd.Series,
    events: list[ReversalEvent],
    holding_bars: int,
) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    """
    Build long/short entry and exit masks from canonical event rows.

    The event-study engine owns signal detection and path-specific diagnostics.
    This adapter only maps those events into a portfolio replay surface.
    """

    if holding_bars < 1:
        raise ValueError("holding_bars must be at least 1")

    entries = pd.Series(False, index=close.index)
    exits = pd.Series(False, index=close.index)
    short_entries = pd.Series(False, index=close.index)
    short_exits = pd.Series(False, index=close.index)
    index_by_timestamp = {int(timestamp.timestamp() * 1000): position for position, timestamp in enumerate(close.index)}

    for event in events:
        entry_position = index_by_timestamp.get(parse_iso_millis(event.timestamp))
        if entry_position is None:
            continue
        exit_position = min(entry_position + holding_bars, len(close.index) - 1)
        if event.direction == "bullish":
            entries.iloc[entry_position] = True
            exits.iloc[exit_position] = True
        else:
            short_entries.iloc[entry_position] = True
            short_exits.iloc[exit_position] = True

    return entries, exits, short_entries, short_exits


def build_fixed_horizon_portfolio(
    candles: list[Candle],
    events: list[ReversalEvent],
    holding_bars: int = 5,
    init_cash: float = 100_000,
) -> vbt.Portfolio:
    """Replay canonical events with vectorbt using fixed-bar exits."""

    close = build_close_series(candles)
    entries, exits, short_entries, short_exits = build_fixed_horizon_signals(close, events, holding_bars)
    return vbt.Portfolio.from_signals(
        close,
        entries=entries,
        exits=exits,
        short_entries=short_entries,
        short_exits=short_exits,
        init_cash=init_cash,
        freq="5min",
    )


def summarize_portfolio(portfolio: vbt.Portfolio) -> VectorbtPortfolioSummary:
    """Extract a compact metric set from a vectorbt Portfolio."""

    total_trades = int(portfolio.trades.count())
    win_rate = None if total_trades == 0 else float(portfolio.trades.win_rate())
    return VectorbtPortfolioSummary(
        total_return=float(portfolio.total_return()),
        max_drawdown=float(portfolio.max_drawdown()),
        total_trades=total_trades,
        win_rate=win_rate,
    )
