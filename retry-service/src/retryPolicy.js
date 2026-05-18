export function getBackoffMs(retryCount) {
  return 1000 * Math.pow(2, retryCount);
}

export function shouldRetry(retryCount, maxRetry) {
  return retryCount < maxRetry;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}