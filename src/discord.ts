import type { ChartAttachment } from "./chart";
import type { ReversalLocation, ScanResult } from "./types";

/**
 * Send one qualified price-location alert to Discord.
 */
export async function sendSignal(
  webhookUrl: string,
  signal: ReversalLocation,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const bullish = signal.direction === "bullish";
  const alertLevel = signal.level === "alert";
  const policyDescription = signal.policy.role === "bullish_reversal_zone"
    ? "Bullish-first reversal-zone policy：主要尋找現代 regime 下的日內低點反轉區。"
    : "Bearish crash-monitor policy：只在較嚴格的 stress regime 保留高點反轉警示。";
  await sendWebhook(
    webhookUrl,
    {
      embeds: [
        {
          title: `${bullish ? "🟢" : "🔴"} SP500 ${alertLevel ? "ALERT" : "WATCH"} · ${bullish ? "低點" : "高點"}凸性候選區`,
          description: alertLevel
            ? `${policyDescription}\n價格位置已達 alert 門檻；仍不含 option book、Greeks、期權成交價或實際期權盈虧估算。`
            : `${policyDescription}\n提早觀察級別：價格位置有反轉雛形，但尚未達嚴格 alert 門檻。`,
          color: alertLevel ? (bullish ? 0x2ecc71 : 0xe74c3c) : 0xf1c40f,
          fields: [
            {
              name: "級別",
              value: signal.level.toUpperCase(),
              inline: true,
            },
            {
              name: "方向 / 市場",
              value: `${signal.direction.toUpperCase()} · ${signal.market}`,
              inline: true,
            },
            {
              name: "訊號價格",
              value: signal.price.toFixed(1),
              inline: true,
            },
            {
              name: "信心分",
              value: `${signal.confidenceScore}/100`,
              inline: true,
            },
            {
              name: "觀察進場區",
              value: `${signal.entryLow.toFixed(1)} – ${signal.entryHigh.toFixed(1)}`,
              inline: true,
            },
            {
              name: "失效點",
              value: signal.invalidation.toFixed(1),
              inline: true,
            },
            {
              name: "第一回歸目標",
              value: signal.target.toFixed(1),
              inline: true,
            },
            {
              name: "標的價格盈虧比",
              value: `${signal.priceRiskReward.toFixed(1)}R`,
              inline: true,
            },
            {
              name: "Policy",
              value: `${signal.policy.name} · ${formatPolicyRole(signal.policy.role)}`,
              inline: true,
            },
            {
              name: "觀察高 / 低 / VWAP",
              value: `${signal.sessionHigh.toFixed(1)} / ${signal.sessionLow.toFixed(1)} / ${signal.vwap.toFixed(1)}`,
              inline: true,
            },
            {
              name: "Regime gate",
              value: signal.policy.reasons.map((reason) => `• ${reason}`).join("\n"),
            },
            {
              name: "成立原因",
              value: signal.reasons.map((reason) => `• ${reason}`).join("\n"),
            },
            {
              name: "風險邊界",
              value:
                "這是價格位置提示，不是期權 8R 保證。Hyperliquid SP500 perpetual 與現貨 SPX 仍可能有基差、流動性與資金費率風險。",
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
): Promise<void> {
  const chartMetadata =
    chart === undefined
      ? {}
      : {
          attachments: [
            {
              id: 0,
              filename: chart.filename,
              description:
                "SP500 session candles with VWAP, latest price, and signal reference levels",
            },
          ],
        };
  const fields = [
    {
      name: "狀態",
      value: result.status,
      inline: false,
    },
    {
      name: "最新價格",
      value: formatNullableNumber(result.latestPrice),
      inline: true,
    },
    {
      name: "觀察高 / 低",
      value: `${formatNullableNumber(result.sessionHigh)} / ${formatNullableNumber(result.sessionLow)}`,
      inline: true,
    },
    {
      name: "完成 K 線數",
      value: String(result.candleCount),
      inline: true,
    },
  ];
  const opportunity = result.signal ?? result.watch;
  if (opportunity !== null) {
    fields.push({
      name: "同時偵測到機會",
      value: `${opportunity.level.toUpperCase()} · ${opportunity.direction.toUpperCase()} ${opportunity.price.toFixed(1)} · ${opportunity.confidenceScore}/100 · ${opportunity.priceRiskReward.toFixed(1)}R`,
      inline: false,
    });
  }
  await sendWebhook(
    webhookUrl,
    {
      content: buildMarketBriefNotificationSummary(result),
      embeds: [
        {
          title: "SP500 convexity 半小時簡報",
          description: buildMarketBriefDescription(result),
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
): Promise<void> {
  await sendWebhook(
    webhookUrl,
    {
      embeds: [
        {
          title: "Hyperliquid SP500 Reversal Scanner code updated",
          description: buildVersionNoticeDescription(version, timestamp),
          color: 0x9b59b6,
          fields: [
            {
              name: "使用提醒",
              value:
                "版本通知只代表新程式已在 Worker 執行路徑中出現；是否有交易候選區仍以掃描簡報與 alert 為準。",
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
export function publicScanResult(result: ScanResult): object {
  return {
    market: result.market,
    candleCount: result.candleCount,
    sessionHigh: result.sessionHigh,
    sessionLow: result.sessionLow,
    latestPrice: result.latestPrice,
    status: result.status,
    watch:
      result.watch === null
        ? null
        : publicOpportunity(result.watch),
    signal:
      result.signal === null
        ? null
        : publicOpportunity(result.signal),
  };
}

function publicOpportunity(signal: ReversalLocation): object {
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
    policy: signal.policy,
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

function formatPolicyRole(role: ReversalLocation["policy"]["role"]): string {
  return role === "bullish_reversal_zone"
    ? "bullish reversal zone"
    : "bearish crash monitor";
}

function buildMarketBriefDescription(result: ScanResult): string {
  const opportunity = result.signal ?? result.watch;
  const signalSummary =
    opportunity === null
      ? "暫無合格訊號"
      : `${opportunity.level.toUpperCase()} ${opportunity.direction.toUpperCase()} ${opportunity.price.toFixed(1)} · ${opportunity.confidenceScore}/100 · ${opportunity.priceRiskReward.toFixed(1)}R`;

  return [
    `${result.market} 最新 ${formatNullableNumber(result.latestPrice)}；日內區間 ${formatNullableNumber(result.sessionLow)}–${formatNullableNumber(result.sessionHigh)}。`,
    `${signalSummary}；已分析 ${result.candleCount} 根完成 5m K。`,
    `狀態：${result.status}`,
  ].join("\n");
}

function buildMarketBriefNotificationSummary(result: ScanResult): string {
  const opportunity = result.signal ?? result.watch;
  const signalSummary =
    opportunity === null
      ? "暫無合格訊號"
      : `${opportunity.level.toUpperCase()} ${opportunity.direction.toUpperCase()} ${opportunity.price.toFixed(1)} · ${opportunity.confidenceScore}/100 · ${opportunity.priceRiskReward.toFixed(1)}R`;

  return [
    "SP500 半小時簡報",
    `最新 ${formatNullableNumber(result.latestPrice)}`,
    `日內 ${formatNullableNumber(result.sessionLow)}–${formatNullableNumber(result.sessionHigh)}`,
    signalSummary,
    shortNotificationStatus(result.status),
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
): string {
  return [
    `Worker 版本 \`${version}\` 已啟用。`,
    `生效時間：${timestamp.toISOString()}`,
  ].join("\n");
}
