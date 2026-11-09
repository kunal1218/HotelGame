// @ts-check
import { TICK_HZ } from "../constants.js";
/** Pump from requestAnimationFrame, a timer or a deterministic test clock. */
export function createFixedLoop({ nowMs, tick, log = () => {} }) {
  let last = nowMs(),
    accumulator = 0;
  return {
    pump() {
      const now = nowMs();
      accumulator += Math.max(0, now - last);
      last = now;
      let count = Math.floor((accumulator + 1e-7) / (1000 / TICK_HZ));
      if (count > 5) {
        log("tick_skip", { ticks: count - 5 });
        accumulator -= ((count - 5) * 1000) / TICK_HZ;
        count = 5;
      }
      for (let i = 0; i < count; i++) {
        tick();
        accumulator -= 1000 / TICK_HZ;
      }
    },
  };
}
