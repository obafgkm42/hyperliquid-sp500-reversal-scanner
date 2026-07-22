import type { ChartAttachment } from "./chart";
import { localizeDiagnostic } from "./i18n";
import type { Language, ReversalLocation, ScanResult } from "./types";

/**
 * Send one qualified price-location alert to Discord.
 */
export async function sendSignal(
  webhookUrl: string,
  signal: ReversalLocation,
  fetcher: typeof fetch = fetch,
  language: Language = "zh",
): Promise<void> {
  const bullish = signal.direction === "bullish";
  const alertLevel = signal.level === "alert";
  const english = language === "en";
  const policyDescription = signal.policy.role === "bullish_reversal_zone"
    ? english
      ? "Bullish-first reversal-zone policy: primarily looks for intraday bottom reversals in the modern market regime."
      : "多頭優先反轉區政策：主要尋找現代市場狀態下的日內低點反轉區。"
    : english
      ? "Bearish crash-monitor policy: retains top-reversal warnings only under a stricter stress regime."
      : "空頭崩跌監測政策：只在較嚴格的壓力市場狀態下保留高點反轉警示。";
  await sendWebhook(
    webhookUrl,
    {
      embeds: [
        {
          title: `${bullish ? "🟢" : "🔴"} SP500 ${alertLevel ? "ALERT" : "WATCH"} · ${english ? (bullish ? "Bottom reversal candidate zone" : "Top reversal candidate zone") : (bullish ? "低點反轉候選區" : "高點反轉候選區")}`,
          description: alertLevel
            ? `${policyDescription}\n${english ? "Price location meets the ALERT thresholds; option-book data, Greeks, option fills, and actual option P&L remain unmodeled." : "價格位置已達 ALERT 門檻；仍不含期權委託簿、Greeks、期權成交價或實際期權盈虧估算。"}`
            : `${policyDescription}\n${english ? "Early WATCH level: price location shows a possible reversal but has not met the stricter ALERT thresholds." : "提早觀察級別：價格位置有反轉雛形，但尚未達到嚴格的 ALERT 門檻。"}`,
          color: alertLevel ? (bullish ? 0x2ecc71 : 0xe74c3c) : 0xf1c40f,
          fields: [
            {
              name: english ? "Level" : "級別",
              value: signal.level.toUpperCase(),
              inline: true,
            },
            {
              name: english ? "Direction / Market" : "方向 / 市場",
              value: `${formatDirection(signal.direction, language)} · ${signal.market}`,
              inline: true,
            },
            {
              name: english ? "Signal price" : "訊號價格",
              value: signal.price.toFixed(1),
              inline: true,
            },
            {
              name: english ? "Confidence score" : "信心分",
              value: `${signal.confidenceScore}/100`,
              inline: true,
            },
            {
              name: english ? "Entry watch zone" : "觀察進場區",
              value: `${signal.entryLow.toFixed(1)} – ${signal.entryHigh.toFixed(1)}`,
              inline: true,
            },
            {
              name: english ? "Invalidation" : "失效點",
              value: signal.invalidation.toFixed(1),
              inline: true,
            },
            {
              name: english ? "First mean-reversion target" : "第一回歸目標",
              value: signal.target.toFixed(1),
              inline: true,
            },
            {
              name: english ? "Underlying price R/R" : "標的價格盈虧比",
              value: `${signal.priceRiskReward.toFixed(1)}R`,
              inline: true,
            },
            {
              name: english ? "Policy" : "策略",
              value: `${signal.policy.name} · ${formatPolicyRole(signal.policy.role, language)}`,
              inline: true,
            },
            {
              name: english ? "Observed high / low / VWAP" : "觀察高 / 低 / VWAP",
              value: `${signal.sessionHigh.toFixed(1)} / ${signal.sessionLow.toFixed(1)} / ${signal.vwap.toFixed(1)}`,
              inline: true,
            },
            {
              name: english ? "Regime gate" : "市場狀態門檻",
              value: signal.policy.reasons
                .map((reason) => `• ${localizeDiagnostic(reason, language)}`)
                .join("\n"),
            },
            {
              name: english ? "Why it qualifies" : "成立原因",
              value: signal.reasons
                .map((reason) => `• ${localizeDiagnostic(reason, language)}`)
                .join("\n"),
            },
            {
              name: english ? "Risk boundary" : "風險邊界",
              value:
                english
                  ? "This is a price-location alert, not a guarantee of an 8R option return. Hyperliquid SP500 perpetual and cash SPX can differ through basis, liquidity, and funding risk."
                  : "這是價格位置提示，不是期權 8R 保證。Hyperliquid SP500 永續合約與現貨 SPX 仍可能有基差、流動性與資金費率風險。",
            },
          ],
          timestamp: new Date(signal.timestamp).toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
    },
    fetcher,
  );
}

/**
 * Send a periodic scanner brief even when no trade-quality signal is present.
 */
export async function sendMarketBrief(
  webhookUrl: string,
  result: ScanResult,
  timestamp: Date,
  fetcher: typeof fetch = fetch,
  chart?: ChartAttachment,
  language: Language = "zh",
): Promise<void> {
  const english = language === "en";
  const chartMetadata =
    chart === undefined
      ? {}
      : {
          attachments: [
            {
              id: 0,
              filename: chart.filename,
              description:
                english
                  ? "SP500 session candles with VWAP, latest price, and signal reference levels"
                  : "含 VWAP、最新價格與訊號參考位的 SP500 交易時段 K 線圖",
            },
          ],
        };
  const fields = [
    {
      name: english ? "Status" : "狀態",
      value: localizeDiagnostic(result.status, language),
      inline: false,
    },
    {
      name: english ? "Latest price" : "最新價格",
      value: formatNullableNumber(result.latestPrice),
      inline: true,
    },
    {
      name: english ? "Observed high / low" : "觀察高 / 低",
      value: `${formatNullableNumber(result.sessionHigh)} / ${formatNullableNumber(result.sessionLow)}`,
      inline: true,
    },
    {
      name: english ? "Completed candles" : "完成 K 線數",
      value: String(result.candleCount),
      inline: true,
    },
  ];
  const opportunity = result.signal ?? result.watch;
  if (opportunity !== null) {
    fields.push({
      name: english ? "Opportunity detected" : "同時偵測到機會",
      value: `${opportunity.level.toUpperCase()} · ${formatDirection(opportunity.direction, language)} ${opportunity.price.toFixed(1)} · ${opportunity.confidenceScore}/100 · ${opportunity.priceRiskReward.toFixed(1)}R`,
      inline: false,
    });
  }
  await sendWebhook(
    webhookUrl,
    {
      content: buildMarketBriefNotificationSummary(result, language),
      embeds: [
        {
          title: english
            ? "SP500 Reversal Scanner 30-Minute Brief"
            : "SP500 反轉掃描半小時簡報",
          description: buildMarketBriefDescription(result, language),
          color: result.signal !== null ? 0xf1c40f : result.watch !== null ? 0x95a5a6 : 0x3498db,
          fields,
          image:
            chart === undefined
              ? undefined
              : {
                  url: `attachment://${chart.filename}`,
                },
          timestamp: timestamp.toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
      ...chartMetadata,
    },
    fetcher,
    chart,
  );
}

/**
 * Send a one-line deployment/version notice to Discord.
 */
export async function sendVersionNotice(
  webhookUrl: string,
  version: string,
  timestamp: Date,
  fetcher: typeof fetch = fetch,
  language: Language = "zh",
): Promise<void> {
  const english = language === "en";
  await sendWebhook(
    webhookUrl,
    {
      embeds: [
        {
          title: english
            ? "Hyperliquid SP500 Reversal Scanner updated"
            : "Hyperliquid SP500 反轉掃描器已更新",
          description: buildVersionNoticeDescription(
            version,
            timestamp,
            language,
          ),
          color: 0x9b59b6,
          fields: [
            {
              name: english ? "Reminder" : "使用提醒",
              value:
                english
                  ? "A version notice only confirms that new code reached the Worker execution path. Use scanner briefs and alerts to determine whether a candidate zone exists."
                  : "版本通知只代表新程式已在 Worker 執行路徑中出現；是否有交易候選區仍以掃描簡報與 ALERT 為準。",
            },
          ],
          timestamp: timestamp.toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
    },
    fetcher,
  );
}

/**
 * Format a sanitized result for the Worker's manual status endpoint.
 */
export function publicScanResult(
  result: ScanResult,
  language: Language = "zh",
): object {
  return {
    market: result.market,
    candleCount: result.candleCount,
    sessionHigh: result.sessionHigh,
    sessionLow: result.sessionLow,
    latestPrice: result.latestPrice,
    status: localizeDiagnostic(result.status, language),
    watch:
      result.watch === null
        ? null
        : publicOpportunity(result.watch, language),
    signal:
      result.signal === null
        ? null
        : publicOpportunity(result.signal, language),
  };
}

function publicOpportunity(
  signal: ReversalLocation,
  language: Language,
): object {
  return {
    level: signal.level,
    direction: signal.direction,
    price: signal.price,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    invalidation: signal.invalidation,
    target: signal.target,
    priceRiskReward: signal.priceRiskReward,
    confidenceScore: signal.confidenceScore,
    timestamp: signal.timestamp,
    policy: {
      ...signal.policy,
      reasons: signal.policy.reasons.map((reason) =>
        localizeDiagnostic(reason, language)
      ),
    },
  };
}

async function sendWebhook(
  webhookUrl: string,
  payload: object,
  fetcher: typeof fetch,
  attachment?: ChartAttachment,
): Promise<void> {
  const requestInit =
    attachment === undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : discordMultipartRequest(payload, attachment);
  const response = await fetcher(webhookUrl, {
    ...requestInit,
  });
  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
  }
}

function discordMultipartRequest(
  payload: object,
  attachment: ChartAttachment,
): RequestInit {
  const form = new FormData();
  const fileBytes = new ArrayBuffer(attachment.bytes.byteLength);
  new Uint8Array(fileBytes).set(attachment.bytes);
  form.append("payload_json", JSON.stringify(payload));
  form.append(
    "files[0]",
    new Blob([fileBytes], {
      type: attachment.contentType,
    }),
    attachment.filename,
  );
  return {
    method: "POST",
    body: form,
  };
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(1);
}

function formatDirection(
  direction: ReversalLocation["direction"],
  language: Language,
): string {
  if (language === "en") {
    return direction.toUpperCase();
  }
  return direction === "bullish" ? "多頭" : "空頭";
}

function formatPolicyRole(
  role: ReversalLocation["policy"]["role"],
  language: Language,
): string {
  if (language === "zh") {
    return role === "bullish_reversal_zone"
      ? "多頭反轉區"
      : "空頭崩跌監測";
  }
  return role === "bullish_reversal_zone"
    ? "bullish reversal zone"
    : "bearish crash monitor";
}

function buildMarketBriefDescription(
  result: ScanResult,
  language: Language,
): string {
  const english = language === "en";
  const opportunity = result.signal ?? result.watch;
  const signalSummary =
    opportunity === null
      ? english
        ? "No qualified signal"
        : "暫無合格訊號"
      : `${opportunity.level.toUpperCase()} ${formatDirection(opportunity.direction, language)} ${opportunity.price.toFixed(1)} · ${opportunity.confidenceScore}/100 · ${opportunity.priceRiskReward.toFixed(1)}R`;

  if (english) {
    return [
      `${result.market} latest ${formatNullableNumber(result.latestPrice)}; session range ${formatNullableNumber(result.sessionLow)}–${formatNullableNumber(result.sessionHigh)}.`,
      `${signalSummary}; analyzed ${result.candleCount} completed 5m candles.`,
      `Status: ${localizeDiagnostic(result.status, language)}`,
    ].join("\n");
  }

  return [
    `${result.market} 最新 ${formatNullableNumber(result.latestPrice)}；日內區間 ${formatNullableNumber(result.sessionLow)}–${formatNullableNumber(result.sessionHigh)}。`,
    `${signalSummary}；已分析 ${result.candleCount} 根完成 5m K。`,
    `狀態：${localizeDiagnostic(result.status, language)}`,
  ].join("\n");
}

function buildMarketBriefNotificationSummary(
  result: ScanResult,
  language: Language,
): string {
  const english = language === "en";
  const opportunity = result.signal ?? result.watch;
  const signalSummary =
    opportunity === null
      ? english
        ? "No qualified signal"
        : "暫無合格訊號"
      : `${opportunity.level.toUpperCase()} ${formatDirection(opportunity.direction, language)} ${opportunity.price.toFixed(1)} · ${opportunity.confidenceScore}/100 · ${opportunity.priceRiskReward.toFixed(1)}R`;

  if (english) {
    return [
      "SP500 30-minute brief",
      `Latest ${formatNullableNumber(result.latestPrice)}`,
      `Session ${formatNullableNumber(result.sessionLow)}–${formatNullableNumber(result.sessionHigh)}`,
      signalSummary,
      shortNotificationStatus(localizeDiagnostic(result.status, language)),
    ].join(" | ");
  }

  return [
    "SP500 半小時簡報",
    `最新 ${formatNullableNumber(result.latestPrice)}`,
    `日內 ${formatNullableNumber(result.sessionLow)}–${formatNullableNumber(result.sessionHigh)}`,
    signalSummary,
    shortNotificationStatus(localizeDiagnostic(result.status, language)),
  ].join(" | ");
}

function shortNotificationStatus(status: string): string {
  const compactStatus = status.replace(/\s+/g, " ").trim();
  return compactStatus.length <= 120
    ? compactStatus
    : `${compactStatus.slice(0, 117)}...`;
}

function buildVersionNoticeDescription(
  version: string,
  timestamp: Date,
  language: Language,
): string {
  if (language === "en") {
    return [
      `Worker version \`${version}\` is active.`,
      `Effective time: ${timestamp.toISOString()}`,
    ].join("\n");
  }
  return [
    `Worker 版本 \`${version}\` 已啟用。`,
    `生效時間：${timestamp.toISOString()}`,
  ].join("\n");
}
