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
import { initDb, saveComment } from "./database.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

let producer;

async function processEvent(event) {
  const isSpam = detectSpam(event.message);

  const aiResult = isSpam
    ? {
        intent: "spam",
        sentiment: "negative"
      }
    : await analyzeMessage(event.message);

  const decision = decideAction(event, aiResult, isSpam);

  await saveComment(event, aiResult, decision.status);

  const command = {
    schema_version: 1,
    command_id: `cmd_${uuidv4()}`,
    event_id: event.event_id,
    action: decision.action,
    target: {
      page_id: event.page_id,
      post_id: event.post_id,
      comment_id: event.comment_id,
      user_id: event.user_id
    },
    reply_text: decision.reply_text,
    intent: aiResult.intent,
    sentiment: aiResult.sentiment,
    created_at: new Date().toISOString()
  };

  await publishMessage(producer, TOPICS.REPLY_COMMANDS, command);

  console.log("Command published:", command.command_id);
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
    status: "ok"
  });
});

async function start() {
  await initDb();
  await startConsumer();

  app.listen(PORT, () => {
    console.log(`core-service running on port ${PORT}`);
  });
}

start();