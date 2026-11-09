// @ts-check
import { createRng } from "../sim/rng.js";
export const PRESETS = Object.freeze({
  lan: { latencyMs: 0, jitterMs: 0, spikeChance: 0, spikeMs: 0 },
  wifi: { latencyMs: 40, jitterMs: 15, spikeChance: 0.01, spikeMs: 100 },
  bad: { latencyMs: 75, jitterMs: 30, spikeChance: 0.03, spikeMs: 250 },
});
/** Both directions remain ordered, including across a simulated TCP delay spike. */
export function withConditions(
  conn,
  {
    latencyMs = 0,
    jitterMs = 0,
    spikeChance = 0,
    spikeMs = 0,
    seed = 1,
    schedule = (fn, ms) => setTimeout(fn, ms),
    nowMs = () => performance.now(),
  } = {},
) {
  const rng = createRng(seed),
    last = [0, 0],
    messages = [],
    closes = [];
  let closed = false,
    queued = 0;
  function delay(direction, fn) {
    const now = nowMs();
    const at = Math.max(
      last[direction],
      now +
        Math.max(0, latencyMs + (rng() * 2 - 1) * jitterMs) +
        (rng() < spikeChance ? spikeMs : 0),
    );
    last[direction] = at;
    schedule(() => {
      if (!closed) fn();
    }, at - now);
  }
  conn.onMessage((data) => delay(1, () => messages.forEach((cb) => cb(data))));
  conn.onClose((code, reason) => {
    closed = true;
    queued = 0;
    closes.forEach((cb) => cb(code, reason));
  });
  return {
    id: conn.id,
    send(data) {
      if (closed) return false;
      const size = new TextEncoder().encode(data).length;
      queued += size;
      delay(0, () => {
        queued -= size;
        conn.send(data);
      });
      return true;
    },
    close(code, reason) {
      closed = true;
      queued = 0;
      conn.close(code, reason);
    },
    bufferedBytes: () => queued + conn.bufferedBytes(),
    onMessage: (cb) => messages.push(cb),
    onClose: (cb) => closes.push(cb),
  };
}
