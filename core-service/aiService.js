import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export function detectSpam(message) {
  const lower = message.toLowerCase();

  const hasLink = lower.includes("http://") || lower.includes("https://");
  const repeatedText = /(.)\1{8,}/.test(lower);

  return hasLink || repeatedText;
}

export async function analyzeMessage(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Bạn là AI phân tích bình luận Facebook Page. Chỉ trả về JSON hợp lệ, không markdown."
        },
        {
          role: "user",
          content: `
            Phân tích bình luận sau:

            "${message}"

            Trả về đúng schema:
            {
            "intent": "ask_price | complaint | spam | positive_feedback | general_question | unknown",
            "sentiment": "positive | neutral | negative"
            }
            `
        }
      ]
    });

    const content = response.choices[0].message.content;

    return JSON.parse(content);
  } catch (error) {
    console.error("OpenAI AI error:", error.message);

    return {
      intent: "unknown",
      sentiment: "neutral"
    };
  }
}