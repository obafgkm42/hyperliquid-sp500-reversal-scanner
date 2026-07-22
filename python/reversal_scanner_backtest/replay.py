"""Replay settings that mirror the production scanner cadence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from reversal_scanner_backtest.models import Candle

ReplayMode = Literal["live", "every-bar"]


@dataclass(frozen=True)
class ReplaySettings:
    """Configuration for selecting historical scanner invocations."""

    mode: ReplayMode = "live"
    regular_scan_minutes: int = 15
    final_hour_scan_minutes: int = 5
    request_lookback_hours: int = 18
    session_time_zone: str = "America/New_York"

    def validate(self) -> None:
        """Raise when a replay setting cannot represent the live scanner."""

        if self.regular_scan_minutes <= 0:
            raise ValueError("regular_scan_minutes must be positive")
        if self.final_hour_scan_minutes <= 0:
            raise ValueError("final_hour_scan_minutes must be positive")
        if self.request_lookback_hours <= 0:
            raise ValueError("request_lookback_hours must be positive")
        ZoneInfo(self.session_time_zone)


def should_evaluate_candle(candle: Candle, settings: ReplaySettings) -> bool:
    """Return whether production cadence would evaluate after this candle."""

    if settings.mode == "every-bar":
        return True

    boundary = datetime.fromtimestamp(
        (candle.end_time + 1) / 1000,
        tz=ZoneInfo(settings.session_time_zone),
    )
    interval_minutes = (
        settings.final_hour_scan_minutes
        if boundary.hour == 15
        else settings.regular_scan_minutes
    )
    return boundary.minute % interval_minutes == 0


def available_history(
    session_candles: list[Candle],
    trigger_candle: Candle,
    settings: ReplaySettings,
) -> list[Candle]:
    """Return the candles the live fetch window would expose at a trigger."""

    if settings.mode == "every-bar":
        return list(session_candles)

    cutoff = trigger_candle.end_time - settings.request_lookback_hours * 60 * 60 * 1000
    return [candle for candle in session_candles if candle.end_time >= cutoff]
