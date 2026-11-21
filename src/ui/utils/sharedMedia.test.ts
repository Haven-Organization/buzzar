import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import sharedMedia from "../../../res/sharedMedia.json";
import defaultWorlds from "../../../res/defaultWorlds.json";
import { BUILTIN_AVATARS } from "../../engine/avatar/avatar.common";
import { SPACE_ICON_PATH } from "./buzzarSpace";

const SHARED: Record<string, { mxc: string; sha256: string; size: number }> = sharedMedia;
const PUBLIC = join(__dirname, "../../../public");

describe("shared media (res/sharedMedia.json)", () => {
  it.each(Object.keys(SHARED))(
    "%s still matches its shared copy (else run scripts/buzzar/sync-shared-media.mjs)",
    (path) => {
      const data = readFileSync(join(PUBLIC, path));
      expect(createHash("sha256").update(data).digest("hex")).toBe(SHARED[path].sha256);
      expect(data.length).toBe(SHARED[path].size);
      expect(SHARED[path].mxc).toMatch(/^mxc:\/\/matrix\.org\/[A-Za-z0-9_-]+$/);
    }
  );

  it("covers everything Buzzar would otherwise upload for every user", () => {
    const { home, scenes } = defaultWorlds;
    const paths = [
      home.sceneUrl,
      home.scenePreviewUrl,
      home.defaultAvatar.url,
      ...scenes.flatMap((s) => [s.sceneUrl, s.scenePreviewUrl, s.defaultRoomAvatarUrl]),
      SPACE_ICON_PATH,
    ];
    for (const path of paths) expect(SHARED[path], path).toBeDefined();
  });

  it("built-in avatars point at their files' shared copies", () => {
    for (const avatar of BUILTIN_AVATARS) {
      expect(avatar.mxc, avatar.id).toBe(SHARED[avatar.path]?.mxc);
      expect(avatar.previewMxc, avatar.id).toBe(SHARED[avatar.preview]?.mxc);
    }
  });
});
