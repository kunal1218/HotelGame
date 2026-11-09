// @ts-check
import {
  decodeClient,
  PROTOCOL_VERSION,
  ROOM_ALPHABET,
} from "../net/protocol.js";
import { createRoom as defaultCreateRoom } from "./room.js";
import {
  HELLO_TIMEOUT_MS,
  ROOM_IDLE_CLOSE_MS,
  MAX_ROOMS,
} from "../constants.js";
const silent = { info() {}, warn() {}, error() {} };
export function createRoomManager({
  nowMs,
  randomBytes,
  log = silent,
  createRoom = defaultCreateRoom,
  maxRooms = MAX_ROOMS,
}) {
  const rooms = new Map(),
    pending = new Map();
  const randomCode = () =>
    Array.from(
      randomBytes(4),
      (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length],
    ).join("");
  const token = () =>
    Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
  function reject(conn, code, reason) {
    log.warn("hello_rejected", { code });
    pending.delete(conn);
    conn.close(code, reason);
  }
  return {
    accept(conn) {
      let joined = null,
        done = false,
        bad = [];
      pending.set(conn, nowMs());
      log.info("conn_open", {});
      conn.onClose(() => {
        pending.delete(conn);
        done = true;
      });
      conn.onMessage((raw) => {
        if (done) return;
        const parsed = decodeClient(raw);
        if (!parsed.ok) {
          if (!joined) {
            reject(conn, 4004, "Invalid room request");
            done = true;
            return;
          }
          bad = bad.filter((t) => nowMs() - t < 10000);
          bad.push(nowMs());
          if (bad.length === 1) log.warn("malformed_message", {});
          if (bad.length > 20) {
            done = true;
            conn.close(4006, "Too many invalid messages");
          }
          return;
        }
        const msg = parsed.msg;
        if (joined) {
          if (msg.t === "hello") {
            conn.close(4004, "Already joined");
            done = true;
          } else joined.onMessage(msg);
          return;
        }
        if (msg.t !== "hello") {
          reject(conn, 4004, "Expected room request");
          done = true;
          return;
        }
        if (msg.v !== PROTOCOL_VERSION) {
          reject(conn, 4001, `Protocol ${PROTOCOL_VERSION}: refresh to update`);
          done = true;
          return;
        }
        if (msg.resume) {
          reject(conn, 4003, "Room closed; create a new room");
          done = true;
          return;
        }
        let room = msg.room && rooms.get(msg.room);
        if (msg.room && !room) {
          reject(conn, 4003, "Room not found");
          done = true;
          return;
        }
        if (!room) {
          if (rooms.size >= maxRooms) {
            reject(conn, 4002, "Server is full");
            done = true;
            return;
          }
          let code;
          for (let tries = 0; tries < 100; tries++) {
            const candidate = randomCode();
            if (!rooms.has(candidate)) {
              code = candidate;
              break;
            }
          }
          if (!code) {
            reject(conn, 4002, "No room codes available");
            done = true;
            return;
          }
          const seed = randomBytes(4).reduce((n, b) => (n * 256 + b) >>> 0, 0);
          room = createRoom({ code, seed, nowMs, log });
          rooms.set(code, room);
          log.info("room_created", { room: code });
        }
        joined = room.join(conn, msg, token());
        if (!joined.ok) {
          reject(conn, joined.close, joined.reason);
          done = true;
        } else pending.delete(conn);
      });
    },
    tickAll() {
      for (const [code, room] of rooms) {
        try {
          room.tick();
        } catch (error) {
          log.error("room_crashed", {
            room: code,
            stack: String(error.stack ?? error),
          });
          room.close();
          rooms.delete(code);
        }
      }
    },
    sweep() {
      for (const [conn, since] of pending)
        if (nowMs() - since >= HELLO_TIMEOUT_MS)
          reject(conn, 4004, "Room request timed out");
      for (const [code, room] of rooms)
        if (
          room.emptySince() !== null &&
          nowMs() - room.emptySince() >= ROOM_IDLE_CLOSE_MS
        ) {
          room.close();
          rooms.delete(code);
          log.info("room_closed", { room: code });
        }
    },
    close() {
      for (const conn of pending.keys()) conn.close(4007, "Server stopped");
      pending.clear();
      for (const room of rooms.values()) room.close();
      rooms.clear();
    },
    stats: () => ({
      rooms: rooms.size,
      players: [...rooms.values()].reduce(
        (sum, r) => sum + r.connectedCount(),
        0,
      ),
    }),
  };
}
