import axios from "axios";
import dotenv from "dotenv";
import {
  canCallFacebook,
  circuitBreaker,
  recordSuccess,
  recordFailure
} from "./circuitBreaker.js";

dotenv.config();

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN"
]);

function truncateText(value, maxLength = 120) {
  if (typeof value !== "string") {
    return value;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function buildPreview(value, depth = 0) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return truncateText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 3).map((item) => buildPreview(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= 2) {
      return "[object]";
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "access_token")
        .slice(0, 6)
        .map(([key, item]) => [key, buildPreview(item, depth + 1)])
    );
  }

  return String(value);
}

function buildResponsePreview(data) {
  if (data == null) {
    return null;
  }

  if (Array.isArray(data?.data)) {
    return {
      items_count: data.data.length,
      first_item: buildPreview(data.data[0] || null)
    };
  }

  if (typeof data === "object") {
    const preview = {};

    if (data.id) {
      preview.id = data.id;
    }

    if (data.success !== undefined) {
      preview.success = data.success;
    }

    if (data.message) {
      preview.message = truncateText(data.message);
    }

    if (Object.keys(preview).length > 0) {
      return preview;
    }
  }

  return buildPreview(data);
}

function isRetryableFacebookError(error, normalizedError) {
  if (normalizedError.code === "CIRCUIT_BREAKER_OPEN") {
    return true;
  }

  if (!error?.response && RETRYABLE_NETWORK_CODES.has(error?.code)) {
    return true;
  }

  if (!error?.response) {
    return true;
  }

  if (normalizedError.status === 429) {
    return true;
  }

  if (normalizedError.status >= 500) {
    return true;
  }

  return false;
}

function classifyFacebookError(error, normalizedError) {
  if (normalizedError.code === "CIRCUIT_BREAKER_OPEN") {
    return "downstream_unavailable";
  }

  if (!error?.response && normalizedError.code === "ECONNABORTED") {
    return "timeout";
  }

  if (!error?.response) {
    return "network_error";
  }

  if (normalizedError.status === 429) {
    return "rate_limited";
  }

  if (normalizedError.status === 401 || normalizedError.status === 403) {
    return "auth_or_permission_error";
  }

  if (normalizedError.status === 400 || normalizedError.status === 404) {
    return "invalid_request";
  }

  if (normalizedError.status >= 500) {
    return "facebook_server_error";
  }

  return "facebook_api_error";
}

function handleFacebookError(error) {
  const fbError = error.response?.data?.error;

  const normalizedError = {
    status: error.response?.status || 500,
    code:
      fbError?.code ||
      error.code ||
      "FACEBOOK_REQUEST_FAILED",
    message:
      fbError?.message ||
      error.message ||
      "Facebook API error",
    type: fbError?.type || "FACEBOOK_API_ERROR"
  };

  normalizedError.retryable = isRetryableFacebookError(error, normalizedError);
  normalizedError.error_class = classifyFacebookError(error, normalizedError);

  return normalizedError;
}

function handleCircuitBreakerOpen() {
  return {
    status: 503,
    code: "CIRCUIT_BREAKER_OPEN",
    message: "Facebook service is temporarily unavailable",
    type: "CIRCUIT_BREAKER",
    retryable: true,
    error_class: "downstream_unavailable"
  };
}

export async function facebookGet(path, params = {}) {
  console.log("[Facebook GET]", {
    method: "GET",
    path,
    time: new Date().toISOString(),
    params_preview: buildPreview(params)
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
      method: "GET",
      path,
      status: response.status,
      response_preview: buildResponsePreview(response.data)
    });

    return response.data;
  } catch (error) {
    console.error("[Facebook GET Failed]", {
      method: "GET",
      path,
      time: new Date().toISOString(),
      params_preview: buildPreview(params),
      ...handleFacebookError(error)
    });
    throw handleFacebookError(error);
  }
}

export async function facebookPost(path, data = {}) {
  if (!canCallFacebook()) {
    throw handleCircuitBreakerOpen();
  }

  console.log("[Facebook POST]", {
    method: "POST",
    path,
    time: new Date().toISOString(),
    payload_preview: buildPreview(data)
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
      method: "POST",
      path,
      status: response.status,
      response_preview: buildResponsePreview(response.data)
    });

    return response.data;
  } catch (error) {
    const normalizedError = handleFacebookError(error);

    if (normalizedError.retryable) {
      recordFailure();
    } else if (circuitBreaker.state === "half-open") {
      recordSuccess();
    }

    console.error("[Facebook POST Failed]", {
      method: "POST",
      path,
      time: new Date().toISOString(),
      payload_preview: buildPreview(data),
      ...normalizedError
    });

    throw normalizedError;
  }
}
