import type {
  Language,
  MarketFragilityIndicatorId,
  MarketFragilitySnapshot,
} from "./types";

/**
 * Format the classifier level for compact Discord surfaces.
 */
export function formatMarketFragilityLevel(
  fragility: MarketFragilitySnapshot,
): string {
  return fragility.level.toUpperCase();
}

/**
 * Label the ordinal score as stress so a favorable zero is unambiguous.
 */
export function formatMarketFragilityStressScore(
  fragility: MarketFragilitySnapshot,
  language: Language,
): string {
  const score = fragility.score === null ? "n/a" : `${fragility.score}/100`;
  return language === "en" ? `stress ${score}` : `壓力 ${score}`;
}

/**
 * Format one consistent summary across scheduled and interactive Discord UI.
 */
export function formatMarketFragilitySummary(
  fragility: MarketFragilitySnapshot,
  language: Language,
): string {
  const level = formatMarketFragilityLevel(fragility);
  const stressScore = formatMarketFragilityStressScore(fragility, language);
  if (language === "en") {
    return `${level} · ${stressScore} · ${fragility.stressedIndicatorCount}/${fragility.availableIndicatorCount} repair mechanisms stressed`;
  }
  return `${level} · ${stressScore} · ${fragility.stressedIndicatorCount}/${fragility.availableIndicatorCount} 個修復機制受壓`;
}

/**
 * Localize the classifier's data-coverage label.
 */
export function formatMarketFragilityDataQuality(
  fragility: MarketFragilitySnapshot,
  language: Language,
): string {
  if (language === "en") {
    return fragility.dataQuality;
  }
  if (fragility.dataQuality === "full") {
    return "完整";
  }
  if (fragility.dataQuality === "partial") {
    return "部分";
  }
  return "不足";
}

/**
 * Localize one repair-mechanism label.
 */
export function formatMarketFragilityIndicatorLabel(
  id: MarketFragilityIndicatorId,
  language: Language,
): string {
  const englishLabels: Record<MarketFragilityIndicatorId, string> = {
    session_loss: "session loss",
    vwap_repair_failure: "VWAP repair failure",
    poor_close_location: "poor close location",
    downside_tail_cluster: "downside-tail cluster",
    mega_cap_breadth: "mega-cap breadth",
    equity_cross_confirmation: "SP500 / XYZ100 confirmation",
  };
  if (language === "en") {
    return englishLabels[id];
  }
  const chineseLabels: Record<MarketFragilityIndicatorId, string> = {
    session_loss: "時段跌幅",
    vwap_repair_failure: "VWAP 修復失敗",
    poor_close_location: "收盤承接偏弱",
    downside_tail_cluster: "下跌尾部群聚",
    mega_cap_breadth: "大型股廣度惡化",
    equity_cross_confirmation: "SP500 / XYZ100 同步走弱",
  };
  return chineseLabels[id];
}

/**
 * Map market fragility to the shared Discord severity color.
 */
export function marketFragilityColor(
  fragility: MarketFragilitySnapshot,
): number {
  if (fragility.level === "panic") {
    return 0xc0392b;
  }
  if (fragility.level === "breaking") {
    return 0xe67e22;
  }
  if (fragility.level === "fragile") {
    return 0xf1c40f;
  }
  if (fragility.level === "resilient") {
    return 0x2ecc71;
  }
  return 0x95a5a6;
}
