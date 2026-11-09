import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAP } from "../src/shared/sim/map.js";
import { stepMotion } from "../src/shared/sim/motion.js";
import { createMotionDriver } from "../src/shared/sim/motionDriver.js";
import {
  canOccupy,
  slideMove,
  lineOfSight,
  quantizePosition,
} from "../src/shared/sim/collision.js";
const open = {
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  colliders: [],
  spawn: { x: 0, z: 0 },
};
const input = { mx: 0, mz: -1, yaw: 0, pitch: 0, sprint: false };
const initial = { x: 0, z: 0, vx: 0, vz: 0 };
function move(command = input, seconds = 2, level = open) {
  let state = initial;
  for (let i = 0; i < seconds * 60; i++)
    state = stepMotion(state, command, level).state;
  return state;
}
test("migration: all 24 lobby colliders match the captured original scene", () => {
  assert.deepEqual(
    MAP[0].colliders,
    JSON.parse(
      readFileSync(new URL("./fixtures/lobby-colliders.json", import.meta.url)),
    ),
  );
  for (const slot of MAP[0].spawns)
    assert.ok(canOccupy(MAP[0], slot.x, slot.z));
});
test("movement follows camera yaw", () => {
  const s = move({ ...input, yaw: Math.PI / 2 });
  assert.ok(s.x < -4);
  assert.ok(Math.abs(s.z) < 1e-10);
});
test("walk speed settles at 2.6 metres per second", () =>
  assert.ok(Math.abs(move().vz + 2.6) < 1e-8));
test("sprint speed settles at 4.4 metres per second", () =>
  assert.ok(Math.abs(move({ ...input, sprint: true }).vz + 4.4) < 1e-8));
test("diagonal movement is normalized", () =>
  assert.ok(
    Math.abs(
      Math.hypot(move({ ...input, mx: 1 }).x, move({ ...input, mx: 1 }).z) -
        Math.abs(move().z),
    ) < 1e-9,
  ));
const wall = {
  ...open,
  colliders: [{ minX: 0.8, maxX: 0.81, minZ: -10, maxZ: 10 }],
};
test("thin walls cannot be crossed even by a large displacement", () =>
  assert.ok(slideMove(wall, 0, 0, 10, 0).x <= 0.48 + 1e-9));
test("collision slides along a wall", () => {
  const s = slideMove(wall, 0, 0, 2, 2);
  assert.ok(s.x <= 0.48 + 1e-9);
  assert.ok(s.z > 1.9);
});
test("bounds and illegal starts are respected", () => {
  assert.equal(canOccupy(MAP[0], 13.36, 0), false);
  assert.deepEqual(slideMove(wall, 0.8, 0, 5, 5), { x: 0.8, z: 0 });
});
test("reset clears velocity and pending simulation time", () => {
  const d = createMotionDriver(open);
  d.advance(0.025, input);
  d.reset({ x: 4, z: 5 });
  assert.deepEqual(d.state(), { x: 4, z: 5, vx: 0, vz: 0 });
  assert.equal(d.advance(0, input).x, 4);
});
test("pause stop prevents momentum on resume", () => {
  const d = createMotionDriver(open);
  d.advance(0.05, input);
  d.stop();
  const before = d.state();
  d.advance(1 / 60, { ...input, mz: 0 });
  assert.deepEqual(d.state(), before);
});
test("analog input preserves proportional speed", () =>
  assert.ok(
    Math.abs(move({ ...input, mz: -0.4 }).vz / move().vz - 0.4) < 1e-9,
  ));
test("30, 60 and 144 Hz render rates produce identical simulation", () => {
  const states = [30, 60, 144].map((hz) => {
    const d = createMotionDriver(open);
    for (let i = 0; i < hz * 2; i++) d.advance(1 / hz, input);
    return d.state();
  });
  assert.deepEqual(states[0], states[1]);
  assert.deepEqual(states[1], states[2]);
});
test("line of sight handles crossing, parallel and inside-wall segments", () => {
  assert.equal(lineOfSight(wall, 0, 0, 2, 0), false);
  assert.equal(lineOfSight(wall, 0, 0, 0, 5), true);
  assert.equal(lineOfSight(wall, 0.8, 0, 0.8, 1), false);
});
test("players block locally and release after the 1.5 second anti-trap wait", () => {
  const obstacle = { id: 2, x: 0.64, z: 0, r: 0.32 };
  let state = { ...initial },
    squeeze = { pushingId: null, pushMs: 0, squeezeId: null };
  const right = { ...input, mx: 1, mz: 0 };
  for (let i = 0; i < 89; i++) {
    const next = stepMotion(state, right, open, [obstacle], squeeze, 1);
    state = next.state;
    squeeze = next.squeeze;
    assert.equal(squeeze.squeezeId, null);
    assert.ok(state.x < 0.001);
  }
  ({ state, squeeze } = stepMotion(state, right, open, [obstacle], squeeze, 1));
  assert.equal(squeeze.squeezeId, 2);
  for (let i = 0; i < 50; i++)
    ({ state, squeeze } = stepMotion(
      state,
      right,
      open,
      [obstacle],
      squeeze,
      1,
    ));
  assert.ok(state.x > 1.3);
  assert.equal(squeeze.squeezeId, null);
});
test("coincident players separate within half a second without a server correction", () => {
  let a = { ...initial },
    b = { ...initial };
  const idle = { ...input, mz: 0 };
  for (let i = 0; i < 30; i++) {
    const oldA = a,
      oldB = b;
    a = stepMotion(
      oldA,
      idle,
      open,
      [{ id: 2, x: oldB.x, z: oldB.z, r: 0.32 }],
      undefined,
      1,
    ).state;
    b = stepMotion(
      oldB,
      idle,
      open,
      [{ id: 1, x: oldA.x, z: oldA.z, r: 0.32 }],
      undefined,
      2,
    ).state;
  }
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.64);
});
test("wire position rounding must preserve a legal circle at curved corners", () => {
  const c = MAP[0].colliders[8];
  const x = c.maxX + 0.3201 / Math.sqrt(2),
    z = c.maxZ + 0.3201 / Math.sqrt(2);
  assert.equal(canOccupy(MAP[0], x, z), true);
  const rounded = quantizePosition(MAP[0], x, z);
  assert.equal(canOccupy(MAP[0], rounded.x, rounded.z), true);
});
