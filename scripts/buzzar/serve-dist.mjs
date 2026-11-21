// Buzzar: serves a built copy (e.g. dist-next) with SPA fallback and the cross-origin isolation headers the engine
// needs, for trying a branch next to the installed app. Usage: node scripts/buzzar/serve-dist.mjs <dir> <port>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const [root, port] = [process.argv[2], +process.argv[3]];
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".vrm": "model/gltf-binary",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".hdr": "application/octet-stream",
  ".woff2": "font/woff2",
};
createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  let file = join(root, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(root, "index.html");
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log("serving", root, "on", port));
