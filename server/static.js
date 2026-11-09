import { resolve, sep, extname } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
export function createStaticHandler(dir) {
  return async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    try {
      const path = decodeURIComponent(req.url.split("?")[0]);
      if (
        path.includes("\\") ||
        path.includes("\0") ||
        path.split("/").includes("..")
      )
        throw new Error("Invalid path");
      const root = await realpath(dir),
        file = await realpath(
          resolve(root, "." + (path === "/" ? "/index.html" : path)),
        );
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile())
        throw new Error("Outside root");
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  };
}
