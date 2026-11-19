import { describe, expect, it } from "vitest";

import { remoteMediaTooBig, withLoadErrorDetails } from "./gltf.game";
import { splitLoadError } from "../../ui/views/session/world/WorldLoading";

describe("world download errors", () => {
  const remote = "https://glowers.club/_matrix/client/v1/media/download/matrix.org/HfzSryXlsDodLnXlwaGEIrLk";

  it("explains a homeserver refusing another server's big file", () => {
    expect(remoteMediaTooBig(remote, 502)).toBe(
      "This world is too big for your homeserver (glowers.club) to download."
    );
    expect(remoteMediaTooBig(remote, 413)).toBeDefined();
    expect(remoteMediaTooBig(remote, 404)).toBeUndefined();
    // Its own media: a 502 is something else.
    expect(remoteMediaTooBig("https://glowers.club/_matrix/client/v1/media/download/glowers.club/abc", 502)).toBe(
      undefined
    );
  });

  it("keeps the technical details apart for Developer Mode", () => {
    const message = withLoadErrorDetails("Too big.", "HTTP 502: Failed to fetch remote media via fallback");
    expect(splitLoadError(message)).toEqual(["Too big.", "HTTP 502: Failed to fetch remote media via fallback"]);
    expect(splitLoadError("Plain.")).toEqual(["Plain.", undefined]);
  });
});
