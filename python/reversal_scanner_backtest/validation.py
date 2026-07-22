"""Historical candle validation and reproducibility metadata."""

from __future__ import annotations

import hashlib
import math
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from reversal_scanner_backtest.models import Candle


@dataclass(frozen=True)
class DatasetValidationReport:
    """Quality checks required before a candle file is used for research."""

    candle_count: int
    duplicate_end_times: int
    out_of_order_rows: int
    invalid_ohlc_rows: int
    invalid_duration_rows: int
    negative_volume_rows: int
    zero_volume_rate: float | None
    weekend_candle_rate: float | None
    session_date_count: int
    irregular_session_intervals: int
    expected_interval_minutes: int
    warnings: list[str]
    errors: list[str]

    @property
    def is_valid(self) -> bool:
        """Return whether no fatal data errors were found."""

        return not self.errors

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-compatible report."""

        return {**asdict(self), "is_valid": self.is_valid}


def dataset_sha256(path: Path) -> str:
    """Return a stable SHA-256 digest for a historical input file."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_candles(
    candles: list[Candle],
    expected_interval_minutes: int,
    session_time_zone: str,
) -> DatasetValidationReport:
    """Validate ordering, OHLC integrity, volume, and intraday cadence."""

    if expected_interval_minutes <= 0:
        raise ValueError("expected_interval_minutes must be positive")
    time_zone = ZoneInfo(session_time_zone)
    expected_interval_ms = expected_interval_minutes * 60_000
    seen_end_times: set[int] = set()
    duplicate_end_times = 0
    out_of_order_rows = 0
    invalid_ohlc_rows = 0
    invalid_duration_rows = 0
    negative_volume_rows = 0
    zero_volume_rows = 0
    irregular_session_intervals = 0
    weekend_rows = 0
    session_dates: set[str] = set()

    previous: Candle | None = None
    for candle in candles:
        local_timestamp = datetime.fromtimestamp(candle.end_time / 1000, tz=time_zone)
        session_dates.add(local_timestamp.strftime("%Y-%m-%d"))
        if local_timestamp.weekday() >= 5:
            weekend_rows += 1
        if candle.end_time in seen_end_times:
            duplicate_end_times += 1
        seen_end_times.add(candle.end_time)
        if previous is not None:
            if candle.end_time <= previous.end_time:
                out_of_order_rows += 1
            elif (
                _date_key(previous.end_time, time_zone)
                == _date_key(candle.end_time, time_zone)
                and candle.start_time - previous.start_time != expected_interval_ms
            ):
                irregular_session_intervals += 1
        if not _valid_ohlc(candle):
            invalid_ohlc_rows += 1
        if candle.end_time - candle.start_time + 1 != expected_interval_ms:
            invalid_duration_rows += 1
        if candle.volume < 0:
            negative_volume_rows += 1
        if candle.volume == 0:
            zero_volume_rows += 1
        previous = candle

    zero_volume_rate = None if not candles else zero_volume_rows / len(candles)
    weekend_candle_rate = None if not candles else weekend_rows / len(candles)
    warnings: list[str] = []
    errors: list[str] = []
    if zero_volume_rate is not None and zero_volume_rate >= 0.99:
        warnings.append(
            "at least 99% of candles have zero volume; VWAP will fall back to average close"
        )
    if irregular_session_intervals > 0:
        warnings.append(
            f"found {irregular_session_intervals} unexpected intervals inside session dates"
        )
    if candles and weekend_rows == 0:
        warnings.append(
            "dataset contains no weekend candles and cannot validate the live 24/7 schedule"
        )
    if duplicate_end_times > 0:
        errors.append(f"found {duplicate_end_times} duplicate candle end times")
    if out_of_order_rows > 0:
        errors.append(f"found {out_of_order_rows} out-of-order candle rows")
    if invalid_ohlc_rows > 0:
        errors.append(f"found {invalid_ohlc_rows} invalid OHLC rows")
    if invalid_duration_rows > 0:
        errors.append(
            f"found {invalid_duration_rows} rows that are not {expected_interval_minutes}-minute candles"
        )
    if negative_volume_rows > 0:
        errors.append(f"found {negative_volume_rows} rows with negative volume")

    return DatasetValidationReport(
        candle_count=len(candles),
        duplicate_end_times=duplicate_end_times,
        out_of_order_rows=out_of_order_rows,
        invalid_ohlc_rows=invalid_ohlc_rows,
        invalid_duration_rows=invalid_duration_rows,
        negative_volume_rows=negative_volume_rows,
        zero_volume_rate=zero_volume_rate,
        weekend_candle_rate=weekend_candle_rate,
        session_date_count=len(session_dates),
        irregular_session_intervals=irregular_session_intervals,
        expected_interval_minutes=expected_interval_minutes,
        warnings=warnings,
        errors=errors,
    )


def _valid_ohlc(candle: Candle) -> bool:
    values = [candle.open, candle.high, candle.low, candle.close, candle.volume]
    return (
        all(math.isfinite(value) for value in values)
        and candle.low <= candle.high
        and candle.low <= candle.open <= candle.high
        and candle.low <= candle.close <= candle.high
    )


def _date_key(timestamp: int, time_zone: ZoneInfo) -> str:
    return datetime.fromtimestamp(timestamp / 1000, tz=time_zone).strftime("%Y-%m-%d")
