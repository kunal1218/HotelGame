import { createRoomManager } from "../shared/room/roomManager.js";
import { createLoopbackPair } from "../shared/net/transport.js";
import { withConditions, PRESETS } from "../shared/net/conditioner.js";
import { createFixedLoop } from "../shared/net/fixedLoop.js";
export function createLocalSession({
  nowMs,
  preset = "lan",
  randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n)),
}) {
  const manager = createRoomManager({ nowMs, randomBytes });
  const loop = createFixedLoop({
    nowMs,
    tick: () => {
      manager.tickAll();
      manager.sweep();
    },
  });
  const timer = setInterval(() => loop.pump(), 1000 / 120);
  return {
    open() {
      const pair = createLoopbackPair();
      manager.accept(pair.server);
      return withConditions(pair.client, {
        ...(PRESETS[preset] ?? PRESETS.lan),
        nowMs,
      });
    },
    close() {
      clearInterval(timer);
      manager.close();
    },
  };
}
