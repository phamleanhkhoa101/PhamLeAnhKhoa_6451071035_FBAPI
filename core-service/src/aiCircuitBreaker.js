import dotenv from "dotenv";

dotenv.config();

const threshold = Number(process.env.AI_CIRCUIT_BREAKER_THRESHOLD || 5);
const cooldownMs = Number(process.env.AI_CIRCUIT_BREAKER_COOLDOWN_MS || 30000);

export const aiCircuitBreaker = {
  failureCount: 0,
  threshold,
  state: "closed",
  openedAt: null,
  cooldownMs
};

export function canCallAi() {
  if (aiCircuitBreaker.state === "closed") {
    return true;
  }

  if (
    aiCircuitBreaker.openedAt &&
    Date.now() - aiCircuitBreaker.openedAt > aiCircuitBreaker.cooldownMs
  ) {
    aiCircuitBreaker.state = "half-open";
    return true;
  }

  return false;
}

export function recordAiSuccess() {
  aiCircuitBreaker.failureCount = 0;
  aiCircuitBreaker.state = "closed";
  aiCircuitBreaker.openedAt = null;
}

export function recordAiFailure() {
  aiCircuitBreaker.failureCount += 1;

  if (aiCircuitBreaker.failureCount >= aiCircuitBreaker.threshold) {
    aiCircuitBreaker.state = "open";
    aiCircuitBreaker.openedAt = Date.now();
  }
}

export function getAiCircuitBreakerState() {
  return {
    ...aiCircuitBreaker
  };
}
