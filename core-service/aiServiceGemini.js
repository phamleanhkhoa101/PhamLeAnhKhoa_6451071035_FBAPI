import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

export function detectSpam(message) {
  const lower = message.toLowerCase();

  const hasLink = lower.includes("http://") || lower.includes("https://");
  const repeatedText = /(.)\1{8,}/.test(lower);

  return hasLink || repeatedText;
}

export async function analyzeMessage(message) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
  });

  const prompt = `
Bạn là AI phân tích bình luận Facebook Page.

Hãy phân tích nội dung sau:
"${message}"

Trả về JSON hợp lệ, không markdown, không giải thích thêm.

Schema:
{
  "intent": "ask_price | complaint | spam | positive_feedback | general_question | unknown",
  "sentiment": "positive | neutral | negative"
}
`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini AI error:", error.message);

    return {
      intent: "unknown",
      sentiment: "neutral"
    };
  }
}