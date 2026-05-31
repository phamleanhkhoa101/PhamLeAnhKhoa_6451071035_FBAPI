export function getBackoffMs(retryCount) {
  const safeRetryCount = Math.max(0, Number(retryCount) || 0);
  return 1000 * Math.pow(2, safeRetryCount);
}

export function shouldRetry(retryCount, maxRetry) {
  return retryCount < maxRetry;
}

export function sleep(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}
