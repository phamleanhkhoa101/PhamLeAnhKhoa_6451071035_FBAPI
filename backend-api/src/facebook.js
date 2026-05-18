import axios from "axios";
import dotenv from "dotenv";
import {
  canCallFacebook,
  recordSuccess,
  recordFailure
} from "./circuitBreaker.js";

dotenv.config();

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

export async function facebookGet(path, params = {}) {
  const response = await axios.get(`https://graph.facebook.com/v25.0/${path}`, {
    params: {
      ...params,
      access_token: PAGE_ACCESS_TOKEN
    },
    timeout: 5000
  });

  return response.data;
}

export async function facebookPost(path, data = {}) {
  if (!canCallFacebook()) {
    throw new Error("Circuit breaker is open");
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v25.0/${path}`,
      {
        ...data,
        access_token: PAGE_ACCESS_TOKEN
      },
      {
        timeout: 5000
      }
    );

    recordSuccess();

    return response.data;
  } catch (error) {
    recordFailure();

    throw error;
  }
}