/**
 * Buzzar: Settings → Safety → the people you've blocked (Matrix's ignore list: ui/hooks/useBlockedUsers.ts), to
 * unblock them.
 */
import { useState } from "react";

import { SettingTile } from "../../components/setting-tile/SettingTile";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Button } from "../../../atoms/button/Button";
import { useBlockedUsers } from "../../../hooks/useBlockedUsers";

export function BlockedPeopleSettings() {
  const { blocked, unblock } = useBlockedUsers();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const doUnblock = async (userId: string) => {
    setBusy(userId);
    setError(undefined);
    try {
      await unblock(userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <SettingTile label={<Label>Blocked People</Label>}>
      <Text variant="b3" color="surface-low">
        Block someone from the ⋯ menu next to their name in a world&apos;s People list. In worlds you don&apos;t see or
        hear each other, and nothing of yours is sent to them. Blocks are saved with your Matrix account, so other apps
        (like Element) hide their messages too.
      </Text>
      {blocked.length === 0 ? (
        <Text variant="b3">You haven&apos;t blocked anyone.</Text>
      ) : (
        <div className="flex flex-column gap-xs">
          {blocked.map((userId) => (
            <div key={userId} className="flex items-center gap-sm">
              <Text className="grow truncate" variant="b2">
                {userId}
              </Text>
              <Button size="sm" fill="outline" onClick={() => doUnblock(userId)} disabled={busy === userId}>
                {busy === userId ? "Unblocking…" : "Unblock"}
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <Text variant="b3" color="danger">
          {error}
        </Text>
      )}
    </SettingTile>
  );
}
