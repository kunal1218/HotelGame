import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { WebSocket } from "ws";
import { startServer } from "../server/main.js";
import { parseConfig } from "../server/config.js";
import { connectWebSocket } from "../src/net/wsConnect.js";
import { createNetClient } from "../src/net/netClient.js";
import { stepMotion } from "../src/shared/sim/motion.js";
import { MAP } from "../src/shared/sim/map.js";
const silent = { info() {}, warn() {}, error() {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 2500) {
  const start = performance.now();
  while (!fn()) {
    if (performance.now() - start > timeout) throw new Error("Timed out");
    await wait(10);
  }
}
async function server(t) {
  const s = await startServer(parseConfig({ PORT: "0" }), {
    log: silent,
    host: "127.0.0.1",
  });
  t.after(() => s.close());
  return s;
}
function client(s, name, room = null) {
  return createNetClient({
    name,
    room,
    nowMs: () => performance.now(),
    open: () => connectWebSocket(`ws://127.0.0.1:${s.port}/ws`, WebSocket),
  });
}
test("real WebSocket clients share a room, move, and leave", async (t) => {
  const s = await server(t),
    a = client(s, "Alice");
  await until(() => a.status() === "joined");
  const b = client(s, "Bob", a.self().room);
  await until(() => b.status() === "joined");
  let state = { ...a.frame(performance.now()).selfJump, vx: 0, vz: 0 };
  const input = { mx: 0, mz: -1, yaw: 0, pitch: 0, sprint: false };
  for (let i = 0; i < 30; i++) {
    state = stepMotion(state, input, MAP[0]).state;
    a.recordMotion(input, state.x, state.z);
    await wait(1000 / 60);
    a.frame(performance.now());
    b.frame(performance.now());
  }
  await wait(180);
  const remote = b.frame(performance.now()).entities.get(a.self().entity);
  assert.ok(Math.abs(remote.fields.z - state.z) < 0.1);
  assert.equal(a.stats().corrections, 0);
  a.close();
  await wait(180);
  assert.equal(b.frame(performance.now()).entities.has(a.self().entity), false);
  b.close();
});
test("WebSocket handshake rejects foreign origins and oversized payloads", async (t) => {
  const s = await server(t);
  const foreign = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, {
    origin: "https://unrelated.example",
  });
  foreign.on("error", () => {});
  await new Promise((resolve) =>
    foreign.on("unexpected-response", (_, res) => {
      assert.equal(res.statusCode, 403);
      res.resume();
      foreign.terminate();
      resolve();
    }),
  );
  const huge = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
  huge.on("error", () => {});
  await new Promise((resolve) => huge.on("open", resolve));
  huge.send("x".repeat(17000));
  const code = await new Promise((resolve) => huge.on("close", resolve));
  assert.equal(code, 1009);
});
test("static serving supports GET/HEAD and rejects traversal", async (t) => {
  const s = await server(t);
  const get = (path, method = "GET") =>
    new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: s.port, path, method },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, body, headers: res.headers }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  const home = await get("/");
  assert.equal(home.status, 200);
  assert.match(home.body, /Create room/);
  assert.equal((await get("/", "HEAD")).body, "");
  for (const path of [
    "/../package.json",
    "/%2e%2e/package.json",
    "/%2e%2e%2fpackage.json",
    "/missing.js",
  ])
    assert.equal((await get(path)).status, 404);
});
test("config rejects malformed ports and origin entries", () => {
  for (const PORT of ["-1", "abc", "65536"])
    assert.throws(() => parseConfig({ PORT }));
  assert.throws(() => parseConfig({ ORIGINS: "https://example.com/path" }));
});
