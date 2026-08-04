import { renderMarketBriefChart } from "./chart";
import { loadConfig } from "./config";
import { handleDiscordInteraction } from "./discord-interactions";
import {
  publicScanResult,
  sendMarketBrief,
  sendRateLimitNotice,
  sendSignal,
  sendVersionNotice,
} from "./discord";
import {
  fetchFiveMinuteCandles,
  fetchXyzMarketContexts,
  HyperliquidRateLimitError,
} from "./hyperliquid";
import {
  analyzeMarketFragility,
  FRAGILITY_CONTEXT_COINS,
} from "./market-fragility";
import {
  getBriefIntervalMinutes,
  getPreviousScanTime,
  getScheduleDecision,
  isRthClose,
  selectAnalysisSession,
} from "./market-hours";
import {
  calculateResilienceMetrics,
  updateResilienceDecayState,
} from "./resilience-decay";
import type { ResilienceDecayUpdate } from "./resilience-decay";
import {
  clearRateLimitIncident,
  getLastSuccessfulCandleEnd,
  isRateLimitIncidentActive,
  markRateLimitIncidentActive,
  markSignalSent,
  setLastSuccessfulCandleEnd,
  wasSignalSent,
} from "./scanner-state";
import {
  analyzeSession,
  findNotificationOpportunities,
} from "./signal-engine";
import type {
  AnalysisThresholds,
  Candle,
  Env,
  MarketFragilitySnapshot,
  ResiliencePriceSnapshot,
  ScanResult,
  ScannerConfig,
} from "./types";

const VERSION_NOTICE_KEY = "last-version-notice";
const RECENT_VERSION_NOTICE_WINDOW_MS = 20 * 60 * 1000;
let lastVersionNoticeSentFor: string | null = null;

interface ScanExecutionResult {
  scan: ScanResult;
  fragility: MarketFragilitySnapshot | null;
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    const config = loadConfig(env);
    const now = new Date(controller.scheduledTime);
    const decision = getScheduleDecision(now, config);
    const briefIntervalMinutes = getBriefIntervalMinutes(
      now,
      config.briefIntervalMinutes,
    );
    const briefDue = isBriefDue(now, briefIntervalMinutes);
    context.waitUntil(maybeSendVersionNotice(config, now));
    if (!decision.shouldRun && !briefDue) {
      console.log(`scan skipped: ${decision.reason}`);
      return;
    }
    const fallbackNotificationWindowStart = decision.shouldRun
      ? getPreviousScanTime(now, config)
      : null;
    context.waitUntil(
      runScheduledScan(
        config,
        now,
        decision.shouldRun,
        briefDue,
        fallbackNotificationWindowStart,
      ),
    );
  },

  async fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      url.pathname === "/discord/interactions"
    ) {
      const config = loadConfig(env);
      return handleDiscordInteraction(request, {
        publicKey: env.DISCORD_APPLICATION_PUBLIC_KEY,
        allowedGuildId: env.DISCORD_GUILD_ID,
        language: config.language,
        getStatus: () =>
          runScan(config, new Date(), false, false, null),
        waitUntil: (promise) => context.waitUntil(promise),
      });
    }
    if (request.method !== "GET" || url.pathname !== "/scan") {
      return Response.json(
        {
          service: "hyperliquid-sp500-reversal-scanner",
          endpoint: "GET /scan",
          execution: "read-only alerts; no order placement",
        },
        { status: 200 },
      );
    }
    if (
      env.MANUAL_SCAN_TOKEN === undefined ||
      request.headers.get("Authorization") !==
        `Bearer ${env.MANUAL_SCAN_TOKEN}`
    ) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    try {
      const config = loadConfig(env);
      const execution = await runScan(
        config,
        new Date(),
        false,
        false,
        null,
      );
      return Response.json(
        publicScanResult(
          execution.scan,
          config.language,
          execution.fragility ?? undefined,
        ),
      );
    } catch (error) {
      console.error("manual scan failed", safeErrorName(error));
      return Response.json({ error: "scan failed" }, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env>;

async function runScan(
  config: ScannerConfig,
  now: Date,
  notify: boolean,
  sendBrief: boolean,
  notificationWindowStart: Date | null,
): Promise<ScanExecutionResult> {
  const candles = await fetchFiveMinuteCandles(
    config.hyperliquidCoin,
    now,
  );
  const analysisSession = selectAnalysisSession(candles, now);
  const sessionCandles = analysisSession.candles;
  const thresholds: AnalysisThresholds = {
    minimumWatchPriceR: config.minimumWatchPriceR,
    minimumWatchConfidenceScore: config.minimumWatchConfidenceScore,
    minimumPriceR: config.minimumPriceR,
    minimumConfidenceScore: config.minimumConfidenceScore,
  };
  const result = analyzeSession(
    config.hyperliquidCoin,
    sessionCandles,
    thresholds,
  );
  const resilienceUpdate = await maybeRecordResilienceSnapshot(
    config,
    now,
    sendBrief,
    analysisSession.kind,
    sessionCandles,
  );
  if (
    resilienceUpdate?.state !== null &&
    resilienceUpdate?.state !== undefined
  ) {
    const metrics = calculateResilienceMetrics(resilienceUpdate.state);
    console.log(
      JSON.stringify({
        status: "resilience_decay_metrics",
        market: config.hyperliquidCoin,
        resilienceStatus: metrics.status,
        recentResilience: metrics.recentResilience,
        baselineResilience: metrics.baselineResilience,
        decayDelta: metrics.decayDelta,
        recentEventScoreSlope: metrics.recentEventScoreSlope,
        decayScore: metrics.decayScore,
        scoredShockCount: metrics.scoredShockCount,
      }),
    );
  }
  const notificationOpportunities =
    notify &&
    analysisSession.notificationsEnabled &&
    notificationWindowStart !== null
      ? findNotificationOpportunities(
          config.hyperliquidCoin,
          sessionCandles,
          thresholds,
          notificationWindowStart.getTime(),
          now.getTime(),
        )
      : [];
  let fragility = !notify
    ? await calculateMarketFragility(sessionCandles)
    : null;
  console.log(
    JSON.stringify({
      market: result.market,
      candleCount: result.candleCount,
      status: result.status,
      watch: result.watch?.direction ?? null,
      signal: result.signal?.direction ?? null,
      analysisSession: analysisSession.kind,
      notificationsEnabled: analysisSession.notificationsEnabled,
      evaluatedNewCandles:
        notificationWindowStart === null
          ? 0
          : sessionCandles.filter(
              (candle) =>
                candle.endTime >= notificationWindowStart.getTime(),
            ).length,
      notificationTimestamps: notificationOpportunities.map(
        (opportunity) => ({
          signalTime: new Date(
            opportunity.signal.timestamp,
          ).toISOString(),
          observedAt: new Date(opportunity.observedAt).toISOString(),
          observedPrice: opportunity.observedPrice,
          status: opportunity.status,
        }),
      ),
    }),
  );
  for (const notificationOpportunity of notificationOpportunities) {
    if (notificationOpportunity.status !== "fresh") {
      console.log(
        JSON.stringify({
          status: "notification_suppressed",
          reason: notificationOpportunity.reason,
          market: notificationOpportunity.signal.market,
          signalTime: new Date(
            notificationOpportunity.signal.timestamp,
          ).toISOString(),
          observedAt: new Date(
            notificationOpportunity.observedAt,
          ).toISOString(),
          observedPrice: notificationOpportunity.observedPrice,
        }),
      );
      continue;
    }
    if (
      await wasSignalSent(
        config.scannerState,
        notificationOpportunity.signal,
      )
    ) {
      console.log(
        JSON.stringify({
          status: "notification_deduplicated",
          market: notificationOpportunity.signal.market,
          signalTime: new Date(
            notificationOpportunity.signal.timestamp,
          ).toISOString(),
        }),
      );
      continue;
    }
    await sendSignal(
      config.discordWebhookUrl,
      notificationOpportunity.signal,
      fetch,
      config.language,
      notificationOpportunity,
    );
    await markSignalSent(
      config.scannerState,
      notificationOpportunity.signal,
    );
  }
  if (sendBrief && fragility === null) {
    // Optional cross-market work runs after time-sensitive signal delivery.
    fragility = await calculateMarketFragility(sessionCandles);
  }
  if (fragility !== null) {
    console.log(
      JSON.stringify({
        status: "market_fragility",
        level: fragility.level,
        score: fragility.score,
        stressedIndicatorCount: fragility.stressedIndicatorCount,
        availableIndicatorCount: fragility.availableIndicatorCount,
        dataQuality: fragility.dataQuality,
      }),
    );
  }
  if (sendBrief) {
    const chart = await renderMarketBriefChart(result, sessionCandles);
    await sendMarketBrief(
      config.discordWebhookUrl,
      result,
      now,
      fetch,
      chart,
      config.language,
      fragility ?? undefined,
    );
  }
  if (notify) {
    const latestCompletedCandle = candles.at(-1);
    if (latestCompletedCandle !== undefined) {
      await setLastSuccessfulCandleEnd(
        config.scannerState,
        config.hyperliquidCoin,
        latestCompletedCandle.endTime,
      );
    }
  }
  return { scan: result, fragility };
}

async function maybeRecordResilienceSnapshot(
  config: ScannerConfig,
  now: Date,
  briefDue: boolean,
  sessionKind: ReturnType<typeof selectAnalysisSession>["kind"],
  sessionCandles: readonly Candle[],
): Promise<ResilienceDecayUpdate | null> {
  if (
    !briefDue ||
    config.hyperliquidCoin !== "xyz:SP500" ||
    sessionKind !== "rth"
  ) {
    return null;
  }
  const firstCandle = sessionCandles[0];
  const latestCandle = sessionCandles.at(-1);
  if (firstCandle === undefined || latestCandle === undefined) {
    return null;
  }
  const snapshot: ResiliencePriceSnapshot = {
    sessionKey: new Date(firstCandle.startTime)
      .toISOString()
      .slice(0, 10),
    timestamp: latestCandle.endTime,
    price: latestCandle.close,
    sessionHigh: Math.max(
      ...sessionCandles.map((candle) => candle.high),
    ),
    sessionLow: Math.min(
      ...sessionCandles.map((candle) => candle.low),
    ),
    isSessionClose: isRthClose(now),
  };
  const update = await updateResilienceDecayState(
    config.scannerState,
    config.hyperliquidCoin,
    snapshot,
  );
  console.log(
    JSON.stringify({
      status: "resilience_decay_state",
      market: config.hyperliquidCoin,
      sessionKey: snapshot.sessionKey,
      changed: update.changed,
      snapshotCount: update.state?.snapshots.length ?? 0,
      completedShockCount: update.state?.completedShocks.length ?? 0,
      activeShock: update.state?.activeShock?.id ?? null,
      shockStarted: update.shockStarted,
      shockCompleted: update.shockCompleted,
      approximateCpuMs: update.approximateCpuMs,
    }),
  );
  return update;
}

async function calculateMarketFragility(
  candles: readonly Candle[],
): Promise<MarketFragilitySnapshot> {
  try {
    const contexts = await fetchXyzMarketContexts(FRAGILITY_CONTEXT_COINS);
    return analyzeMarketFragility(candles, contexts);
  } catch (error) {
    console.warn(
      JSON.stringify({
        status: "market_fragility_context_degraded",
        reason: safeErrorName(error),
        effect: "market fragility uses price-only indicators",
      }),
    );
    return analyzeMarketFragility(candles, []);
  }
}

async function runScheduledScan(
  config: ScannerConfig,
  now: Date,
  notify: boolean,
  sendBrief: boolean,
  fallbackNotificationWindowStart: Date | null,
): Promise<void> {
  let rateLimitIncidentActive = false;
  try {
    if (notify && config.scannerState === undefined) {
      console.warn(
        JSON.stringify({
          message: "scanner state KV is not bound",
          status: "degraded",
          reason: "scanner_state_not_bound",
          effect:
            "failed-scan recovery and cross-invocation signal dedupe use best-effort fallbacks",
        }),
      );
    }
    rateLimitIncidentActive = await isRateLimitIncidentActive(
      config.scannerState,
      config.hyperliquidCoin,
    );
    const persistedCandleEnd = notify
      ? await getLastSuccessfulCandleEnd(
          config.scannerState,
          config.hyperliquidCoin,
        )
      : null;
    const notificationWindowStart =
      persistedCandleEnd !== null &&
      persistedCandleEnd < now.getTime()
        ? new Date(persistedCandleEnd + 1)
        : fallbackNotificationWindowStart;
    await runScan(
      config,
      now,
      notify,
      sendBrief,
      notificationWindowStart,
    );
    if (rateLimitIncidentActive) {
      await clearRateLimitIncident(
        config.scannerState,
        config.hyperliquidCoin,
      );
    }
  } catch (error) {
    if (error instanceof HyperliquidRateLimitError) {
      let discordNotice = "deduplicated";
      if (!rateLimitIncidentActive) {
        await sendRateLimitNotice(
          config.discordWebhookUrl,
          config.hyperliquidCoin,
          now,
          fetch,
          config.language,
        );
        await markRateLimitIncidentActive(
          config.scannerState,
          config.hyperliquidCoin,
        );
        discordNotice = "sent";
      }
      console.warn(
        JSON.stringify({
          message: "scheduled scan skipped: Hyperliquid rate limited",
          status: "skipped",
          reason: "hyperliquid_rate_limited",
          market: config.hyperliquidCoin,
          scheduledTime: now.toISOString(),
          discordNotice,
        }),
      );
      return;
    }
    throw error;
  }
}

function isBriefDue(timestamp: Date, intervalMinutes: number): boolean {
  const minuteOfDay = timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
  return minuteOfDay % intervalMinutes === 0;
}

async function maybeSendVersionNotice(
  config: ScannerConfig,
  now: Date,
): Promise<void> {
  if (config.scannerState === undefined) {
    await maybeSendRecentVersionNoticeWithoutState(config, now);
    return;
  }

  const lastSentVersion = await config.scannerState.get(VERSION_NOTICE_KEY);
  if (lastSentVersion === config.workerVersionKey) {
    return;
  }
  await sendVersionNotice(
    config.discordWebhookUrl,
    config.workerVersionLabel,
    now,
    fetch,
    config.language,
  );
  await config.scannerState.put(VERSION_NOTICE_KEY, config.workerVersionKey);
}

async function maybeSendRecentVersionNoticeWithoutState(
  config: ScannerConfig,
  now: Date,
): Promise<void> {
  if (
    config.workerVersionUploadedAt === null ||
    now.getTime() - config.workerVersionUploadedAt.getTime() >
      RECENT_VERSION_NOTICE_WINDOW_MS
  ) {
    console.log(
      "version notice skipped: no recent Worker version metadata and SCANNER_STATE KV is not bound",
    );
    return;
  }

  const versionKey = `${VERSION_NOTICE_KEY}:${config.workerVersionKey}`;
  if (lastVersionNoticeSentFor === versionKey) {
    return;
  }
  await sendVersionNotice(
    config.discordWebhookUrl,
    config.workerVersionLabel,
    now,
    fetch,
    config.language,
  );
  lastVersionNoticeSentFor = versionKey;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
