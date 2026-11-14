import { appendFileSync } from "fs";
import path from "path";

import type { Plugin } from "vite";

/**
 * Buzzar dev-only: POST /__buzzar/debug-log appends the request body (one JSON object per line) to
 * `.buzzar-debug.log` in the project root, so debug traces from any browser can be read without devtools.
 * Only active in `vite dev`; never part of a build.
 */
export function buzzarDebugLog(): Plugin {
  const file = path.resolve(__dirname, "../../.buzzar-debug.log");
  return {
    name: "buzzar-debug-log",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__buzzar/debug-log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy();
        });
        req.on("end", () => {
          try {
            for (const line of body.split("\n")) if (line.trim()) appendFileSync(file, line.trim() + "\n");
          } catch (error) {
            console.error("buzzar debug log write failed", error);
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}
