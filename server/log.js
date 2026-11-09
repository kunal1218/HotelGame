export function createLogger(write) {
  return Object.fromEntries(
    ["info", "warn", "error"].map((level) => [
      level,
      (event, fields = {}) =>
        write(
          JSON.stringify({
            ts: new Date().toISOString(),
            level,
            event,
            ...fields,
          }) + "\n",
        ),
    ]),
  );
}
