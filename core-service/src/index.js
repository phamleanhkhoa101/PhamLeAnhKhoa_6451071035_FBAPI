import express from "express";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import {
  createConsumer,
  createProducer,
  publishMessage
} from "./kafka.js";
import { TOPICS } from "./topics.js";
import { detectSpam, analyzeMessage } from "./aiService.js";
import { decideAction } from "./automationRules.js";
import {
  initDb,
  tryStartEventProcessing,
  markEventStatus,
  markEventFailed,
  saveComment,
  updateCommentStatus,
  appendCommentStatusHistory,
  isUserBlacklisted,
  blacklistUser,
  countRecentCommentsByUser,
  countRecentSpamEventsByUser,
  countDuplicateRecentMessagesByUser,
  countRecentLowValueCommentsByUser
} from "./database.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

const RATE_LIMIT_MAX_COMMENTS_PER_MINUTE = Number(
  process.env.RATE_LIMIT_MAX_COMMENTS_PER_MINUTE || 20
);
const SPAM_STRIKE_THRESHOLD = Number(
  process.env.SPAM_STRIKE_THRESHOLD || 3
);
const SPAM_LOOKBACK_HOURS = Number(
  process.env.SPAM_LOOKBACK_HOURS || 24
);

let producer;

function normalizeMessage(message) {
  if (typeof message !== "string") {
    return "";
  }

  return message.trim();
}

function detectHighRiskContent(message) {
  const lower = message.toLowerCase();

  const patterns = [
    {
      regex: /(bit\.ly|tinyurl\.com|t\.me\/|wa\.me\/|zalo\.me)/,
      reason: "suspicious_link_shortener"
    },
    {
      regex: /(chuyen khoan ngay|nap tien ngay|lien he telegram|inbox zalo de nhan uu dai)/,
      reason: "possible_scam_phrase"
    },
    {
      regex: /(crypto giveaway|free btc|airdrop mien phi|kiem tien online)/,
      reason: "crypto_or_money_scam"
    }
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(lower)) {
      return {
        isHighRisk: true,
        reason: pattern.reason
      };
    }
  }

  return {
    isHighRisk: false,
    reason: null
  };
}

function isLowValueMessage(message) {
  const normalized = normalizeMessage(message);

  if (!normalized) {
    return true;
  }

  return normalized.length <= 2;
}

function buildBypassAiResult(context) {
  if (context.isBlacklisted) {
    return {
      intent: "blacklisted",
      sentiment: "negative"
    };
  }

  if (context.isRateLimited) {
    return {
      intent: "rate_limited",
      sentiment: "neutral"
    };
  }

  return {
    intent: "spam",
    sentiment: "negative"
  };
}

async function processEvent(event) {
  const lockResult = await tryStartEventProcessing(event);

  if (!lockResult.started) {
    console.log(
      "Duplicate event skipped:",
      event.event_id,
      `status=${lockResult.status}`
    );
    return;
  }

  const normalizedEvent = {
    ...event,
    message: normalizeMessage(event.message)
  };

  try {
    await saveComment(
      normalizedEvent,
      {
        intent: "unknown",
        sentiment: "neutral"
      },
      "received",
      {
        riskLevel: "low",
        reviewReason: null
      }
    );
    await appendCommentStatusHistory({
      eventId: normalizedEvent.event_id,
      status: "received",
      sourceService: "core-service",
      note: "raw_event_consumed"
    });

    await updateCommentStatus(normalizedEvent.event_id, "processing", {
      riskLevel: "low",
      reviewReason: null
    });
    await appendCommentStatusHistory({
      eventId: normalizedEvent.event_id,
      status: "processing",
      sourceService: "core-service",
      note: "core_service_started"
    });

    const blacklisted = await isUserBlacklisted(normalizedEvent.user_id);
    const recentCommentCount = await countRecentCommentsByUser(
      normalizedEvent.user_id,
      60
    );
    const isRateLimited =
      recentCommentCount > RATE_LIMIT_MAX_COMMENTS_PER_MINUTE;

    const highRisk = detectHighRiskContent(normalizedEvent.message);
    const directSpam = detectSpam(normalizedEvent.message);

    const duplicateMessageCount = await countDuplicateRecentMessagesByUser(
      normalizedEvent.user_id,
      normalizedEvent.message,
      10
    );

    const lowValueCommentCount = await countRecentLowValueCommentsByUser(
      normalizedEvent.user_id,
      5,
      2
    );

    const repeatedSpam = duplicateMessageCount >= 3;
    const lowValueSpam =
      isLowValueMessage(normalizedEvent.message) && lowValueCommentCount >= 5;

    const isSpam = directSpam || repeatedSpam || lowValueSpam;

    const historicalSpamCount = await countRecentSpamEventsByUser(
      normalizedEvent.user_id,
      SPAM_LOOKBACK_HOURS
    );

    const spamStrikeCount =
      historicalSpamCount + (isSpam || highRisk.isHighRisk ? 1 : 0);

    const moderationContext = {
      isBlacklisted: blacklisted,
      isRateLimited,
      isHighRisk: highRisk.isHighRisk,
      highRiskReason: highRisk.reason,
      isSpam,
      spamStrikeCount,
      spamThreshold: SPAM_STRIKE_THRESHOLD
    };

    const shouldSkipAi =
      moderationContext.isBlacklisted ||
      moderationContext.isRateLimited ||
      moderationContext.isHighRisk ||
      moderationContext.isSpam;

    const aiResult = shouldSkipAi
      ? buildBypassAiResult(moderationContext)
      : await analyzeMessage(normalizedEvent.message);

    const decision = decideAction(
      normalizedEvent,
      aiResult,
      moderationContext
    );

    if (decision.blacklistUser && normalizedEvent.user_id) {
      await blacklistUser(
        normalizedEvent.user_id,
        decision.blacklistReason || decision.review_reason || "policy_violation"
      );
    }

    const command = {
      schema_version: 1,
      command_id: `cmd_${uuidv4()}`,
      event_id: normalizedEvent.event_id,
      action: decision.action,
      target: {
        page_id: normalizedEvent.page_id,
        post_id: normalizedEvent.post_id,
        comment_id: normalizedEvent.comment_id,
        user_id: normalizedEvent.user_id
      },
      reply_text: decision.reply_text,
      intent: aiResult.intent,
      sentiment: aiResult.sentiment,
      review_reason: decision.review_reason,
      risk_level: decision.risk_level,
      created_at: new Date().toISOString()
    };

    const coreTrackingStatus =
      decision.action === "pending_review" ? "pending_review" : "processed";

    await saveComment(normalizedEvent, aiResult, coreTrackingStatus, {
      riskLevel: decision.risk_level,
      reviewReason: decision.review_reason,
      currentAction: decision.action,
      commandId: command.command_id,
      retryCount: 0,
      errorMessage: null
    });
    await appendCommentStatusHistory({
      eventId: normalizedEvent.event_id,
      status: coreTrackingStatus,
      sourceService: "core-service",
      commandId: command.command_id,
      note: `action=${decision.action}; reason=${decision.review_reason || "none"}; risk=${decision.risk_level || "low"}`
    });

    await publishMessage(producer, TOPICS.REPLY_COMMANDS, command);
    await markEventStatus(normalizedEvent.event_id, coreTrackingStatus, {
      commandId: command.command_id
    });

    console.log("Command published:", command.command_id);
  } catch (error) {
    await markEventFailed(normalizedEvent.event_id, error.message);
    await updateCommentStatus(normalizedEvent.event_id, "failed", {
      riskLevel: "high",
      reviewReason: "core_service_error",
      errorMessage: error.message
    });
    await appendCommentStatusHistory({
      eventId: normalizedEvent.event_id,
      status: "failed",
      sourceService: "core-service",
      errorMessage: error.message,
      note: "core_service_exception"
    });
    throw error;
  }
}

async function startConsumer() {
  producer = await createProducer();

  const consumer = await createConsumer("core-service-group");

  await consumer.subscribe({
    topic: TOPICS.RAW_EVENTS,
    fromBeginning: false
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value.toString());

      console.log("Received raw event:", event.event_id);

      await processEvent(event);
    }
  });
}

app.get("/health", (req, res) => {
  res.json({
    service: "core-service",
    status: "ok",
    rate_limit_max_comments_per_minute: RATE_LIMIT_MAX_COMMENTS_PER_MINUTE,
    spam_strike_threshold: SPAM_STRIKE_THRESHOLD
  });
});

async function start() {
  await initDb();
  await startConsumer();

  app.listen(PORT, () => {
    console.log(`core-service running on http://localhost:${PORT}`);
  });
}

start();
