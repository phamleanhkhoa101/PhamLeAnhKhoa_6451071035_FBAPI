export const circuitBreaker = {
  failureCount: 0,
  threshold: 5,
  state: "closed",
  openedAt: null,
  cooldownMs: 30000
};

export function canCallFacebook() {
  if (circuitBreaker.state === "closed") {
    return true;
  }

  if (Date.now() - circuitBreaker.openedAt > circuitBreaker.cooldownMs) {
    circuitBreaker.state = "half-open";
    return true;
  }

  return false;
}

export function recordSuccess() {
  circuitBreaker.failureCount = 0;
  circuitBreaker.state = "closed";
  circuitBreaker.openedAt = null;
}

export function recordFailure() {
  circuitBreaker.failureCount += 1;

  if (circuitBreaker.failureCount >= circuitBreaker.threshold) {
    circuitBreaker.state = "open";
    circuitBreaker.openedAt = Date.now();
  }
}