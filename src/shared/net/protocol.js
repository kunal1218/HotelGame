// @ts-check
import { MAX_MESSAGE_BYTES } from "../constants.js";
export const PROTOCOL_VERSION = 1;
export const C2S = Object.freeze({
  HELLO: "hello",
  INPUT: "in",
  REQUEST: "req",
  PING: "ping",
});
export const S2C = Object.freeze({
  WELCOME: "welcome",
  SNAPSHOT: "snap",
  EVENTS: "ev",
  RESPONSE: "res",
  PONG: "pong",
});
// t:'voice' reserved for N6; rejected until implemented.
export const CloseCode = Object.freeze({
  VERSION: 4001,
  FULL: 4002,
  NO_ROOM: 4003,
  BAD_HELLO: 4004,
  REPLACED: 4005,
  MALFORMED: 4006,
  ROOM_CLOSED: 4007,
  SLOW_CONSUMER: 4008,
});
export const ROOM_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const validCode = (code) =>
  typeof code === "string" &&
  code.length === 4 &&
  [...code].every((c) => ROOM_ALPHABET.includes(c));
const uint = (n) => Number.isSafeInteger(n) && n >= 0;
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const object = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const byteLength = (s) => new TextEncoder().encode(s).length;
function parse(raw) {
  if (typeof raw !== "string" || byteLength(raw) > MAX_MESSAGE_BYTES)
    throw new Error("size");
  const msg = JSON.parse(raw);
  if (!object(msg)) throw new Error("object");
  return msg;
}
function result(msg, ok) {
  return ok ? { ok: true, msg } : { ok: false, error: "Invalid message" };
}
export function decodeClient(raw) {
  try {
    const m = parse(raw);
    let ok = false;
    switch (m.t) {
      case "hello":
        if (typeof m.name === "string") m.name = m.name.trim();
        ok =
          uint(m.v) &&
          typeof m.build === "string" &&
          m.build.length <= 64 &&
          typeof m.name === "string" &&
          /^[\p{L}\p{N} _-]{1,16}$/u.test(m.name) &&
          (m.room === null || validCode(m.room)) &&
          (m.resume === undefined ||
            (typeof m.resume === "string" && /^[a-f0-9]{32}$/.test(m.resume)));
        break;
      case "in":
        ok =
          Array.isArray(m.cmds) &&
          m.cmds.length >= 1 &&
          m.cmds.length <= 4 &&
          m.cmds.every(
            (c) =>
              object(c) &&
              uint(c.seq) &&
              uint(c.ep) &&
              c.ep <= 65535 &&
              finite(c.x) &&
              finite(c.z) &&
              finite(c.view) &&
              object(c.in) &&
              finite(c.in.mx) &&
              Math.abs(c.in.mx) <= 1 &&
              finite(c.in.mz) &&
              Math.abs(c.in.mz) <= 1 &&
              finite(c.in.yaw) &&
              Math.abs(c.in.yaw) <= Math.PI &&
              finite(c.in.pitch) &&
              Math.abs(c.in.pitch) <= 1.35 &&
              typeof c.in.sprint === "boolean",
          );
        break;
      case "ping":
        ok = finite(m.c);
        break;
      case "req":
        ok =
          uint(m.id) &&
          typeof m.action === "string" &&
          m.action.length <= 32 &&
          (m.target === undefined || uint(m.target));
        break;
    }
    return result(m, ok);
  } catch {
    return { ok: false, error: "Invalid message" };
  }
}
export function decodeServer(raw) {
  try {
    const m = parse(raw);
    const snapshot = (s) =>
      object(s) &&
      uint(s.tick) &&
      uint(s.ack) &&
      Array.isArray(s.ents) &&
      s.ents.length <= 200 &&
      s.ents.every(
        (e) =>
          object(e) &&
          uint(e.id) &&
          uint(e.kind) &&
          object(e.fields) &&
          Object.values(e.fields).every(
            (v) =>
              typeof v === "boolean" ||
              finite(v) ||
              (typeof v === "string" && v.length <= 64),
          ),
      );
    let ok = false;
    switch (m.t) {
      case "welcome":
        ok =
          typeof m.playerId === "string" &&
          uint(m.entity) &&
          validCode(m.room) &&
          typeof m.resume === "string" &&
          m.resume.length === 32 &&
          m.tickHz === 60 &&
          m.snapEvery === 2 &&
          snapshot(m.snap);
        break;
      case "snap":
        ok = snapshot(m);
        break;
      case "pong":
        ok = finite(m.c) && uint(m.tick);
        break;
      case "res":
        ok =
          uint(m.id) &&
          typeof m.ok === "boolean" &&
          (m.reason === undefined || typeof m.reason === "string");
        break;
      case "ev":
        ok =
          Array.isArray(m.list) &&
          m.list.length <= 100 &&
          m.list.every(
            (e) => object(e) && uint(e.tick) && typeof e.k === "string",
          );
        break;
    }
    return result(m, ok);
  } catch {
    return { ok: false, error: "Invalid message" };
  }
}
