import type {
  Language,
  MarketActivityDataQuality,
  MarketActivitySnapshot,
} from "./types";

const EASTERN_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Format one compact bilingual diagnostic for Discord cards. */
export function formatMarketActivitySummary(
  activity: MarketActivitySnapshot,
  language: Language,
): string {
  const english = language === "en";
  const asOf = `${EASTERN_TIME_FORMATTER.format(new Date(activity.asOf))} ET`;
  const history = english
    ? `${activity.sampleSessions} historical sessions`
    : `${activity.sampleSessions} 個歷史交易日`;
  const quality = formatMarketActivityDataQuality(
    activity.dataQuality,
    language,
  );

  if (activity.level === "FORMING") {
    return english
      ? `FORMING · opening profile still forming · ${history} · through ${asOf}`
      : `FORMING · 開盤成交輪廓形成中 · ${history} · 截至 ${asOf}`;
  }
  if (activity.level === "UNKNOWN" || activity.sessionRvol === null) {
    return english
      ? `UNKNOWN · activity data unavailable · ${history} · ${quality}`
      : `UNKNOWN · 市場活躍度資料不足 · ${history} · ${quality}`;
  }

  const percentile = activity.percentile === null
    ? english
      ? `percentile pending/${activity.sampleSessions}`
      : `百分位待累積/${activity.sampleSessions}`
    : `P${Math.round(activity.percentile)}/${activity.sampleSessions}`;
  const bar = activity.barRvol === null || activity.barActivity === null
    ? english
      ? "15m n/a"
      : "15m 無資料"
    : `15m ${activity.barRvol.toFixed(2)}x ${activity.barActivity.toUpperCase()}`;
  const confidence = english
    ? activity.confidence
    : formatConfidence(activity.confidence);
  return [
    activity.level,
    `${english ? "cumulative RVOL" : "累積 RVOL"} ${activity.sessionRvol.toFixed(2)}x`,
    percentile,
    bar,
    `${english ? "confidence" : "可信度"} ${confidence}`,
    `${english ? "through" : "截至"} ${asOf}`,
  ].join(" · ");
}

/** Localize the sample-depth label without changing its machine value. */
export function formatMarketActivityDataQuality(
  quality: MarketActivityDataQuality,
  language: Language,
): string {
  if (language === "en") {
    return quality;
  }
  const labels: Record<MarketActivityDataQuality, string> = {
    insufficient: "資料不足",
    provisional: "初步",
    limited: "有限",
    good: "良好",
    full: "完整",
  };
  return labels[quality];
}

function formatConfidence(
  confidence: MarketActivitySnapshot["confidence"],
): string {
  const labels: Record<MarketActivitySnapshot["confidence"], string> = {
    unavailable: "不可用",
    provisional: "初步",
    borderline: "臨界",
    confirmed: "確認",
    mixed: "分歧",
  };
  return labels[confidence];
}
