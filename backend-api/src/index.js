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