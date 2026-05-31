import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  canCallAi,
  recordAiSuccess,
  recordAiFailure
} from "./aiCircuitBreaker.js";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

function buildAiResult(
  intent,
  sentiment,
  {
    aiSource = "unknown",
    aiAttempted = false
  } = {}
) {
  return {
    intent,
    sentiment,
    ai_source: aiSource,
    ai_attempted: aiAttempted
  };
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeForRuleMatching(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D");
}

function stripCodeFences(text) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObject(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response does not contain a JSON object");
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function safeParseAiResult(rawText) {
  const cleaned = stripCodeFences(rawText);
  const jsonLike = extractJsonObject(cleaned);
  const parsed = JSON.parse(jsonLike);

  return buildAiResult(
    parsed.intent || "unknown",
    parsed.sentiment || "neutral",
    {
      aiSource: "gemini",
      aiAttempted: true
    }
  );
}

function heuristicFallback(message, aiSource = "heuristic_fallback") {
  const lower = normalizeForRuleMatching(message);

  if (!lower) {
    return buildAiResult("unknown", "neutral", {
      aiSource,
      aiAttempted: false
    });
  }

  if (
    /(gia bao nhieu|xin gia|gia sao|bao gia|gia san pham|cho xin gia)/.test(lower)
  ) {
    return buildAiResult("ask_price", "neutral", {
      aiSource,
      aiAttempted: false
    });
  }

  if (
    /(chua nhan duoc hang|cham giao|khieu nai|loi san pham|that vong|te qua|khong hai long)/.test(lower)
  ) {
    return buildAiResult("complaint", "negative", {
      aiSource,
      aiAttempted: false
    });
  }

  if (
    /(hay qua|rat tot|tuyet voi|ung ho shop|dep qua|ok lam|tot qua|xinh qua|bai viet hay qua|san pham dep qua)/.test(lower)
  ) {
    return buildAiResult("positive_feedback", "positive", {
      aiSource,
      aiAttempted: false
    });
  }

  if (
    /(http:\/\/|https:\/\/|bit\.ly|tinyurl\.com|t\.me\/|wa\.me\/)/.test(lower)
  ) {
    return buildAiResult("spam", "negative", {
      aiSource,
      aiAttempted: false
    });
  }

  return buildAiResult("general_question", "neutral", {
    aiSource,
    aiAttempted: false
  });
}

function shouldPreferHeuristic(aiResult, heuristicResult) {
  if (!heuristicResult) {
    return false;
  }

  if (
    heuristicResult.intent === "positive_feedback" &&
    aiResult.intent === "general_question" &&
    aiResult.sentiment === "neutral"
  ) {
    return true;
  }

  if (
    heuristicResult.intent === "ask_price" &&
    aiResult.intent === "general_question"
  ) {
    return true;
  }

  if (
    heuristicResult.intent === "complaint" &&
    aiResult.sentiment === "neutral"
  ) {
    return true;
  }

  if (
    heuristicResult.intent === "spam" &&
    aiResult.intent === "general_question"
  ) {
    return true;
  }

  return false;
}

export function detectSpam(message) {
  const lower = normalizeForRuleMatching(message);

  const hasLink = lower.includes("http://") || lower.includes("https://");
  const repeatedChars = /(.)\1{8,}/.test(lower);

  return hasLink || repeatedChars;
}

export async function analyzeMessage(message) {
  const normalizedMessage = normalizeText(message);
  const heuristicResult = heuristicFallback(
    normalizedMessage,
    "heuristic_fallback_rule"
  );

  if (!normalizedMessage) {
    return buildAiResult("unknown", "neutral", {
      aiSource: "empty_message",
      aiAttempted: false
    });
  }

  if (!canCallAi()) {
    console.warn("AI circuit breaker is open, using heuristic fallback");
    return {
      ...heuristicResult,
      ai_source: "heuristic_fallback_circuit_open",
      ai_attempted: false
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
Ban la AI phan tich binh luan Facebook Page.

Hay phan tich binh luan sau:
"${normalizedMessage}"

Chi tra ve JSON hop le duy nhat theo schema:
{
  "intent": "ask_price | complaint | spam | positive_feedback | general_question | unknown",
  "sentiment": "positive | neutral | negative"
}
      `.trim()
    });

    const content = response.text || "";
    const parsed = safeParseAiResult(content);

    recordAiSuccess();

    if (shouldPreferHeuristic(parsed, heuristicResult)) {
      return {
        ...heuristicResult,
        ai_source: "heuristic_override",
        ai_attempted: true
      };
    }

    return parsed;
  } catch (error) {
    recordAiFailure();
    console.error("Gemini AI error:", error.message);
    return {
      ...heuristicResult,
      ai_source: "heuristic_fallback_error",
      ai_attempted: true
    };
  }
}
