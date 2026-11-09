import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseConfig } from "./config.js";
import { createLogger } from "./log.js";
import { createStaticHandler } from "./static.js";
import { attachWsServer } from "./wsAdapter.js";
import { createRoomManager } from "../src/shared/room/roomManager.js";
import { createFixedLoop } from "../src/shared/net/fixedLoop.js";
export async function startServer(
  config,
  {
    log = createLogger((line) => process.stdout.write(line)),
    host = "0.0.0.0",
  } = {},
) {
  const nowMs = () => performance.now();
  const manager = createRoomManager({ nowMs, randomBytes, log });
  const http = createServer(createStaticHandler(config.staticDir));
  const ws = attachWsServer(http, {
    allowedOrigins: config.allowedOrigins,
    onConnection: (conn) => manager.accept(conn),
  });
  const loop = createFixedLoop({
    nowMs,
    tick: () => {
      manager.tickAll();
      manager.sweep();
    },
    log: (event, data) => log.warn(event, data),
  });
  const timer = setInterval(() => loop.pump(), 1000 / 120);
  try {
    await new Promise((resolve, reject) => {
      http.once("error", reject);
      http.listen(config.port, host, resolve);
    });
  } catch (error) {
    clearInterval(timer);
    await ws.close();
    throw error;
  }
  log.info("server_started", { port: http.address().port });
  return {
    port: http.address().port,
    manager,
    async close() {
      clearInterval(timer);
      manager.close();
      await ws.close();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const server = await startServer(parseConfig(process.env));
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, async () => {
        await server.close();
        process.exit(0);
      });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
