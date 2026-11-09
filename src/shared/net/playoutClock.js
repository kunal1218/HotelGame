// @ts-check
import { TICK_HZ, INTERP_MIN_MS, INTERP_MAX_MS } from "../constants.js";
export function createPlayoutClock() {
  let latest = null,
    arrival = 0,
    previousArrival = null,
    previousTick = 0,
    jitter = 0,
    render = null;
  return {
    observe(tick, now) {
      if (latest !== null && tick <= latest) return;
      if (previousArrival !== null)
        jitter =
          jitter * 0.9 +
          Math.abs(
            now - previousArrival - ((tick - previousTick) * 1000) / TICK_HZ,
          ) *
            0.1;
      latest = tick;
      arrival = now;
      previousArrival = now;
      previousTick = tick;
    },
    sample(now) {
      if (latest === null) return 0;
      const target =
        latest + ((now - arrival - this.delayMs()) * TICK_HZ) / 1000;
      render = render === null ? target : Math.max(render, target);
      return render;
    },
    delayMs: () =>
      Math.max(
        INTERP_MIN_MS,
        Math.min(INTERP_MAX_MS, INTERP_MIN_MS + 2 * jitter),
      ),
    jitterMs: () => jitter,
    reset() {
      latest = null;
      previousArrival = null;
      render = null;
      jitter = 0;
    },
  };
}
