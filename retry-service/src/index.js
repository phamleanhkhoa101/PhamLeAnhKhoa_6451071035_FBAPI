import express from "express";
import dotenv from "dotenv";
import {
  createConsumer,
  createProducer,
  publishMessage
} from "./kafka.js";
import { TOPICS } from "./topics.js";
import { getBackoffMs, shouldRetry, sleep } from "./retryPolicy.js";
import {
  initDb,
  updateCommentStatus,
  appendCommentStatusHistory
} from "./database.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;
const MAX_RETRY = Number(process.env.MAX_RETRY || 3);

let producer;

async function moveToDeadLetter(message, reason) {
  const retryCount = message.retry_count || 0;

  const deadLetterMessage = {
    schema_version: 1,
    command_id: message.command_id,
    event_id: message.event_id,
    retry_count: retryCount,
    failed_at: new Date().toISOString(),
    final_error: message.last_error,
    original_topic: TOPICS.SEND_FAILED,
    failure_reason: reason,
    payload: message.payload
  };

  await publishMessage(producer, TOPICS.DEAD_LETTER, deadLetterMessage);
  await updateCommentStatus(message.event_id, "dead_letter", {
    currentAction: message.payload?.action || null,
    commandId: message.command_id,
    retryCount,
    errorMessage: message.last_error,
    reviewReason: message.payload?.review_reason || reason,
    riskLevel: message.payload?.risk_level || "high"
  });
  await appendCommentStatusHistory({
    eventId: message.event_id,
    status: "dead_letter",
    sourceService: "retry-service",
    commandId: message.command_id,
    retryCount,
    note: `${reason}; action=${message.payload?.action || "unknown"}; error_class=${message.error_class || "unknown"}; moderation_reason=${message.payload?.review_reason || "none"}`,
    errorMessage: message.last_error
  });

  console.log("Moved to dead_letter:", message.command_id, `reason=${reason}`);
}

async function handleFailedMessage(message) {
  const retryCount = message.retry_count || 0;
  const isRetryable = message.retryable !== false;

  if (!isRetryable) {
    await moveToDeadLetter(message, "non_retryable_error");
    return;
  }

  if (!shouldRetry(retryCount, MAX_RETRY)) {
    await moveToDeadLetter(message, "max_retry_exceeded");
    return;
  }

  const backoffMs = getBackoffMs(retryCount);
  const nextRetryCount = retryCount + 1;

  await updateCommentStatus(message.event_id, "failed", {
    currentAction: message.payload?.action || null,
    commandId: message.command_id,
    retryCount: nextRetryCount,
    errorMessage: message.last_error,
    reviewReason: message.payload?.review_reason || null,
    riskLevel: message.payload?.risk_level || "high"
  });
  await appendCommentStatusHistory({
    eventId: message.event_id,
    status: "failed",
    sourceService: "retry-service",
    commandId: message.command_id,
    retryCount: nextRetryCount,
    note: `retry_scheduled_after_${backoffMs}ms; action=${message.payload?.action || "unknown"}; error_class=${message.error_class || "unknown"}; moderation_reason=${message.payload?.review_reason || "none"}`,
    errorMessage: message.last_error
  });

  await sleep(backoffMs);

  const retryMessage = {
    ...message,
    retry_count: nextRetryCount,
    next_retry_at: new Date(Date.now() + backoffMs).toISOString()
  };

  await publishMessage(producer, TOPICS.SEND_RETRY, retryMessage);

  console.log("Published to send_retry:", message.command_id);
}

async function startConsumer() {
  producer = await createProducer();

  const consumer = await createConsumer("retry-service-group");

  await consumer.subscribe({
    topic: TOPICS.SEND_FAILED,
    fromBeginning: false
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const failedMessage = JSON.parse(message.value.toString());

      await handleFailedMessage(failedMessage);
    }
  });
}

app.get("/health", (req, res) => {
  res.json({
    service: "retry-service",
    status: "ok",
    max_retry: MAX_RETRY
  });
});

async function start() {
  await initDb();

  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`retry-service running on port ${PORT}`);
      resolve(server);
    });

    server.on("error", reject);
  });

  await startConsumer();
}

start();
