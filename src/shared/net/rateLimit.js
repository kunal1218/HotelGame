// @ts-check
export function createTokenBucket(rate, capacity, nowMs) {
  let tokens = capacity,
    last = nowMs();
  return {
    take(count = 1) {
      const now = nowMs();
      tokens = Math.min(capacity, tokens + ((now - last) * rate) / 1000);
      last = now;
      if (tokens < count) return false;
      tokens -= count;
      return true;
    },
  };
}
