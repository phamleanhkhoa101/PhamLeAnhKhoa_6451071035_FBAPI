import axios from "axios";
import dotenv from "dotenv";
import {
  canCallFacebook,
  recordSuccess,
  recordFailure
} from "./circuitBreaker.js";

dotenv.config();

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

function handleFacebookError(error) {
  const fbError = error.response?.data?.error;

  if (fbError) {
    return {
      status: error.response?.status || 500,
      code: fbError.code || "FACEBOOK_API_ERROR",
      message: fbError.message || "Facebook API error",
      type: fbError.type
    };
  }

  return {
    status: 500,
    code: "FACEBOOK_REQUEST_FAILED",
    message: error.message
  };
}

export async function facebookGet(path, params = {}) {
  console.log("[Facebook GET]", {
    path,
    time: new Date().toISOString()
  });

  try {
    const response = await axios.get(`https://graph.facebook.com/v25.0/${path}`, {
      params: {
        ...params,
        access_token: PAGE_ACCESS_TOKEN
      },
      timeout: 5000
    });

    console.log("[Facebook GET Success]", {
      path,
      status: response.status
    });

    return response.data;
  } catch (error) {
    console.error("[Facebook GET Failed]", handleFacebookError(error));
    throw handleFacebookError(error);
  }
}

export async function facebookPost(path, data = {}) {
  if (!canCallFacebook()) {
    throw {
      status: 503,
      code: "CIRCUIT_BREAKER_OPEN",
      message: "Facebook service is temporarily unavailable"
    };
  }

  console.log("[Facebook POST]", {
    path,
    time: new Date().toISOString()
  });

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

    console.log("[Facebook POST Success]", {
      path,
      status: response.status
    });

    return response.data;
  } catch (error) {
    recordFailure();

    const normalizedError = handleFacebookError(error);

    console.error("[Facebook POST Failed]", normalizedError);

    throw normalizedError;
  }
}