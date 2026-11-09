// @ts-check
import { TICK_HZ } from "../constants.js";
import { stepMotion, emptySqueeze } from "./motion.js";
/** Separates simulation state from the interpolated camera; no rendered position feeds physics. */
export function createMotionDriver(level, spawn = level.spawn) {
  let state,
    previous,
    accumulator = 0,
    obstacles = [],
    selfId = 0,
    squeeze = emptySqueeze();
  const reset = (position) => {
    state = { x: position.x, z: position.z, vx: 0, vz: 0 };
    previous = { ...state };
    accumulator = 0;
    squeeze = emptySqueeze();
  };
  reset(spawn);
  return {
    reset,
    setObstacles(value, id) {
      obstacles = value;
      selfId = id;
    },
    stop() {
      state = { ...state, vx: 0, vz: 0 };
      previous = { ...state };
      accumulator = 0;
    },
    state: () => ({ ...state }),
    advance(dt, input, onTick = () => {}) {
      accumulator += Math.max(0, Math.min(dt, 0.1));
      while (accumulator + 1e-10 >= 1 / TICK_HZ) {
        previous = { ...state };
        const result = stepMotion(
          state,
          input,
          level,
          obstacles,
          squeeze,
          selfId,
        );
        state = result.state;
        squeeze = result.squeeze;
        accumulator = Math.max(0, accumulator - 1 / TICK_HZ);
        onTick({ ...state }, input);
      }
      const a = accumulator * TICK_HZ;
      return {
        x: previous.x + (state.x - previous.x) * a,
        z: previous.z + (state.z - previous.z) * a,
        vx: state.vx,
        vz: state.vz,
      };
    },
  };
}
