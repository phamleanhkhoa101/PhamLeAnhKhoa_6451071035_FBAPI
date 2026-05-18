import express from "express";
import dotenv from "dotenv";
import { createProducer, publishMessage } from "./kafka.js";
import { TOPICS } from "./topics.js";
import { verifyFacebookSignature } from "./verifySignature.js";
import { normalizeFacebookEvent } from "./normalizeEvent.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

let producer;

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.FACEBOOK_VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const isValid = verifyFacebookSignature(
      req,
      process.env.FACEBOOK_APP_SECRET
    );

    if (!isValid) {
      return res.status(403).json({
        success: false,
        message: "Invalid Facebook signature"
      });
    }

    const event = normalizeFacebookEvent(req.body);

    if (!event) {
      return res.status(200).json({
        success: true,
        message: "No valid event"
      });
    }

    await publishMessage(producer, TOPICS.RAW_EVENTS, event);

    return res.status(200).json({
      success: true,
      message: "Event published to raw_events"
    });
  } catch (error) {
    console.error(error);

    return res.status(200).json({
      success: false,
      message: "Webhook received but processing failed"
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    service: "webhook-service",
    status: "ok"
  });
});

async function start() {
  producer = await createProducer();

  app.listen(PORT, () => {
    console.log(`webhook-service running on port ${PORT}`);
  });
}

start();