// @ts-check
import { MAP, Level } from "./map.js";
import { Kind, PlayerStatus } from "./entities.js";
import { checkMotion } from "./motion.js";
export function createWorld(seed) {
  return {
    seed,
    tick: 0,
    nextId: 3,
    players: new Map(),
    overlapSince: new Map(),
    overlaps: 0,
    props: new Map([
      [1, { id: 1, kind: Kind.PROP, owner: null, fields: { state: true } }],
      [2, { id: 2, kind: Kind.PROP, owner: null, fields: { state: false } }],
    ]),
  };
}
export function entities(world) {
  return [...world.players.values(), ...world.props.values()];
}
/** All shared state changes occur at tick boundaries. No clocks, renderer or I/O. */
export function stepWorld(
  world,
  {
    joins = [],
    leaves = [],
    motion = new Map(),
    starved = new Set(),
    requests = [],
  } = {},
) {
  world.tick++;
  const output = {
    events: [],
    responses: [],
    corrections: [],
    rejectedJoins: [],
  };
  for (const id of leaves) world.players.delete(id);
  for (const join of joins) {
    const slot = MAP[Level.LOBBY].spawns.findIndex((s) =>
      [...world.players.values()].every(
        (p) => Math.hypot(p.fields.x - s.x, p.fields.z - s.z) >= 0.74,
      ),
    );
    if (slot < 0) {
      output.rejectedJoins.push(join.playerId);
      continue;
    }
    const spawn = MAP[Level.LOBBY].spawns[slot];
    world.players.set(join.playerId, {
      id: world.nextId++,
      kind: Kind.PLAYER,
      owner: join.playerId,
      slot,
      lastSeq: 0,
      fields: {
        x: spawn.x,
        z: spawn.z,
        yaw: spawn.yaw,
        pitch: 0,
        ep: 0,
        lvl: Level.LOBBY,
        st: PlayerStatus.ACTIVE,
        carry: 0,
        name: join.name,
      },
    });
  }
  world.playerCount = world.players.size;
  for (const [id, player] of world.players) {
    const commands = motion.get(id) ?? [];
    player.fields.st = starved.has(id) ? PlayerStatus.AFK : PlayerStatus.ACTIVE;
    for (const cmd of commands) {
      const checked = checkMotion(
        player.fields,
        cmd,
        MAP[player.fields.lvl],
        player.fields.ep,
        player.lastSeq,
      );
      if (checked.ok) {
        Object.assign(player.fields, {
          x: cmd.x,
          z: cmd.z,
          yaw: cmd.in.yaw,
          pitch: cmd.in.pitch,
        });
        player.lastSeq = cmd.seq;
      } else if (checked.reason === "too_far" || checked.reason === "blocked") {
        player.fields.ep = (player.fields.ep + 1) % 65536;
        player.lastSeq = cmd.seq;
        output.corrections.push({ playerId: id, ...player.fields });
      }
    }
  }
  for (const req of requests) {
    const player = world.players.get(req.playerId),
      prop = world.props.get(req.target);
    let reason = "unknown_action";
    if (player && req.action === "return_to_entrance") {
      const slot = MAP[0].spawns.find((s) =>
        [...world.players.values()].every(
          (p) =>
            p === player ||
            Math.hypot(p.fields.x - s.x, p.fields.z - s.z) >= 0.74,
        ),
      );
      if (slot) {
        Object.assign(player.fields, {
          x: slot.x,
          z: slot.z,
          ep: (player.fields.ep + 1) % 65536,
        });
        reason = null;
      } else reason = "occupied";
    }
    if (player && req.action === "toggle" && prop) {
      const point =
        req.target === 1 ? { x: 11.6, z: -0.3, radius: 3.1 } : MAP[0].elevator;
      if (
        Math.hypot(player.fields.x - point.x, player.fields.z - point.z) <=
        point.radius + 0.3
      ) {
        prop.fields.state = !prop.fields.state;
        output.events.push({
          tick: world.tick,
          k: "prop_toggled",
          target: prop.id,
        });
        reason = null;
      } else reason = "too_far";
    }
    output.responses.push({
      playerId: req.playerId,
      id: req.id,
      ok: reason === null,
      ...(reason ? { reason } : {}),
    });
  }
  const pairs = new Set(),
    players = [...world.players.values()];
  world.overlaps = 0;
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i],
        b = players[j],
        key = `${a.id}:${b.id}`;
      if (
        a.fields.lvl !== b.fields.lvl ||
        Math.hypot(a.fields.x - b.fields.x, a.fields.z - b.fields.z) >= 0.54
      )
        continue;
      pairs.add(key);
      if (!world.overlapSince.has(key)) world.overlapSince.set(key, world.tick);
      if (world.tick - world.overlapSince.get(key) >= 30) world.overlaps++;
    }
  for (const key of world.overlapSince.keys())
    if (!pairs.has(key)) world.overlapSince.delete(key);
  return output;
}
