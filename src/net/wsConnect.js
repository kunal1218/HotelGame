// @ts-check
/** WebSocket implementation is injected for Node bots/tests; browsers use the native API. */
export function connectWebSocket(url, WebSocketImpl = globalThis.WebSocket) {
  const socket = new WebSocketImpl(url),
    messages = [],
    closes = [],
    queue = [];
  let ended = false;
  socket.addEventListener("open", () => {
    for (const raw of queue) socket.send(raw);
    queue.length = 0;
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string")
      messages.forEach((cb) => cb(event.data));
  });
  socket.addEventListener("error", () => {}); // close reports the readable failure; prevents unhandled Node errors.
  socket.addEventListener("close", (event) => {
    ended = true;
    queue.length = 0;
    closes.forEach((cb) => cb(event.code, event.reason));
  });
  return {
    id: "websocket",
    send(data) {
      if (ended || socket.readyState > 1) return false;
      if (socket.readyState === 0) queue.push(data);
      else socket.send(data);
      return true;
    },
    close(code = 1000, reason = "Left room") {
      if (ended) return;
      ended = true;
      queue.length = 0;
      socket.close(code, reason);
    },
    bufferedBytes: () =>
      socket.bufferedAmount +
      queue.reduce((n, s) => n + new TextEncoder().encode(s).length, 0),
    onMessage: (cb) => messages.push(cb),
    onClose: (cb) => closes.push(cb),
  };
}
export function serverUrl(location, configured) {
  const url = new URL(location.href),
    override = url.searchParams.get("server") || configured;
  const target = override ? new URL(override) : new URL("/ws", url);
  if (!override) target.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (!["ws:", "wss:"].includes(target.protocol))
    throw new Error("Server address must use ws:// or wss://");
  if (url.protocol === "https:" && target.protocol !== "wss:")
    throw new Error("Secure pages need a wss:// server");
  return target.href;
}
