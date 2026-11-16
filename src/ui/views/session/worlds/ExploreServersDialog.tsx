import { FormEvent, useState } from "react";

import { Dialog } from "../../../atoms/dialog/Dialog";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { IconButton } from "../../../atoms/button/IconButton";
import { Button } from "../../../atoms/button/Button";
import { Input } from "../../../atoms/input/Input";
import { Text } from "../../../atoms/text/Text";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { normalizeServerName, saveExploreServers } from "../../../utils/worldDirectory";
import CrossIC from "../../../../../res/ic/cross.svg";

interface ExploreServersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownServer: string;
  /** Extra servers (not including your own). */
  servers: string[];
  onChange: (servers: string[]) => void;
}

/** Buzzar: the homeservers whose public world directories Explore lists (saved in account data). */
export function ExploreServersDialog({ open, onOpenChange, ownServer, servers, onChange }: ExploreServersDialogProps) {
  const { session, platform, client } = useHydrogen(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async (list: string[]) => {
    setSaving(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      await saveExploreServers(auth, session.userId, list);
      onChange(list);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = normalizeServerName(input);
    if (!name) {
      setError("That doesn't look like a homeserver name (for example matrix.org).");
      return;
    }
    if (name === ownServer || servers.includes(name)) {
      setError(`${name} is already in the list.`);
      return;
    }
    if (await save([...servers, name])) setInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-column">
        <Header
          className="shrink-0"
          left={<HeaderTitle size="lg">Explore Servers</HeaderTitle>}
          right={<IconButton iconSrc={CrossIC} onClick={() => onOpenChange(false)} label="Close" />}
        />
        <div className="flex flex-column gap-md" style={{ padding: "var(--sp-md)" }}>
          <Text variant="b3" color="surface-low">
            Explore lists the public worlds of every server here. Other servers' directories are read through your
            homeserver, so some may refuse or be slow.
          </Text>
          <div className="flex flex-column gap-xs">
            <div className="flex items-center gap-xs">
              <Text className="grow" variant="b2">
                {ownServer}
              </Text>
              <Text variant="b3" color="surface-low">
                Your server
              </Text>
            </div>
            {servers.map((server) => (
              <div key={server} className="flex items-center gap-xs">
                <Text className="grow" variant="b2">
                  {server}
                </Text>
                <Button
                  size="sm"
                  fill="none"
                  variant="danger"
                  disabled={saving}
                  onClick={() => save(servers.filter((s) => s !== server))}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <form className="flex items-center gap-xs" onSubmit={add}>
            <Input
              className="grow"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(undefined);
              }}
              placeholder="matrix.org"
              spellCheck={false}
              autoCapitalize="off"
              autoFocus
            />
            <Button type="submit" disabled={saving || !input.trim()}>
              Add
            </Button>
          </form>
          {error && (
            <Text variant="b3" color="danger">
              {error}
            </Text>
          )}
        </div>
      </div>
    </Dialog>
  );
}
