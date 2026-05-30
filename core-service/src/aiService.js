import dotenv from "dotenv";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";


dotenv.config();

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY
// });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
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

  return {
    intent: parsed.intent || "unknown",
    sentiment: parsed.sentiment || "neutral"
  };
}

function heuristicFallback(message) {
  const lower = normalizeText(message).toLowerCase();

  if (!lower) {
    return {
      intent: "unknown",
      sentiment: "neutral"
    };
  }

  if (
    /(gia bao nhieu|xin gia|gia sao|bao gia|gia san pham|cho xin gia)/.test(lower)
  ) {
    return {
      intent: "ask_price",
      sentiment: "neutral"
    };
  }

  if (
    /(chua nhan duoc hang|cham giao|khieu nai|loi san pham|that vong|te qua|khong hai long)/.test(lower)
  ) {
    return {
      intent: "complaint",
      sentiment: "negative"
    };
  }

  if (
    /(hay qua|rat tot|tuyet voi|ung ho shop|dep qua|ok lắm|ok lam)/.test(lower)
  ) {
    return {
      intent: "positive_feedback",
      sentiment: "positive"
    };
  }

  if (
    /(http:\/\/|https:\/\/|bit\.ly|tinyurl\.com|t\.me\/|wa\.me\/)/.test(lower)
  ) {
    return {
      intent: "spam",
      sentiment: "negative"
    };
  }

  return {
    intent: "general_question",
    sentiment: "neutral"
  };
}

export function detectSpam(message) {
  const lower = normalizeText(message).toLowerCase();

  const hasLink = lower.includes("http://") || lower.includes("https://");
  const repeatedChars = /(.)\1{8,}/.test(lower);

  return hasLink || repeatedChars;
}

// export async function analyzeMessage(message) {
//   const normalizedMessage = normalizeText(message);

//   if (!normalizedMessage) {
//     return {
//       intent: "unknown",
//       sentiment: "neutral"
//     };
//   }

//   try {
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       temperature: 0.1,
//       response_format: {
//         type: "json_object"
//       },
//       messages: [
//         {
//           role: "system",
//           content:
//             "Ban la AI phan tich binh luan Facebook Page. Hay tra ve JSON hop le duy nhat voi 2 field: intent, sentiment."
//         },
//         {
//           role: "user",
//           content: `
// Phan tich binh luan sau:
// "${normalizedMessage}"

// Chi tra ve JSON voi schema:
// {
//   "intent": "ask_price | complaint | spam | positive_feedback | general_question | unknown",
//   "sentiment": "positive | neutral | negative"
// }
//           `.trim()
//         }
//       ]
//     });

//     const content = response.choices[0]?.message?.content || "";
//     return safeParseAiResult(content);
//   } catch (error) {
//     console.error("OpenAI AI error:", error.message);
//     return heuristicFallback(normalizedMessage);
//   }
// }

export async function analyzeMessage(message) {
  const normalizedMessage = normalizeText(message);

  if (!normalizedMessage) {
    return {
      intent: "unknown",
      sentiment: "neutral"
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
    return safeParseAiResult(content);
  } catch (error) {
    console.error("Gemini AI error:", error.message);
    return heuristicFallback(normalizedMessage);
  }
}