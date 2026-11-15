import { ChangeEvent, useEffect, useRef, useState } from "react";

import { Button } from "../../../atoms/button/Button";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { getSessionAuth, uploadMedia } from "../../../utils/avatarMatrix";
import {
  BANNER_KEY,
  fetchProfileExtras,
  PRONOUNS_KEY,
  PRONOUNS_UNSTABLE_KEY,
  setProfileField,
} from "../../../utils/profileExtras";
import "./ProfileExtrasSettings.css";

const MAX_BANNER_BYTES = 5 * 1024 * 1024;

/** Buzzar: pronouns and a profile banner, shown on your name tag in worlds. Saved to your Matrix profile. */
export function ProfileExtrasSettings() {
  const { session, platform, client } = useHydrogen(true);
  const [pronouns, setPronouns] = useState("");
  const [savedPronouns, setSavedPronouns] = useState("");
  const [banner, setBanner] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) return;
      const extras = await fetchProfileExtras(auth, session.userId, true);
      if (cancelled) return;
      setPronouns(extras.pronouns ?? "");
      setSavedPronouns(extras.pronouns ?? "");
      setBanner(extras.bannerUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, platform, client]);

  const run = async (
    what: string,
    fn: (auth: NonNullable<Awaited<ReturnType<typeof getSessionAuth>>>) => Promise<void>
  ) => {
    setBusy(true);
    setStatus(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      await fn(auth);
      setStatus({ text: `${what} saved.` });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const savePronouns = () =>
    run("Pronouns", async (auth) => {
      const value = pronouns.trim().slice(0, 40);
      const field = value ? [{ language: "en", summary: value }] : undefined;
      // The unstable key is what other clients read today; the stable one is set too where the server allows.
      await setProfileField(auth, session.userId, PRONOUNS_UNSTABLE_KEY, field);
      await setProfileField(auth, session.userId, PRONOUNS_KEY, field).catch(() => undefined);
      setSavedPronouns(value);
    });

  const pickBanner = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setStatus({ text: "Choose an image file.", error: true });
    if (file.size > MAX_BANNER_BYTES) return setStatus({ text: "Banner images can be up to 5 MB.", error: true });
    await run("Banner", async (auth) => {
      const url = await uploadMedia(auth, file, file.name);
      await setProfileField(auth, session.userId, BANNER_KEY, url);
      setBanner(url);
    });
  };

  const removeBanner = () =>
    run("Banner", async (auth) => {
      await setProfileField(auth, session.userId, BANNER_KEY, undefined);
      setBanner(undefined);
    });

  const bannerPreview = banner ? session.mediaRepository.mxcUrlThumbnail(banner, 480, 160, "crop") : undefined;

  return (
    <SettingTile className="grow basis-0" label={<Label>Name Tag</Label>}>
      <div className="ProfileExtrasSettings flex flex-column gap-xs">
        <div className="flex items-center gap-xs">
          <Input
            placeholder="Pronouns (e.g. she/her)"
            value={pronouns}
            maxLength={40}
            onChange={(e) => setPronouns(e.currentTarget.value)}
            // This sits inside the settings form; Enter saves pronouns instead of submitting it.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (!busy && pronouns.trim() !== savedPronouns) savePronouns();
            }}
          />
          <Button size="sm" fill="outline" disabled={busy || pronouns.trim() === savedPronouns} onClick={savePronouns}>
            Save
          </Button>
        </div>
        <div
          className="ProfileExtrasSettings__banner"
          style={bannerPreview ? { backgroundImage: `url("${bannerPreview}")` } : undefined}
        >
          {!bannerPreview && (
            <Text variant="b3" color="surface-low">
              No banner
            </Text>
          )}
        </div>
        <div className="flex items-center gap-xs">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickBanner} />
          <Button size="sm" fill="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            {banner ? "Change Banner" : "Upload Banner"}
          </Button>
          {banner && (
            <Button size="sm" fill="none" variant="danger" disabled={busy} onClick={removeBanner}>
              Remove
            </Button>
          )}
        </div>
        <Text variant="b3" color={status?.error ? "danger" : "surface-low"}>
          {status?.text ?? "Shown with your name above your head in worlds. Saved to your Matrix profile."}
        </Text>
      </div>
    </SettingTile>
  );
}
