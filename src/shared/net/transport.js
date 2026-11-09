// @ts-check
export function createLoopbackPair({
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  let closed = false;
  const listeners = [[], []],
    closes = [[], []],
    bytes = [0, 0];
  const ends = [0, 1].map((i) => ({
    id: `local-${i}`,
    send(data) {
      if (closed) return false;
      const size = new TextEncoder().encode(data).length;
      bytes[i] += size;
      schedule(() => {
        bytes[i] -= size;
        if (!closed) for (const cb of listeners[1 - i]) cb(data);
      }, 0);
      return true;
    },
    close(code = 1000, reason = "closed") {
      if (closed) return;
      closed = true;
      schedule(() => {
        for (const list of closes) for (const cb of list) cb(code, reason);
      }, 0);
    },
    bufferedBytes: () => bytes[i],
    onMessage: (cb) => listeners[i].push(cb),
    onClose: (cb) => closes[i].push(cb),
  }));
  return { client: ends[0], server: ends[1] };
}
