import { describe, expect, it } from "vitest";

import { makeAssetMetadata, readAssetMetadata } from "./assetMetadata";

describe("asset metadata", () => {
  it("reads HAVEN_metadata, keeping a multi-line description", () => {
    const meta = readAssetMetadata({
      extensions: {
        HAVEN_metadata: {
          name: "Haru Urara",
          description: "Line one.\nLine two.",
          author: "Someone",
          sourceUrl: "https://example.org/model",
          version: "1.2",
        },
      },
    });
    expect(meta).toEqual({
      name: "Haru Urara",
      description: "Line one.\nLine two.",
      author: "Someone",
      sourceUrl: "https://example.org/model",
      version: "1.2",
    });
  });

  it("falls back to Sketchfab's asset.extras and VRM meta", () => {
    expect(
      readAssetMetadata({
        asset: {
          extras: {
            title: "Trampoline",
            author: "1-3D.com (https://sketchfab.com/1-3D.com)",
            source: "https://sketchfab.com/3d-models/trampoline-052aaef6c5c34c5bac94607bcc12d2f9",
          },
        },
      })
    ).toEqual({
      name: "Trampoline",
      author: "1-3D.com",
      sourceUrl: "https://sketchfab.com/3d-models/trampoline-052aaef6c5c34c5bac94607bcc12d2f9",
    });
    expect(
      readAssetMetadata({ extensions: { VRMC_vrm: { meta: { name: "Rose", authors: ["A", "B"], version: "2" } } } })
    ).toEqual({ name: "Rose", author: "A, B", version: "2" });
  });

  it("ignores links that aren't web pages", () => {
    expect(readAssetMetadata({ extensions: { HAVEN_metadata: { sourceUrl: "javascript:alert(1)" } } })).toEqual({});
  });
});

describe("a Thing's controls", () => {
  it("reads controls by action, skipping unknown actions and empty labels (untrusted)", () => {
    const meta = readAssetMetadata({
      extensions: {
        HAVEN_metadata: {
          name: "Water Gun",
          controls: [
            { action: "use", label: "Spray (hold)" },
            { action: "teleport", label: "Nope" },
            { action: "secondary", label: "  " },
            { action: "secondary", label: "Pump" },
            "drop",
          ],
        },
      },
    });
    expect(meta.controls).toEqual([
      { action: "use", label: "Spray (hold)" },
      { action: "secondary", label: "Pump" },
    ]);
    // Saving other details into the file keeps them.
    expect(makeAssetMetadata({ ...meta, version: "2" }).controls).toEqual(meta.controls);
  });
});
