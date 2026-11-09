// @ts-check
import {
  MAX_PLAYERS,
  SNAPSHOT_EVERY,
  TICK_HZ,
  BACKPRESSURE_SKIP_BYTES,
  BACKPRESSURE_CLOSE_BYTES,
} from "../constants.js";
import { prepareSnapshot } from "../net/snapshot.js";
import { createTokenBucket } from "../net/rateLimit.js";
import * as defaultSim from "../sim/world.js";
import { schemas as defaultSchemas } from "../sim/entities.js";
const silent = { info() {}, warn() {}, error() {} };
export function createRoom({
  code,
  seed,
  nowMs,
  log = silent,
  sim = defaultSim,
  schemas = defaultSchemas,
}) {
  const world = sim.createWorld(seed),
    players = new Map();
  let nextPlayer = 1,
    emptyAt = nowMs(),
    leaves = [],
    closed = false;
  let statsAt = nowMs(),
    sentBytes = 0,
    corrections = 0,
    timings = [];
  const encoder=new TextEncoder();
  let preparedTick=-1,prepared;
  function send(p, msg) {
    const raw = JSON.stringify(msg);
    sentBytes += encoder.encode(raw).length;
    return p.conn.send(raw);
  }
  function snapshot(p) {
    if(preparedTick!==world.tick){prepared=prepareSnapshot(sim.entities(world),schemas);preparedTick=world.tick;}
    return {
      ...prepared({
        tick: world.tick,
        ack: world.players.get(p.id)?.lastSeq ?? 0,
        recipient: p.id,
      }),
      overlaps: world.overlaps ?? 0,
    };
  }
  function onMessage(p, msg) {
    if (closed || !players.has(p.id)) return;
    if (msg.t === "ping") {
      send(p, { t: "pong", c: msg.c, tick: world.tick });
      return;
    }
    if (msg.t === "in") {
      for (const cmd of msg.cmds) {
        if (!p.bucket.take()) {
          if (nowMs() - p.rateLog >= 10000) {
            log.warn("rate_limited", { room: code, player: p.id });
            p.rateLog = nowMs();
          }
          continue;
        }
        if (cmd.seq <= p.receivedSeq) continue;
        // Bound queue memory even if a sender is faster than the simulation.
        if (p.queue.length >= 120) continue;
        p.receivedSeq = cmd.seq;
        p.queue.push(cmd);
        p.lastInput = nowMs();
      }
    } else if (msg.t === "req") {
      const cached = p.replies.get(msg.id);
      if (cached && nowMs() - cached.at <= 10000) {
        send(p, cached.msg);
        return;
      }
      if (p.pending.has(msg.id)) return;
      if (!p.requestsBucket.take()) {
        send(p, { t: "res", id: msg.id, ok: false, reason: "rate_limited" });
        return;
      }
      p.pending.set(msg.id, { ...msg, playerId: p.id });
    }
  }
  return {
    join(conn, hello, resume) {
      if (closed || players.size >= MAX_PLAYERS)
        return { ok: false, close: 4002, reason: "Room is full" };
      const names = new Set([...players.values()].map((p) => p.name));
      let name = hello.name,
        suffix = 2;
      while (names.has(name)) name = `${hello.name} ${suffix++}`;
      const p = {
        id: `p${nextPlayer++}`,
        name,
        conn,
        resume,
        welcomed: false,
        queue: [],
        receivedSeq: 0,
        lastInput: nowMs(),
        rateLog: -Infinity,
        bucket: createTokenBucket(75, 75, nowMs),
        requestsBucket: createTokenBucket(10, 10, nowMs),
        pending: new Map(),
        replies: new Map(),
      };
      players.set(p.id, p);
      emptyAt = null;
      conn.onClose(() => {
        if (players.get(p.id) !== p) return;
        players.delete(p.id);
        leaves.push(p.id);
        if (!players.size) emptyAt = nowMs();
        log.info("player_left", { room: code, player: p.id });
      });
      log.info("player_joined", { room: code, player: p.id });
      return {
        ok: true,
        playerId: p.id,
        onMessage: (msg) => onMessage(p, msg),
      };
    },
    tick() {
      if (closed) return;
      const started = nowMs(),
        joins = [],
        motion = new Map(),
        starved = new Set(),
        requests = [];
      for (const p of players.values()) {
        if (!p.welcomed) joins.push({ playerId: p.id, name: p.name });
        const commands = p.queue.splice(0, p.queue.length > 4 ? 2 : 1);
        motion.set(p.id, commands);
        if (nowMs() - p.lastInput >= 1000) starved.add(p.id);
        requests.push(...p.pending.values());
        p.pending.clear();
        for (const [id, reply] of p.replies)
          if (nowMs() - reply.at > 10000) p.replies.delete(id);
      }
      const output = sim.stepWorld(world, {
        joins,
        leaves,
        motion,
        starved,
        requests,
      });
      leaves = [];
      corrections += output.corrections.length;
      for (const id of output.rejectedJoins ?? [])
        players
          .get(id)
          ?.conn.close(4002, "Entrance occupied. Try again shortly.");
      for (const p of players.values()) {
        if (!p.welcomed) {
          const entity = world.players.get(p.id);
          if (!entity) continue;
          p.welcomed = true;
          send(p, {
            t: "welcome",
            playerId: p.id,
            entity: entity.id,
            room: code,
            resume: p.resume,
            tickHz: TICK_HZ,
            snapEvery: SNAPSHOT_EVERY,
            snap: snapshot(p),
          });
        }
        const pendingBytes = p.conn.bufferedBytes();
        if (pendingBytes > BACKPRESSURE_CLOSE_BYTES) {
          p.conn.close(4008, "Connection cannot keep up");
          continue;
        }
        for (const response of output.responses.filter(
          (r) => r.playerId === p.id,
        )) {
          const { playerId, ...body } = response;
          const msg = { t: "res", ...body };
          p.replies.set(response.id, { at: nowMs(), msg });
          send(p, msg);
        }
        if (output.events.length) send(p, { t: "ev", list: output.events });
        if (
          world.tick % SNAPSHOT_EVERY === 0 &&
          pendingBytes <= BACKPRESSURE_SKIP_BYTES
        )
          send(p, { t: "snap", ...snapshot(p) });
      }
      timings.push(nowMs() - started);
      if (nowMs() - statsAt >= 10000) {
        timings.sort((a, b) => a - b);
        log.info("room_stats", {
          room: code,
          players: players.size,
          overlaps: world.overlaps,
          tickMedianMs: timings[Math.floor(timings.length / 2)],
          tickP99Ms: timings[Math.floor((timings.length - 1) * 0.99)],
          outBps: (sentBytes * 1000) / (nowMs() - statsAt),
        });
        if (corrections)
          log.warn("correction", { room: code, count: corrections });
        statsAt = nowMs();
        sentBytes = 0;
        corrections = 0;
        timings = [];
      }
    },
    connectedCount: () => players.size,
    emptySince: () => emptyAt,
    close(code = 4007, reason = "Room closed") {
      if (closed) return;
      closed = true;
      for (const p of players.values()) p.conn.close(code, reason);
      players.clear();
    },
  };
}
