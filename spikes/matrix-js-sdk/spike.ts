/**
 * Plan 02, phase 0: does matrix-js-sdk (with its Rust crypto) work in Buzzar's Vite build, and what does it cost?
 *
 * Read-only against the homeserver: it uses an existing login with encryption off (no new device, no keys
 * uploaded), syncs, and lists world rooms. The Rust crypto engine is started separately, in memory only, with a
 * made-up device that never talks to a server, to time its WASM load and setup.
 *
 * Results land in window.spikeResult (and on the page). Not part of the app: built by vite.spike.config.ts only.
 */
import { ClientEvent, createClient, SyncState } from "matrix-js-sdk";

const out = document.getElementById("out")!;
const log = (line: string) => {
  out.textContent += "\n" + line;
};
const since = (t: number) => Math.round(performance.now() - t);

interface Login {
  homeserver: string;
  accessToken: string;
  userId: string;
  deviceId?: string;
}

async function runSpike(login: Login) {
  const result: Record<string, unknown> = {};
  const t0 = performance.now();

  // 1. Client + initial sync (encryption off).
  const client = createClient({
    baseUrl: login.homeserver,
    accessToken: login.accessToken,
    userId: login.userId,
    deviceId: login.deviceId,
  });
  const prepared = new Promise<void>((resolve, reject) => {
    client.on(ClientEvent.Sync, (state: SyncState) => {
      if (state === SyncState.Prepared) resolve();
      if (state === SyncState.Error) reject(new Error("sync error"));
    });
  });
  await client.startClient({ initialSyncLimit: 1, lazyLoadMembers: true, disablePresence: true });
  await prepared;
  result.initialSyncMs = since(t0);
  log(`initial sync: ${result.initialSyncMs} ms`);

  const rooms = client.getRooms().filter((r) => r.getMyMembership() === "join");
  const worlds = rooms.filter((r) => r.getType() === "org.matrix.msc3815.world");
  result.joinedRooms = rooms.length;
  result.worlds = worlds.map((r) => ({
    name: r.name,
    alias: r.getCanonicalAlias(),
    members: r.getJoinedMemberCount(),
    hasScene: !!r.currentState.getStateEvents("org.matrix.msc3815.world", "")?.getContent()?.scene_url,
  }));
  log(`joined rooms: ${rooms.length}, worlds: ${worlds.length}`);
  for (const w of result.worlds as { name: string; members: number }[]) log(`  ${w.name} (${w.members})`);

  // 2. What the server offers (sliding sync, authenticated media, profile fields).
  const versions = await client.getVersions();
  result.versions = versions.versions.slice(-3);
  result.simplifiedSlidingSync = !!versions.unstable_features?.["org.matrix.simplified_msc3575"];
  log(
    `server versions: ${(result.versions as string[]).join(", ")}; simplified sliding sync: ${
      result.simplifiedSlidingSync
    }`
  );
  client.stopClient();

  // 3. Rust crypto: load the WASM and set up an in-memory OlmMachine for a device that doesn't exist (no network).
  const tc = performance.now();
  const wasm = await import("@matrix-org/matrix-sdk-crypto-wasm");
  await wasm.initAsync();
  result.cryptoWasmLoadMs = since(tc);
  const tm = performance.now();
  const machine = await wasm.OlmMachine.initialize(new wasm.UserId(login.userId), new wasm.DeviceId("SPIKETEST"));
  result.olmMachineInitMs = since(tm);
  result.identityKeyOk = !!machine.identityKeys.ed25519.toBase64();
  machine.free();
  log(`crypto WASM load: ${result.cryptoWasmLoadMs} ms, OlmMachine setup: ${result.olmMachineInitMs} ms`);

  result.totalMs = since(t0);
  (window as unknown as { spikeResult: unknown }).spikeResult = result;
  log("done");
  return result;
}

(window as unknown as { runSpike: typeof runSpike }).runSpike = runSpike;
