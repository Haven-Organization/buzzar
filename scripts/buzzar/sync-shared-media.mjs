#!/usr/bin/env node
/**
 * Buzzar: keeps res/sharedMedia.json in step with the bundled files it lists.
 *
 * Bundled files that rooms or profiles point at (the Home World, the space icon, built-in avatars) are used from one
 * shared copy on matrix.org instead of being uploaded to every user's homeserver (some don't allow
 * uploads at all). This uploads each listed file whose sha256 no longer matches its entry, as the stock account, and
 * rewrites the entry. The test sharedMedia.test.ts fails while any entry is stale.
 *
 * Usage: PORKYHORSE_TOKEN=… node scripts/buzzar/sync-shared-media.mjs [--add public/path/to/file]…
 *   (or put it in ~/.config/claude-agent/matrix-tokens.env as PORKYHORSE_TOKEN)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const MANIFEST = join(ROOT, "res/sharedMedia.json");
const HOMESERVER = "https://matrix-client.matrix.org";
const TYPES = { ".glb": "model/gltf-binary", ".vrm": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg" };

let token = process.env.PORKYHORSE_TOKEN;
const envFile = join(homedir(), ".config/claude-agent/matrix-tokens.env");
if (!token && existsSync(envFile))
  token = /^PORKYHORSE_TOKEN=["']?([^"'\n]+)/m.exec(readFileSync(envFile, "utf8"))?.[1];

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--add") {
    const path = "/" + args[++i].replace(/^public\//, "").replace(/^\//, "");
    manifest[path] ??= { mxc: "", sha256: "", size: 0 };
  }
}

let changed = 0;
for (const [path, entry] of Object.entries(manifest)) {
  const data = readFileSync(join(ROOT, "public", path));
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (entry.sha256 === sha256 && entry.mxc) continue;
  if (!token) throw new Error("Set PORKYHORSE_TOKEN to upload changed files");
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  const name = path.split("/").pop();
  const res = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": type },
    body: data,
  });
  if (!res.ok) throw new Error(`Uploading ${path} failed: ${res.status} ${await res.text()}`);
  const { content_uri: mxc } = await res.json();
  manifest[path] = { mxc, sha256, size: data.length };
  console.log(`${path} → ${mxc}`);
  changed++;
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
console.log(changed ? `updated ${changed} file(s)` : "all shared media up to date");
