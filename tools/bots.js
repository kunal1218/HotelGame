import { createNetClient } from "../src/net/netClient.js";
import { connectWebSocket } from "../src/net/wsConnect.js";
import { MAP } from "../src/shared/sim/map.js";
import { stepMotion, emptySqueeze } from "../src/shared/sim/motion.js";
import { createRng } from "../src/shared/sim/rng.js";
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, arg, i, list) =>
        arg.startsWith("--") ? [...pairs, [arg.slice(2), list[i + 1]]] : pairs,
      [],
    ),
);
const count = Number(args.count ?? 4),
  url = args.server ?? "ws://localhost:8787/ws";
if (!args.room || !Number.isInteger(count) || count < 1 || count > 4) {
  console.error(
    "Usage: npm run bots -- --room QXJT --count 4 [--server ws://localhost:8787/ws]",
  );
  process.exit(1);
}
const bots = Array.from({ length: count }, (_, i) => {
  const client = createNetClient({
    open: () => connectWebSocket(url),
    nowMs: () => performance.now(),
    name: `Bot ${i + 1}`,
    room: args.room.toUpperCase(),
  });
  client.onStatus((status) =>
    console.log(
      `Bot ${i + 1}: ${status}${status === "closed" ? " — " + client.reason() : ""}`,
    ),
  );
  return {
    client,
    rng: createRng(i + 1),
    state: null,
    heading: 0,
    ticks: 0,
    squeeze: emptySqueeze(),
  };
});
const timer = setInterval(() => {
  for (const bot of bots) {
    const frame = bot.client.frame(performance.now());
    if (frame.selfJump) bot.state = { ...frame.selfJump, vx: 0, vz: 0 };
    if (!bot.state || bot.client.status() !== "joined") continue;
    if (bot.ticks++ % 90 === 0) bot.heading = (bot.rng() * 2 - 1) * Math.PI;
    const input = { mx: 0, mz: -1, yaw: bot.heading, pitch: 0, sprint: false };
    const obstacles = [...frame.entities.values()]
      .filter(
        (e) =>
          e.kind === 1 &&
          e.id !== bot.client.self().entity &&
          [0, 2].includes(e.fields.st),
      )
      .map((e) => ({ id: e.id, x: e.fields.x, z: e.fields.z, r: 0.32 }));
    const next = stepMotion(
      bot.state,
      input,
      MAP[0],
      obstacles,
      bot.squeeze,
      bot.client.self().entity,
    );
    bot.state = next.state;
    bot.squeeze = next.squeeze;
    bot.client.recordMotion(input, bot.state.x, bot.state.z);
  }
  if (bots.every((b) => b.client.status() === "closed")) clearInterval(timer);
}, 1000 / 60);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    clearInterval(timer);
    bots.forEach((b) => b.client.close());
  });
