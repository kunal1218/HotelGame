// @ts-check
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
/** Bounds describe legal centre positions; colliders describe solid geometry. */
export function canOccupy(level, x, z, radius = 0.32) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const b = level.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  return !level.colliders.some(
    (c) =>
      (x - clamp(x, c.minX, c.maxX)) ** 2 +
        (z - clamp(z, c.minZ, c.maxZ)) ** 2 <
      radius ** 2,
  );
}
/** Substeps preserve thin walls and axis-by-axis wall sliding. Illegal starts stay put. */
export function slideMove(
  level,
  x,
  z,
  dx,
  dz,
  radius = 0.32,
  allowed = () => true,
) {
  if (!canOccupy(level, x, z, radius)) return { x, z };
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
  for (let i = 0; i < steps; i++) {
    const nx = x + dx / steps;
    if (canOccupy(level, nx, z, radius) && allowed(nx, z)) x = nx;
    const nz = z + dz / steps;
    if (canOccupy(level, x, nz, radius) && allowed(x, nz)) z = nz;
  }
  return { x, z };
}
/** Segment/AABB slab intersection, including a segment starting inside a wall. */
export function lineOfSight(level, ax, az, bx, bz) {
  return !level.colliders.some((c) => {
    let near = 0,
      far = 1;
    for (const [a, d, min, max] of [
      [ax, bx - ax, c.minX, c.maxX],
      [az, bz - az, c.minZ, c.maxZ],
    ]) {
      if (Math.abs(d) < 1e-12) {
        if (a < min || a > max) return false;
      } else {
        const t1 = (min - a) / d,
          t2 = (max - a) / d;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
      }
    }
    return near <= far;
  });
}
/** Choose the nearest legal centimetre-grid point, keeping rounding out of walls. */
export function quantizePosition(level, x, z, radius = 0.32) {
  if (!canOccupy(level, x, z, radius)) return { x, z }; // Preserve invalid reports for server validation.
  const candidates = [];
  for (const qx of [Math.floor(x * 100) / 100, Math.ceil(x * 100) / 100])
    for (const qz of [Math.floor(z * 100) / 100, Math.ceil(z * 100) / 100])
      if (canOccupy(level, qx, qz, radius)) candidates.push({ x: qx, z: qz });
  candidates.sort(
    (a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z),
  );
  return candidates[0] ?? { x, z };
}
