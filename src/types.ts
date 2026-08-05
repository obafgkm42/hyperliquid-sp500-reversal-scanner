export interface Env {
  DISCORD_WEBHOOK_URL: string;
  DISCORD_APPLICATION_PUBLIC_KEY?: string;
  DISCORD_GUILD_ID?: string;
  MANUAL_SCAN_TOKEN?: string;
  LANGUAGE?: string;
  HYPERLIQUID_COIN?: string;
  REGULAR_SCAN_MINUTES?: string;
  FINAL_HOUR_SCAN_MINUTES?: string;
  BRIEF_INTERVAL_MINUTES?: string;
  MINIMUM_WATCH_PRICE_R?: string;
  MINIMUM_WATCH_CONFIDENCE_SCORE?: string;
  MINIMUM_PRICE_R?: string;
  MINIMUM_CONFIDENCE_SCORE?: string;
  WORKER_VERSION?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  SCANNER_STATE?: KVNamespace;
}

export type Language = "en" | "zh";

export interface ScannerConfig {
  discordWebhookUrl: string;
  language: Language;
  hyperliquidCoin: string;
  regularScanMinutes: number;
  finalHourScanMinutes: number;
  briefIntervalMinutes: number;
  minimumWatchPriceR: number;
  minimumWatchConfidenceScore: number;
  minimumPriceR: number;
  minimumConfidenceScore: number;
  workerVersionKey: string;
  workerVersionLabel: string;
  workerVersionUploadedAt: Date | null;
  scannerState?: KVNamespace;
}

export interface Candle {
  startTime: number;
  endTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

export interface MarketAssetContext {
  coin: string;
  markPrice: number;
  oraclePrice: number;
  previousDayPrice: number;
  fundingRate: number;
  premium: number | null;
  dayNotionalVolume: number;
}

export type MarketFragilityLevel =
  | "resilient"
  | "fragile"
  | "breaking"
  | "panic"
  | "unknown";

export type MarketFragilityDataQuality =
  | "full"
  | "partial"
  | "insufficient";

export type MarketFragilityIndicatorId =
  | "session_loss"
  | "vwap_repair_failure"
  | "poor_close_location"
  | "downside_tail_cluster"
  | "mega_cap_breadth"
  | "equity_cross_confirmation";

export type MarketFragilityIndicatorState =
  | "healthy"
  | "stressed"
  | "unavailable";

export interface MarketFragilityIndicator {
  id: MarketFragilityIndicatorId;
  state: MarketFragilityIndicatorState;
  value: number | null;
  displayValue: string;
  threshold: string;
}

export interface MarketFragilitySnapshot {
  level: MarketFragilityLevel;
  score: number | null;
  stressedIndicatorCount: number;
  availableIndicatorCount: number;
  totalIndicatorCount: number;
  dataQuality: MarketFragilityDataQuality;
  indicators: MarketFragilityIndicator[];
}

export type Direction = "bullish" | "bearish";
export type SignalLevel = "watch" | "alert";
export type SignalPolicyRole =
  | "bullish_reversal_zone"
  | "bearish_crash_monitor";

export interface SignalPolicy {
  name: string;
  role: SignalPolicyRole;
  alertEligible: boolean;
  watchEligible: boolean;
  reasons: string[];
}

export interface ReversalLocation {
  level: SignalLevel;
  direction: Direction;
  market: string;
  price: number;
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  target: number;
  sessionHigh: number;
  sessionLow: number;
  vwap: number;
  priceRiskReward: number;
  confidenceScore: number;
  policy: SignalPolicy;
  reasons: string[];
  timestamp: number;
}

export type NotificationStatus =
  | "fresh"
  | "outside_entry_zone"
  | "invalidated_before_delivery"
  | "target_reached_before_delivery";

export interface NotificationOpportunity {
  signal: ReversalLocation;
  observedAt: number;
  observedPrice: number;
  status: NotificationStatus;
  reason: string;
}

export interface AnalysisThresholds {
  minimumWatchPriceR: number;
  minimumWatchConfidenceScore: number;
  minimumPriceR: number;
  minimumConfidenceScore: number;
}

export interface ScanResult {
  watch: ReversalLocation | null;
  signal: ReversalLocation | null;
  market: string;
  candleCount: number;
  sessionHigh: number | null;
  sessionLow: number | null;
  latestPrice: number | null;
  status: string;
}

export interface ResiliencePriceSnapshot {
  sessionKey: string;
  timestamp: number;
  price: number;
  sessionHigh: number;
  sessionLow: number;
  isSessionClose: boolean;
}

export type ResilienceShockCompletionReason =
  | "recovered"
  | "session_close";

export interface ResilienceShockEvent {
  id: string;
  sessionKey: string;
  startedAt: number;
  triggerPrice: number;
  sessionHighAtTrigger: number;
  troughPrice: number;
  troughAt: number;
  oneHourPrice: number | null;
  oneHourTroughPrice: number | null;
  twoHourPrice: number | null;
  twoHourTroughPrice: number | null;
  closePrice: number | null;
  closeTroughPrice: number | null;
  recoveredAt: number | null;
  completedAt: number | null;
  completionReason: ResilienceShockCompletionReason | null;
}

export interface ResilienceDecayState {
  version: 2;
  market: string;
  sessionKey: string;
  snapshots: ResiliencePriceSnapshot[];
  activeShock: ResilienceShockEvent | null;
  completedShocks: ResilienceShockEvent[];
}

export type ResilienceDecayStatus =
  | "INSUFFICIENT_DATA"
  | "RESILIENT"
  | "FADING"
  | "FRAGILE";

export interface ResilienceEventScore {
  eventId: string;
  oneHourRecoveryRatio: number;
  twoHourRecoveryRatio: number;
  closeRecoveryRatio: number;
  eventScore: number;
}

export interface ResilienceDecayMetrics {
  status: ResilienceDecayStatus;
  recentResilience: number | null;
  baselineResilience: number | null;
  decayDelta: number | null;
  recentEventScoreSlope: number | null;
  decayScore: number | null;
  scoredShockCount: number;
  unscoredShockCount: number;
  eventScores: ResilienceEventScore[];
}
