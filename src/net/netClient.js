import { MAP } from "../shared/sim/map.js";
import { quantizePosition } from "../shared/sim/collision.js";
// @ts-check
import { PROTOCOL_VERSION, decodeServer } from "../shared/net/protocol.js";
import { schemas as defaultSchemas } from "../shared/sim/entities.js";
import { createSnapshotBuffer } from "../shared/net/snapshotBuffer.js";
import { createPlayoutClock } from "../shared/net/playoutClock.js";
import { INPUT_SEND_EVERY, TICK_HZ } from "../shared/constants.js";
/** Runtime-neutral session: the browser, offline mode and headless bots share this client. */
export function createNetClient({
  open,
  url = "",
  nowMs,
  name,
  room = null,
  schemas = defaultSchemas,
}) {
  const conn = open(url),
    buffer = createSnapshotBuffer(schemas),
    clock = createPlayoutClock();
  let status = "connecting",
    self = null,
    seq = 0,
    batch = [],
    jump = null,
    requestId = 0,
    events = [],
    closedReason = "",
    rtt = 0,
    corrections = 0,
    overlaps = 0;
  const correctionTimes = [];
  let received = 0,
    sent = 0,
    snaps = 0,
    windowAt = nowMs(),
    rates = { inBps: 0, outBps: 0, snapHz: 0 },
    lastPing = -Infinity;
  const listeners = [],
    requests = new Map(),
    startedAt = nowMs();
  function send(msg) {
    const raw = JSON.stringify(msg);
    sent += new TextEncoder().encode(raw).length;
    return conn.send(raw);
  }
  function setStatus(value) {
    status = value;
    listeners.forEach((cb) => cb(value, closedReason));
  }
  function observe(snap) {
    if (buffer.push(snap)) {
      clock.observe(snap.tick, nowMs());
      overlaps = Number.isInteger(snap.overlaps) ? snap.overlaps : 0;
      snaps++;
    }
  }
  conn.onMessage((raw) => {
    received += new TextEncoder().encode(raw).length;
    const parsed = decodeServer(raw);
    if (!parsed.ok) return;
    const m = parsed.msg;
    if (m.t === "welcome") {
      if (self) return;
      const ent = m.snap.ents.find((e) => e.id === m.entity);
      if (!ent) return;
      self = {
        playerId: m.playerId,
        entity: m.entity,
        epoch: ent.fields.ep,
        level: ent.fields.lvl,
        room: m.room,
      };
      jump = { ...ent.fields };
      observe(m.snap);
      setStatus("joined");
    } else if (m.t === "snap" && self) observe(m);
    else if (m.t === "pong") rtt = nowMs() - m.c;
    else if (m.t === "res") {
      requests.get(m.id)?.resolve(m);
      requests.delete(m.id);
    } else if (m.t === "ev") events.push(...m.list);
  });
  conn.onClose((code, reason) => {
    closedReason =
      code === 4001
        ? "A new version is available. Refresh."
        : reason || "Connection closed";
    setStatus("closed");
    for (const r of requests.values())
      r.resolve({ ok: false, reason: "disconnected" });
    requests.clear();
  });
  send({ t: "hello", v: PROTOCOL_VERSION, build: "prototype", name, room });
  return {
    status: () => status,
    reason: () => closedReason,
    self: () => (self ? { ...self } : null),
    onStatus: (cb) => listeners.push(cb),
    recordMotion(input, x, z) {
      if (status !== "joined") return;
      const round = (n, precision) => Math.round(n * precision) / precision;
      const position = quantizePosition(MAP[self.level], x, z);
      batch.push({
        seq: ++seq,
        ep: self.epoch,
        in: {
          mx: round(input.mx, 1000),
          mz: round(input.mz, 1000),
          sprint: input.sprint,
          yaw: Math.max(
            -Math.PI,
            Math.min(
              Math.PI,
              round(Math.atan2(Math.sin(input.yaw), Math.cos(input.yaw)), 1000),
            ),
          ),
          pitch: round(input.pitch, 1000),
        },
        x: position.x,
        z: position.z,
        view: round(clock.sample(nowMs()), 100),
      });
      if (batch.length >= INPUT_SEND_EVERY) {
        send({ t: "in", cmds: batch });
        batch = [];
      }
    },
    request(action, target) {
      if (status !== "joined")
        return Promise.resolve({ ok: false, reason: "disconnected" });
      const id = ++requestId;
      return new Promise((resolve) => {
        requests.set(id, { resolve, at: nowMs() });
        send({
          t: "req",
          id,
          action,
          ...(target === undefined ? {} : { target }),
        });
      });
    },
    frame(now) {
      if (status === "connecting" && now - startedAt > 6000) {
        conn.close(4004, "Can't reach the hotel");
      }
      if (status === "joined" && now - lastPing >= 1000) {
        send({ t: "ping", c: now });
        lastPing = now;
      }
      for (const [id, r] of requests)
        if (now - r.at >= 3000) {
          r.resolve({ ok: false, reason: "timeout" });
          requests.delete(id);
        }
      if (now - windowAt >= 1000) {
        const seconds = (now - windowAt) / 1000;
        rates = {
          inBps: received / seconds,
          outBps: sent / seconds,
          snapHz: snaps / seconds,
        };
        received = 0;
        sent = 0;
        snaps = 0;
        windowAt = now;
      }
      const renderTick = clock.sample(now),
        entities = buffer.sample(renderTick),
        own = self && entities.get(self.entity);
      if (own && own.fields.ep !== self.epoch) {
        self.epoch = own.fields.ep;
        self.level = own.fields.lvl;
        batch = [];
        jump = { ...own.fields };
        corrections++;
        correctionTimes.push(nowMs());
      }
      const due = events.filter(
        (e) => e.tick <= renderTick || e.tick > renderTick + TICK_HZ,
      );
      events = events.filter((e) => !due.includes(e));
      due.sort((a, b) => a.tick - b.tick);
      const selfJump = jump;
      jump = null;
      return { renderTick, entities, events: due, selfJump };
    },
    stats() {
      while (correctionTimes.length && nowMs() - correctionTimes[0] > 60000)
        correctionTimes.shift();
      return {
        overlaps,
        correctionsPerMinute: correctionTimes.length,
        ...rates,
        rttMs: rtt,
        jitterMs: clock.jitterMs(),
        delayMs: clock.delayMs(),
        bufferedMs: Math.max(
          0,
          (((buffer.newestTick() ?? 0) - clock.sample(nowMs())) * 1000) /
            TICK_HZ,
        ),
        corrections,
        serverTick: buffer.newestTick() ?? 0,
        room: self?.room ?? "—",
      };
    },
    close() {
      conn.close(1000, "Left room");
    },
  };
}
