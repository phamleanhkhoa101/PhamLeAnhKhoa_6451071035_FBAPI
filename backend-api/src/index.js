import express from "express";
import dotenv from "dotenv";
import { createConsumer, createProducer, publishMessage } from "./kafka.js";
import { TOPICS } from "./topics.js";
import {
  initDb,
  hasProcessedCommand,
  saveIdempotencyKey
} from "./database.js";
import { facebookGet, facebookPost } from "./facebook.js";
import { circuitBreaker } from "./circuitBreaker.js";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;

let producer;

async function handleCommand(command) {
  const exists = await hasProcessedCommand(command.command_id);

  if (exists) {
    console.log("Duplicate command skipped:", command.command_id);
    return;
  }

  try {
    if (command.action === "reply") {
      await facebookPost(`${command.target.comment_id}/comments`, {
        message: command.reply_text
      });
    }

    if (command.action === "hide_comment") {
      await facebookPost(`${command.target.comment_id}`, {
        is_hidden: true
      });
    }

    if (command.action === "pending_review") {
      console.log("Command moved to pending review:", command.command_id);
    }

    await saveIdempotencyKey(command.command_id, "success");

    console.log("Command processed:", command.command_id);
  } catch (error) {
    console.error("Facebook send failed:", error.message);

    const failedMessage = {
      schema_version: 1,
      command_id: command.command_id,
      event_id: command.event_id,
      retry_count: command.retry_count || 0,
      last_error: error.message,
      failed_at: new Date().toISOString(),
      payload: command
    };

    await publishMessage(producer, TOPICS.SEND_FAILED, failedMessage);
  }
}

app.get("/health", (req, res) => {
  res.json({
    service: "backend-api",
    status: "ok",
    circuit_breaker: circuitBreaker
  });
});

app.get("/posts", async (req, res) => {
  try {
    const data = await facebookGet(`${PAGE_ID}/posts`, {
      fields: "id,message,created_time"
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/post", async (req, res) => {
  try {
    const { message } = req.body;

    const data = await facebookPost(`${PAGE_ID}/feed`, {
      message
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/comments", async (req, res) => {
  try {
    const { post_id } = req.query;

    if (!post_id) {
      return res.status(400).json({
        success: false,
        message: "post_id is required"
      });
    }

    const data = await facebookGet(`${post_id}/comments`, {
      fields: "id,message,from,created_time"
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

async function startConsumers() {
  const consumer = await createConsumer("backend-api-group");

  await consumer.subscribe({
    topic: TOPICS.REPLY_COMMANDS,
    fromBeginning: false
  });

  await consumer.subscribe({
    topic: TOPICS.SEND_RETRY,
    fromBeginning: false
  });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const data = JSON.parse(message.value.toString());

      const command =
        topic === TOPICS.SEND_RETRY
          ? {
              ...data.payload,
              retry_count: data.retry_count
            }
          : data;

      await handleCommand(command);
    }
  });
}

async function start() {
  try {
    console.log("Starting backend-api...");

    await initDb();
    console.log("Database initialized");

    producer = await createProducer();
    console.log("Kafka producer connected");

    await startConsumers();
    console.log("Kafka consumers started");

    app.listen(PORT, () => {
      console.log(`backend-api running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start backend-api:", error);
    process.exit(1);
  }
}

start();