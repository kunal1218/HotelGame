// @ts-check
import {
  TICK_HZ,
  WALK_SPEED,
  SPRINT_SPEED,
  PLAYER_RADIUS,
  SEPARATE_SPEED,
  SQUEEZE_AFTER_MS,
} from "../constants.js";
import { slideMove, canOccupy } from "./collision.js";
export const emptySqueeze = () => ({
  pushingId: null,
  pushMs: 0,
  squeezeId: null,
});
/** One deterministic 60 Hz step. Input axes are local right/forward. */
export function stepMotion(
  state,
  input,
  level,
  obstacles = [],
  squeeze = emptySqueeze(),
  selfId = 0,
) {
  let x = input.mx,
    z = input.mz;
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }
  const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
  const tx = (x * Math.cos(input.yaw) + z * Math.sin(input.yaw)) * speed;
  const tz = (-x * Math.sin(input.yaw) + z * Math.cos(input.yaw)) * speed;
  const damping = 1 - Math.exp(-12 / TICK_HZ);
  const vx = state.vx + (tx - state.vx) * damping,
    vz = state.vz + (tz - state.vz) * damping;
  let memory = { ...squeeze },
    position = { x: state.x, z: state.z };
  const squeezed = obstacles.find((o) => o.id === memory.squeezeId);
  if (
    !squeezed ||
    Math.hypot(position.x - squeezed.x, position.z - squeezed.z) >=
      PLAYER_RADIUS + squeezed.r + 0.01
  )
    memory.squeezeId = null;
  const blocking = obstacles.filter((o) => o.id !== memory.squeezeId);
  // Existing overlaps may shrink, but no step may deepen one or create a new one.
  const allowedFrom = (start) => (x, z) =>
    blocking.every((o) => {
      const minimum = Math.min(
        PLAYER_RADIUS + o.r,
        Math.hypot(start.x - o.x, start.z - o.z),
      );
      return Math.hypot(x - o.x, z - o.z) >= minimum - 1e-9;
    });
  let budget = SEPARATE_SPEED / TICK_HZ;
  for (const o of blocking) {
    const dx = position.x - o.x,
      dz = position.z - o.z,
      distance = Math.hypot(dx, dz),
      overlap = PLAYER_RADIUS + o.r - distance;
    if (overlap <= 0 || budget <= 0) continue;
    const amount = Math.min(budget, overlap + 0.001),
      nx = distance > 1e-8 ? dx / distance : selfId < o.id ? -1 : 1,
      nz = distance > 1e-8 ? dz / distance : 0;
    const moved = slideMove(
      level,
      position.x,
      position.z,
      nx * amount,
      nz * amount,
      PLAYER_RADIUS,
      allowedFrom(position),
    );
    budget -= Math.hypot(moved.x - position.x, moved.z - position.z);
    position = moved;
  }
  const start = position;
  position = slideMove(
    level,
    start.x,
    start.z,
    vx / TICK_HZ,
    vz / TICK_HZ,
    PLAYER_RADIUS,
    allowedFrom(start),
  );
  const blocker = blocking.find(
    (o) =>
      Math.hypot(start.x - o.x, start.z - o.z) < PLAYER_RADIUS + o.r + 0.1 &&
      (o.x - start.x) * tx + (o.z - start.z) * tz > 0.01,
  );
  if (
    blocker &&
    Math.hypot(position.x - start.x, position.z - start.z) < 0.001
  ) {
    if (memory.pushingId !== blocker.id)
      memory = {
        ...memory,
        pushingId: blocker.id,
        pushMs: 0,
        originX: position.x,
        originZ: position.z,
      };
    if (
      Math.hypot(position.x - memory.originX, position.z - memory.originZ) >=
      0.1
    )
      memory = {
        ...memory,
        pushMs: 0,
        originX: position.x,
        originZ: position.z,
      };
    memory.pushMs += 1000 / TICK_HZ;
    if (memory.pushMs + 1e-8 >= SQUEEZE_AFTER_MS) {
      memory.squeezeId = blocker.id;
      memory.pushingId = null;
      memory.pushMs = 0;
    }
  } else {
    memory.pushingId = null;
    memory.pushMs = 0;
  }
  return { state: { ...position, vx, vz }, squeeze: memory };
}
export function checkMotion(prev, cmd, level, epoch, seq) {
  if (cmd.ep !== epoch) return { ok: false, reason: "stale_epoch" };
  if (cmd.seq <= seq) return { ok: false, reason: "out_of_order" };
  if (
    Math.hypot(cmd.x - prev.x, cmd.z - prev.z) >
    (SPRINT_SPEED / TICK_HZ) * 1.5 + 0.02
  )
    return { ok: false, reason: "too_far" };
  if (!canOccupy(level, cmd.x, cmd.z, PLAYER_RADIUS))
    return { ok: false, reason: "blocked" };
  return { ok: true };
}
