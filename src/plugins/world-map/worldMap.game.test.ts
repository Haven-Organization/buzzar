import { GameContext } from "../../engine/GameTypes";
import { ThirdRoomModule } from "../thirdroom/thirdroom.game";
import { fileMap } from "./worldMap.game";

function ctxWith(root: unknown, buffers = new Map<number, SharedArrayBuffer>()) {
  const resource = { root, buffers, fileMap: new Map<string, string>(), baseUrl: "https://example.org/worlds/" };
  return { modules: new Map<unknown, unknown>([[ThirdRoomModule, { environmentGLTFResource: resource }]]) } as unknown as GameContext;
}

describe("a world file's own map (HAVEN_map)", () => {
  it("copies an embedded picture out of the binary chunk", async () => {
    const buffer = new SharedArrayBuffer(16);
    new Uint8Array(buffer).set([0, 0, 0, 0, 1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0]);
    const map = fileMap(
      ctxWith(
        {
          extensions: { HAVEN_map: { image: 0, min: [-10, -5], max: [10, 5] } },
          images: [{ bufferView: 0, mimeType: "image/png" }],
          bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 5 }],
        },
        new Map([[0, buffer]])
      )
    );
    expect(map).toMatchObject({ minX: -10, minZ: -5, maxX: 10, maxZ: 5 });
    expect(map?.blob?.type).toBe("image/png");
    const bytes = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(map!.blob!);
    });
    expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3, 4, 5]);
  });

  it("resolves a picture referenced by uri against the world file", () => {
    const map = fileMap(
      ctxWith({
        extensions: { HAVEN_map: { image: 0, min: [0, 0], max: [4, 4] } },
        images: [{ uri: "map.png" }],
      })
    );
    expect(map?.url).toBe("https://example.org/worlds/map.png");
  });

  it("has none without the extension, or when it points at a missing image", () => {
    expect(fileMap(ctxWith({}))).toBeUndefined();
    expect(fileMap(ctxWith({ extensions: { HAVEN_map: { image: 3, min: [0, 0], max: [1, 1] } } }))).toBeUndefined();
  });
});
