import { renderMarketBriefChart } from "./chart";
import { loadConfig } from "./config";
import {
  publicScanResult,
  sendMarketBrief,
  sendSignal,
  sendVersionNotice,
} from "./discord";
import {
  fetchFiveMinuteCandles,
  HyperliquidRateLimitError,
} from "./hyperliquid";
import {
  filterCurrentSession,
  getBriefIntervalMinutes,
  getScheduleDecision,
} from "./market-hours";
import { analyzeSession } from "./signal-engine";
import type { Env, ScanResult, ScannerConfig } from "./types";

const VERSION_NOTICE_KEY = "last-version-notice";
const RECENT_VERSION_NOTICE_WINDOW_MS = 20 * 60 * 1000;
let lastVersionNoticeSentFor: string | null = null;

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
    context.waitUntil(runScheduledScan(config, now, briefDue));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
      const result = await runScan(loadConfig(env), new Date(), false, false);
      return Response.json(publicScanResult(result));
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
): Promise<ScanResult> {
  const candles = await fetchFiveMinuteCandles(
    config.hyperliquidCoin,
    now,
  );
  const sessionCandles = filterCurrentSession(candles, now);
  const result = analyzeSession(config.hyperliquidCoin, sessionCandles, {
    minimumWatchPriceR: config.minimumWatchPriceR,
    minimumWatchConfidenceScore: config.minimumWatchConfidenceScore,
    minimumPriceR: config.minimumPriceR,
    minimumConfidenceScore: config.minimumConfidenceScore,
  });
  console.log(
    JSON.stringify({
      market: result.market,
      candleCount: result.candleCount,
      status: result.status,
      watch: result.watch?.direction ?? null,
      signal: result.signal?.direction ?? null,
    }),
  );
  const notificationOpportunity = result.signal ?? result.watch;
  if (notify && notificationOpportunity !== null) {
    await sendSignal(config.discordWebhookUrl, notificationOpportunity);
  }
  if (notify && sendBrief) {
    const chart = await renderMarketBriefChart(result, sessionCandles);
    await sendMarketBrief(config.discordWebhookUrl, result, now, fetch, chart);
  }
  return result;
}

async function runScheduledScan(
  config: ScannerConfig,
  now: Date,
  sendBrief: boolean,
): Promise<void> {
  try {
    await runScan(config, now, true, sendBrief);
  } catch (error) {
    if (error instanceof HyperliquidRateLimitError) {
      console.warn(
        JSON.stringify({
          status: "skipped",
          reason: "hyperliquid_rate_limited",
          market: config.hyperliquidCoin,
          scheduledTime: now.toISOString(),
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
  );
  lastVersionNoticeSentFor = versionKey;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
