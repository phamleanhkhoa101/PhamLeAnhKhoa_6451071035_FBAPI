import express from "express";
import dotenv from "dotenv";
import {
  createConsumer,
  createProducer,
  publishMessage
} from "./kafka.js";
import { TOPICS } from "./topics.js";
import { getBackoffMs, shouldRetry, sleep } from "./retryPolicy.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;
const MAX_RETRY = Number(process.env.MAX_RETRY || 3);

let producer;

async function handleFailedMessage(message) {
  const retryCount = message.retry_count || 0;

  if (!shouldRetry(retryCount, MAX_RETRY)) {
    const deadLetterMessage = {
      schema_version: 1,
      command_id: message.command_id,
      event_id: message.event_id,
      retry_count: retryCount,
      failed_at: new Date().toISOString(),
      final_error: message.last_error,
      original_topic: TOPICS.SEND_FAILED,
      payload: message.payload
    };

    await publishMessage(producer, TOPICS.DEAD_LETTER, deadLetterMessage);

    console.log("Moved to dead_letter:", message.command_id);
    return;
  }

  const backoffMs = getBackoffMs(retryCount);

  await sleep(backoffMs);

  const retryMessage = {
    ...message,
    retry_count: retryCount + 1,
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
  await startConsumer();

  app.listen(PORT, () => {
    console.log(`retry-service running on port ${PORT}`);
  });
}

start();