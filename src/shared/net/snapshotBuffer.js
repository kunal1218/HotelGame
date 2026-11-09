// @ts-check
import { blend, isValidValue, Blend } from "./schema.js";
import { EXTRAP_MAX_MS, TICK_HZ } from "../constants.js";
export function createSnapshotBuffer(schemas, capacity = 32) {
  const snapshots = [];
  return {
    push(snap) {
      if (snapshots.length && snap.tick <= snapshots.at(-1).tick) return false;
      const ids = new Set();
      for (const ent of snap.ents) {
        const schema = schemas.get(ent.kind);
        if (!schema || ids.has(ent.id)) return false;
        ids.add(ent.id);
        for (const [key, value] of Object.entries(ent.fields))
          if (
            !schema.fields[key] ||
            !isValidValue(schema.fields[key].type, value)
          )
            return false;
        // Every public field is required; an incomplete entity must never reach rendering.
        for (const [key, spec] of Object.entries(schema.fields))
          if (spec.vis === "all" && !(key in ent.fields)) return false;
      }
      snapshots.push(snap);
      if (snapshots.length > capacity) snapshots.shift();
      return true;
    },
    newestTick: () => snapshots.at(-1)?.tick ?? null,
    clear() {
      snapshots.length = 0;
    },
    sample(tick) {
      const result = new Map();
      let index = -1;
      for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].tick <= tick) index = i;
        else break;
      }
      if (index < 0) return result;
      const a = snapshots[index],
        b = snapshots[index + 1];
      const future = new Map(b?.ents.map((e) => [e.id, e]) ?? []);
      const older = index > 0 ? snapshots[index - 1] : null;
      for (const ent of a.ents) {
        const fields = { ...ent.fields },
          next = future.get(ent.id),
          schema = schemas.get(ent.kind);
        if (next && next.fields.ep === ent.fields.ep) {
          const t = (tick - a.tick) / (b.tick - a.tick);
          for (const key of Object.keys(fields))
            if (key in next.fields)
              fields[key] = blend(
                schema.fields[key],
                fields[key],
                next.fields[key],
                t,
              );
        } else if (!b && older) {
          const old = older.ents.find((e) => e.id === ent.id);
          if (old && old.fields.ep === ent.fields.ep) {
            const t =
              Math.min(tick - a.tick, (EXTRAP_MAX_MS * TICK_HZ) / 1000) /
              (a.tick - older.tick);
            for (const [key, spec] of Object.entries(schema.fields))
              if (spec.blend === Blend.LINEAR && key in fields)
                fields[key] += (ent.fields[key] - old.fields[key]) * t;
          }
        }
        result.set(ent.id, { id: ent.id, kind: ent.kind, fields });
      }
      return result;
    },
  };
}
