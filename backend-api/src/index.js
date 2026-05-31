//cấu hình swagger
import swaggerUi from "swagger-ui-express";
import yaml from "yamljs";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import dotenv from "dotenv";
import { createConsumer, createProducer, publishMessage } from "./kafka.js";
import { TOPICS } from "./topics.js";
import {
  initDb,
  hasProcessedCommand,
  saveIdempotencyKey,
  updateCommentStatus,
  appendCommentStatusHistory
} from "./database.js";
import { facebookGet, facebookPost } from "./facebook.js";
import { circuitBreaker } from "./circuitBreaker.js";
import { requireAdmin } from "./auth.js";
import { successResponse, errorResponse } from "./respone.js";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;

// Cấu hình swagger
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const swaggerDocument = yaml.load(path.join(__dirname, "swagger.yaml"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

let producer;

async function handleCommand(command) {
  const retryCount = command.retry_count || 0;

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

      await updateCommentStatus(command.event_id, "replied", {
        currentAction: command.action,
        commandId: command.command_id,
        retryCount,
        reviewReason: command.review_reason || null,
        riskLevel: command.risk_level || null,
        errorMessage: null
      });
      await appendCommentStatusHistory({
        eventId: command.event_id,
        status: "replied",
        sourceService: "backend-api",
        commandId: command.command_id,
        retryCount,
        note: `facebook_reply_sent; moderation_reason=${command.review_reason || "none"}`
      });
    }

    if (command.action === "hide_comment") {
      await facebookPost(`${command.target.comment_id}`, {
        is_hidden: true
      });

      await updateCommentStatus(command.event_id, "hidden", {
        currentAction: command.action,
        commandId: command.command_id,
        retryCount,
        reviewReason: command.review_reason || null,
        riskLevel: command.risk_level || null,
        errorMessage: null
      });
      await appendCommentStatusHistory({
        eventId: command.event_id,
        status: "hidden",
        sourceService: "backend-api",
        commandId: command.command_id,
        retryCount,
        note: `facebook_comment_hidden; moderation_reason=${command.review_reason || "none"}`
      });
    }

    if (command.action === "pending_review") {
      await updateCommentStatus(command.event_id, "pending_review", {
        currentAction: command.action,
        commandId: command.command_id,
        retryCount,
        reviewReason: command.review_reason || null,
        riskLevel: command.risk_level || null,
        errorMessage: null
      });
      await appendCommentStatusHistory({
        eventId: command.event_id,
        status: "pending_review",
        sourceService: "backend-api",
        commandId: command.command_id,
        retryCount,
        note: `manual_review_queue_no_facebook_call; moderation_reason=${command.review_reason || "none"}`
      });
      console.log("Command moved to pending review:", command.command_id);
    }

    await saveIdempotencyKey(command.command_id, "success");

    console.log("Command processed:", command.command_id);
  } catch (error) {
    console.error("Facebook send failed:", error.message);

    await updateCommentStatus(command.event_id, "failed", {
      currentAction: command.action,
      commandId: command.command_id,
      retryCount,
      reviewReason: command.review_reason || null,
      riskLevel: command.risk_level || null,
      errorMessage: error.message
    });
    await appendCommentStatusHistory({
      eventId: command.event_id,
      status: "failed",
      sourceService: "backend-api",
      commandId: command.command_id,
      retryCount,
      note: `facebook_api_failed:${command.action}; moderation_reason=${command.review_reason || "none"}`,
      errorMessage: error.message
    });

    const failedMessage = {
      schema_version: 1,
      command_id: command.command_id,
      event_id: command.event_id,
      retry_count: retryCount,
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

    return successResponse(res, data, "Posts fetched successfully")
  } catch (error) {
    return errorResponse(
      res,
      error.status || 500,
      error.code || "GET_POSTS_FAILED",
      error.message || "Can't fetch posts"
    )
  }
});

app.post("/post", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return errorResponse(
        res,
        400,
        "MISSING_MESSAGE",
        "Message is required"
      );
    }

    const data = await facebookPost(`${PAGE_ID}/feed`, {
      message
    });

    return successResponse(res, data, "Post created successfully");
  } catch (error) {
    return errorResponse(
      res,
      error.status || 500,
      error.code || "CREATE_POST_FAILED",
      error.message || "Cannot create Facebook post"
    );
  }
});

app.get("/comments", async (req, res) => {
  try {
    const { post_id } = req.query;

    if (!post_id) {
      return errorResponse(
        res,
        400,
        "MISSING_POST_ID",
        "post_id is required"
      );
    }

    const data = await facebookGet(`${post_id}/comments`, {
      fields: "id,message,from,created_time"
    });

    return successResponse(res, data, "Comments fetched successfully");
  } catch (error) {
    return errorResponse(
      res,
      error.status || 500,
      error.code || "GET_COMMENTS_FAILED",
      error.message || "Cannot fetch comments"
    );
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

    await new Promise((resolve, reject) => {
      const server = app.listen(PORT, () => {
        console.log(`backend-api running on http://localhost:${PORT}`);
        resolve(server);
      });

      server.on("error", reject);
    });

    producer = await createProducer();
    console.log("Kafka producer connected");

    await startConsumers();
    console.log("Kafka consumers started");
  } catch (error) {
    console.error("Failed to start backend-api:", error);
    process.exit(1);
  }
}

start();
