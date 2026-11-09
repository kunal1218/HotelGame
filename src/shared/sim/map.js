// @ts-check
export const Level = Object.freeze({ LOBBY: 0, FLOOR: 1 });
const box = (x, z, w, d) =>
  Object.freeze({
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
  });
const colliders = [
  [0, -14, 28, 0.3],
  [14, 0, 0.28, 28],
  [-14, 0, 0.3, 28],
  [0, 14, 28, 0.3],
  [-12, -9, 0.7, 0.7],
  [-12, 7, 0.7, 0.7],
  [11.5, -10, 0.7, 0.7],
  [11.5, 8, 0.7, 0.7],
  [-7.3, 0.3, 4.15, 1.75],
  [-11, -3.3, 1.75, 3.75],
  [-4.35, -4.8, 1.75, 1.35],
  [-5.1, -6.3, 1.75, 1.35],
  [-7.5, -3.1, 3.7, 1.9],
  [-4.55, -0.15, 1.1, 1.1],
  [7.15, -8.9, 6.6, 1.9],
  [13, 0, 1.4, 19],
  // Two fireside chairs use the same sofa collision footprint.
  [8.3, 1.7, 1.75, 1.5],
  [8.3, -2.3, 1.75, 1.5],
  [10.15, -0.35, 1.4, 1.4],
  [-11.5, -11.6, 1.1, 1.1],
  [-12, 4.8, 1.16, 1.16],
  [10.9, -11.9, 1.16, 1.16],
  [11.4, 5.5, 1, 1],
  [-3.8, -10.8, 0.86, 0.86],
].map((args) => box(...args));
const spawn = Object.freeze({ x: 3, z: 10.5, yaw: Math.atan2(5, 15.5) });
export const MAP = Object.freeze({
  [Level.LOBBY]: Object.freeze({
    // Bounds constrain the player's centre, preserving the original controller.
    bounds: Object.freeze({
      minX: -13.35,
      maxX: 13.35,
      minZ: -13.2,
      maxZ: 13.1,
    }),
    colliders: Object.freeze(colliders),
    spawn,
    spawns: Object.freeze(
      Array.from({ length: 5 }, (_, i) =>
        Object.freeze({ ...spawn, x: 3 - i * 0.8 }),
      ),
    ),
    elevator: Object.freeze({ x: 0, z: -12.8, radius: 3.2 }),
    exit: Object.freeze({ x: 0, z: 12.5, radius: 2 }),
  }),
});
