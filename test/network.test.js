import test from "node:test";
import assert from "node:assert/strict";
import { createLoopbackPair } from "../src/shared/net/transport.js";
import { withConditions } from "../src/shared/net/conditioner.js";
import { createRoomManager } from "../src/shared/room/roomManager.js";
import { createRoom } from "../src/shared/room/room.js";
import { createNetClient } from "../src/net/netClient.js";
import { createRng } from "../src/shared/sim/rng.js";
import { decodeClient, decodeServer } from "../src/shared/net/protocol.js";
import { buildSnapshot } from "../src/shared/net/snapshot.js";
import { createSnapshotBuffer } from "../src/shared/net/snapshotBuffer.js";
import { schemas, Kind } from "../src/shared/sim/entities.js";
import { createWorld, stepWorld, entities } from "../src/shared/sim/world.js";
import { stepMotion } from "../src/shared/sim/motion.js";
import { MAP } from "../src/shared/sim/map.js";
import { createFixedLoop } from "../src/shared/net/fixedLoop.js";
function harness(options = {}) {
  let now = 0,
    index = 0,
    scheduled = [];
  const rng = createRng(100);
  const schedule = (fn, ms = 0) =>
    scheduled.push({ at: now + ms, fn, index: index++ });
  const nowMs = () => now;
  const manager = createRoomManager({
    nowMs,
    randomBytes: (n) =>
      Uint8Array.from({ length: n }, () => Math.floor(rng() * 256)),
    ...options,
  });
  function flush() {
    let count = 0;
    while (true) {
      scheduled.sort((a, b) => a.at - b.at || a.index - b.index);
      if (!scheduled.length || scheduled[0].at > now) break;
      scheduled.shift().fn();
      assert.ok(count++ < 10000);
    }
  }
  const clients = [],
    wire = [];
  function connection(condition) {
    const pair = createLoopbackPair({ schedule });
    manager.accept(pair.server);
    const transport = condition
      ? withConditions(pair.client, { ...condition, nowMs, schedule })
      : pair.client;
    return {
      ...transport,
      send(raw) {
        wire.push(raw);
        return transport.send(raw);
      },
    };
  }
  function join(room = null, condition) {
    const client = createNetClient({
      open: () => connection(condition),
      nowMs,
      name: "Player",
      room,
    });
    clients.push(client);
    return client;
  }
  function advance(ticks = 1) {
    for (let i = 0; i < ticks; i++) {
      now += 1000 / 60;
      flush();
      manager.tickAll();
      manager.sweep();
      flush();
    }
  }
  return { manager, join, connection, advance, flush, nowMs, clients, wire };
}
const commands = { mx: 0, mz: -1, yaw: 0, pitch: 0, sprint: false };
test("local room: create, join, full room, names, leave and idle cleanup", () => {
  const h = harness(),
    a = h.join();
  assert.equal(a.status(), "connecting");
  h.advance();
  assert.equal(a.status(), "joined");
  const code = a.self().room;
  assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  const others = Array.from({ length: 5 }, () => h.join(code));
  h.advance(10);
  assert.equal(others[4].status(), "closed");
  assert.match(others[4].reason(), /full/);
  const players = [...a.frame(h.nowMs()).entities.values()].filter(
    (e) => e.kind === Kind.PLAYER,
  );
  assert.equal(players.length, 5);
  assert.equal(new Set(players.map((e) => e.fields.name)).size, 5);
  others[0].close();
  h.advance(12);
  assert.equal(
    [...a.frame(h.nowMs()).entities.values()].filter(
      (e) => e.kind === Kind.PLAYER,
    ).length,
    4,
  );
  h.clients.forEach((c) => c.close());
  h.advance(3610);
  assert.deepEqual(h.manager.stats(), { rooms: 0, players: 0 });
});
test("version, missing hello, unknown room and oversized input fail readably", () => {
  const h = harness();
  const raw = h.connection();
  let code;
  raw.onClose((c) => (code = c));
  raw.send(
    JSON.stringify({ t: "hello", v: 999, build: "x", name: "a", room: null }),
  );
  h.advance();
  assert.equal(code, 4001);
  const pending = h.connection();
  pending.onClose((c) => (code = c));
  h.advance(301);
  assert.equal(code, 4004);
  const missing = h.join("BBBB");
  h.advance();
  assert.equal(missing.status(), "closed");
  assert.equal(decodeClient("x".repeat(17000)).ok, false);
  for (const value of [
    "null",
    "[]",
    "{}",
    '{"t":"in","cmds":[]}',
    '{"t":"voice"}',
  ])
    assert.equal(decodeClient(value).ok, false);
});
test("shared motion reaches a second client through delayed ordered transport", () => {
  const h = harness(),
    a = h.join();
  h.advance();
  const b = h.join(a.self().room, { latencyMs: 75, jitterMs: 30, seed: 42 });
  h.advance(30);
  assert.equal(b.status(), "joined");
  let state = { ...a.frame(h.nowMs()).selfJump, vx: 0, vz: 0 };
  for (let i = 0; i < 90; i++) {
    state = stepMotion(state, commands, MAP[0]).state;
    a.recordMotion(commands, state.x, state.z);
    h.advance();
    a.frame(h.nowMs());
    b.frame(h.nowMs());
  }
  h.advance(30);
  const remote = b.frame(h.nowMs()).entities.get(a.self().entity);
  assert.ok(Math.abs(remote.fields.z - state.z) < 0.1);
  assert.equal(a.stats().corrections, 0);
});
test("invalid motion gets one correction and stale epoch cannot loop", () => {
  const h = harness(),
    a = h.join(null, { latencyMs: 75, jitterMs: 30, seed: 5 });
  h.advance(30);
  a.frame(h.nowMs());
  for (let i = 0; i < 40; i++) {
    a.recordMotion(commands, 100, 100);
    h.advance();
    const frame = a.frame(h.nowMs());
    if (frame.selfJump) break;
  }
  assert.equal(a.stats().corrections, 1);
  const own = a.frame(h.nowMs()).entities.get(a.self().entity);
  for (let i = 0; i < 30; i++) {
    a.recordMotion({ ...commands, mz: 0 }, own.fields.x, own.fields.z);
    h.advance();
    a.frame(h.nowMs());
  }
  assert.equal(a.stats().corrections, 1);
});
test("late joiners see shared props and discoveries are absent from snapshots", () => {
  const w = createWorld(1);
  stepWorld(w, { joins: [{ playerId: "a", name: "a" }] });
  w.props.get(1).fields.state = false;
  const snap = buildSnapshot(entities(w), schemas, {
    tick: 1,
    ack: 0,
    recipient: "b",
  });
  assert.equal(snap.ents.find((e) => e.id === 1).fields.state, false);
  assert.equal(JSON.stringify(snap).includes("discover"), false);
});
test("owner-only and server-only fields cannot leak through snapshots", () => {
  const spec = {
    fields: {
      public: { type: "pos", vis: "all" },
      private: { type: "pos", vis: "owner" },
      secret: { type: "pos", vis: "server" },
    },
  };
  const es = [
      {
        id: 1,
        kind: 8,
        owner: "a",
        fields: { public: 1.234, private: 2, secret: 3 },
      },
    ],
    registry = new Map([[8, spec]]);
  assert.deepEqual(
    buildSnapshot(es, registry, { tick: 1, ack: 0, recipient: "b" }).ents[0]
      .fields,
    { public: 1.23 },
  );
  assert.deepEqual(
    buildSnapshot(es, registry, { tick: 1, ack: 0, recipient: "a" }).ents[0]
      .fields,
    { public: 1.23, private: 2 },
  );
});
function player(x, ep = 0) {
  return {
    id: 3,
    kind: 1,
    fields: {
      x,
      z: 0,
      yaw: 0,
      pitch: 0,
      ep,
      lvl: 0,
      st: 0,
      carry: 0,
      name: "A",
    },
  };
}
test("snapshot timeline: interpolation, spawn/despawn, epoch jump and capped extrapolation", () => {
  const buffer = createSnapshotBuffer(schemas);
  buffer.push({ tick: 10, ents: [player(0)] });
  buffer.push({ tick: 12, ents: [player(2)] });
  assert.equal(buffer.sample(9).size, 0);
  assert.equal(buffer.sample(11).get(3).fields.x, 1);
  assert.equal(buffer.sample(1000).get(3).fields.x, 8);
  buffer.push({ tick: 14, ents: [player(50, 1)] });
  assert.equal(buffer.sample(13).get(3).fields.x, 2);
  assert.equal(buffer.sample(14).get(3).fields.x, 50);
  buffer.push({ tick: 16, ents: [] });
  assert.equal(buffer.sample(15).size, 1);
  assert.equal(buffer.sample(16).size, 0);
  assert.equal(buffer.push({ tick: 15, ents: [player(3)] }), false);
});
test("seeded conditioner preserves order, is repeatable, and stops delivery on close", () => {
  function run(close = false) {
    const h = harness(),
      c = h.connection({
        latencyMs: 75,
        jitterMs: 60,
        spikeChance: 0.5,
        spikeMs: 200,
        seed: 5,
      });
    let messages = [];
    c.onMessage((raw) => messages.push(raw));
    c.send(
      JSON.stringify({ t: "hello", v: 1, build: "x", name: "a", room: null }),
    );
    if (close) c.close();
    h.advance(60);
    return messages;
  }
  assert.deepEqual(run(), run());
  assert.equal(run(true).length, 0);
});
test("room exceptions are isolated from other rooms", () => {
  let count = 0;
  const logs = [];
  const h = harness({
    log: { info() {}, warn() {}, error: (e, d) => logs.push(e) },
    createRoom: (deps) => {
      const room = createRoom(deps);
      if (count++ === 0)
        room.tick = () => {
          throw new Error("test failure");
        };
      return room;
    },
  });
  const a = h.join(),
    b = h.join();
  h.advance(10);
  assert.equal(a.status(), "closed");
  assert.equal(b.status(), "joined");
  assert.deepEqual(logs, ["room_crashed"]);
});
test("fixed loop limits recovery work to five ticks and reports skipped ticks", () => {
  let now = 0,
    ticks = 0,
    skipped = 0;
  const loop = createFixedLoop({
    nowMs: () => now,
    tick: () => ticks++,
    log: (_, d) => (skipped += d.ticks),
  });
  now = 1000;
  loop.pump();
  assert.equal(ticks, 5);
  assert.equal(skipped, 55);
});
test("connecting clients time out even when stats roll over", () => {
  let now = 0,
    closed;
  const closeListeners = [];
  const c = createNetClient({
    nowMs: () => now,
    name: "a",
    open: () => ({
      send: () => true,
      onMessage() {},
      onClose: (fn) => closeListeners.push(fn),
      close(code, reason) {
        closed = code;
        closeListeners.forEach((fn) => fn(code, reason));
      },
    }),
  });
  for (now = 0; now <= 7000; now += 1000) c.frame(now);
  assert.equal(closed, 4004);
  assert.equal(c.status(), "closed");
});
test("world replays identically for the same commands", () => {
  const run = () => {
    const w = createWorld(42);
    stepWorld(w, { joins: [{ playerId: "a", name: "A" }] });
    let state = { x: 3, z: 10.5, vx: 0, vz: 0 };
    for (let seq = 1; seq <= 90; seq++) {
      state = stepMotion(state, commands, MAP[0]).state;
      stepWorld(w, {
        motion: new Map([
          ["a", [{ seq, ep: 0, x: state.x, z: state.z, in: commands }]],
        ]),
      });
    }
    return entities(w);
  };
  assert.deepEqual(run(), run());
});
test("client movement stays under the 8 KB/s upstream budget", () => {
  const h = harness(),
    a = h.join();
  h.advance();
  a.frame(h.nowMs());
  h.wire.length = 0;
  let state = { x: 3, z: 10.5, vx: 0, vz: 0 };
  for (let i = 0; i < 600; i++) {
    const input = {
      ...commands,
      mx: 0.123456789,
      mz: -0.987654321,
      yaw: 0.314159265,
      pitch: 0.123456789,
    };
    state = stepMotion(state, input, MAP[0]).state;
    a.recordMotion(input, state.x, state.z);
    h.advance();
    a.frame(h.nowMs());
  }
  const bytes = h.wire.reduce(
    (n, raw) => n + new TextEncoder().encode(raw).length,
    0,
  );
  assert.ok(
    bytes / 10 <= 8 * 1024,
    `Upstream ${Math.round(bytes / 10)} bytes/s exceeds budget`,
  );
});
test("late joins never spawn on a player who moved onto an unused entrance slot", () => {
  const world = createWorld(1);
  stepWorld(world, { joins: [{ playerId: "a", name: "A" }] });
  Object.assign(world.players.get("a").fields, MAP[0].spawns[1]);
  stepWorld(world, { joins: [{ playerId: "b", name: "B" }] });
  const a = world.players.get("a").fields,
    b = world.players.get("b").fields;
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.74);
});
test("repeated requests toggle shared props once and cannot impersonate another player", async () => {
  const h = harness({
    createRoom: (deps) =>
      createRoom({
        ...deps,
        sim: {
          createWorld,
          entities,
          stepWorld(world, input) {
            const result = stepWorld(world, input);
            if (world.tick === 1)
              for (const p of world.players.values())
                Object.assign(p.fields, { x: 11.6, z: -0.3 });
            return result;
          },
        },
      }),
  });
  const conn = h.connection(),
    messages = [];
  conn.onMessage((raw) => messages.push(JSON.parse(raw)));
  conn.send(
    JSON.stringify({ t: "hello", v: 1, build: "test", name: "A", room: null }),
  );
  h.advance();
  const req = JSON.stringify({
    t: "req",
    id: 1,
    action: "toggle",
    target: 1,
    playerId: "pretend-player",
  });
  conn.send(req);
  conn.send(req);
  h.advance(2);
  conn.send(req);
  h.advance(2);
  const replies = messages.filter((m) => m.t === "res");
  assert.equal(replies.length, 2);
  assert.equal(replies[0].ok, true);
  assert.deepEqual(replies[0], replies[1]);
  const snap = messages.filter((m) => m.t === "snap").at(-1);
  assert.equal(snap.ents.find((e) => e.id === 1).fields.state, false);
});
test("malformed-message flood disconnects only its sender", () => {
  const h = harness(),
    a = h.join();
  h.advance();
  const conn = h.connection();
  let code;
  conn.onClose((c) => (code = c));
  conn.send(
    JSON.stringify({
      t: "hello",
      v: 1,
      build: "test",
      name: "B",
      room: a.self().room,
    }),
  );
  h.advance();
  for (let i = 0; i < 21; i++) conn.send("{broken");
  h.advance();
  assert.equal(code, 4006);
  assert.equal(a.status(), "joined");
});
test("legal wire rounding does not cause corrections while moving around furniture", () => {
  const h = harness(),
    a = h.join();
  h.advance();
  a.frame(h.nowMs());
  let state = { x: 3, z: 10.5, vx: 0, vz: 0 };
  const rng = createRng(5);
  let input = { ...commands };
  for (let i = 0; i < 3600; i++) {
    if (i % 100 === 0)
      input = { ...commands, yaw: (rng() * 2 - 1) * Math.PI, sprint: true };
    state = stepMotion(state, input, MAP[0]).state;
    a.recordMotion(input, state.x, state.z);
    h.advance();
    a.frame(h.nowMs());
  }
  assert.equal(a.stats().corrections, 0);
});
