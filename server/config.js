import { resolve } from "node:path";
export function parseConfig(env) {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be an integer from 0 to 65535");
  const allowedOrigins = (env.ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
      throw new Error(
        "ORIGINS must contain exact http(s) origins separated by commas",
      );
  }
  return { port, allowedOrigins, staticDir: resolve(env.STATIC ?? "dist") };
}
