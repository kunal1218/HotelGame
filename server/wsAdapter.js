import { WebSocketServer, WebSocket } from "ws";
import { MAX_MESSAGE_BYTES } from "../src/shared/constants.js";
export function attachWsServer(
  httpServer,
  { allowedOrigins = [], onConnection, nowMs = () => Date.now() },
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  let nextId = 0;
  function upgrade(req, socket, head) {
    let allowed = false;
    try {
      const origin = req.headers.origin;
      // CLI bots do not send Origin. Browsers must be same-origin, localhost, or explicitly allowed.
      const parsed = origin ? new URL(origin) : null;
      allowed =
        !origin ||
        (parsed &&
          ["http:", "https:"].includes(parsed.protocol) &&
          (parsed.host === req.headers.host ||
            ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
            allowedOrigins.includes(origin)));
    } catch {}
    if (req.url !== "/ws" || !allowed) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  }
  httpServer.on("upgrade", upgrade);
  wss.on("connection", (socket) => {
    socket.lastPong = nowMs();
    socket.on("pong", () => (socket.lastPong = nowMs()));
    socket.on("error", () => {});
    const messages = [],
      closes = [];
    socket.on("message", (data, binary) => {
      if (binary) {
        socket.close(4006, "Expected JSON text");
        return;
      }
      messages.forEach((cb) => cb(data.toString()));
    });
    socket.on("close", (code, reason) =>
      closes.forEach((cb) => cb(code, reason.toString())),
    );
    onConnection({
      id: `ws-${++nextId}`,
      send(data) {
        if (socket.readyState !== WebSocket.OPEN) return false;
        socket.send(data);
        return true;
      },
      close(code, reason) {
        if (socket.readyState < WebSocket.CLOSING) socket.close(code, reason);
      },
      bufferedBytes: () => socket.bufferedAmount,
      onMessage: (cb) => messages.push(cb),
      onClose: (cb) => closes.push(cb),
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (nowMs() - socket.lastPong > 6000) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, 2000);
  heartbeat.unref();
  return {
    close() {
      clearInterval(heartbeat);
      httpServer.off("upgrade", upgrade);
      for (const socket of wss.clients) socket.terminate();
      return new Promise((resolve) => wss.close(resolve));
    },
  };
}
