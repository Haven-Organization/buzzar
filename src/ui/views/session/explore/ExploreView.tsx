import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSetAtom } from "jotai";

import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Icon } from "../../../atoms/icon/Icon";
import { Input } from "../../../atoms/input/Input";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { Window } from "../../components/window/Window";
import { RoomPreviewCard } from "../../components/room-preview-card/RoomPreviewCard";
import { DiscoverGroupGrid } from "../../components/discover-group/DiscoverGroup";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { getAvatarHttpUrl, getIdentifierColorNumber } from "../../../utils/avatar";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { DirectoryWorld, fetchWorldDirectory, joinDirectoryWorld, serverNameOf } from "../../../utils/worldDirectory";
import { overlayWorldAtom } from "../../../state/overlayWorld";
import { SidebarTab, sidebarTabAtom } from "../../../state/sidebarTab";
import { OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import ExploreIC from "../../../../../res/ic/explore.svg";
import "./ExploreView.css";

const SERVER_KEY = "software.haven.explore.server";

function loadServer(fallback: string) {
  try {
    return localStorage.getItem(SERVER_KEY) || fallback;
  } catch {
    return fallback;
  }
}

function saveServer(server: string) {
  try {
    localStorage.setItem(SERVER_KEY, server);
  } catch {
    // storage unavailable
  }
}

/** Explore: public worlds in a homeserver's room directory (your own by default). */
export function ExploreView() {
  const { session, platform, client } = useHydrogen(true);
  const ownServer = serverNameOf(session.userId);

  const [serverInput, setServerInput] = useState(() => loadServer(ownServer));
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState({ server: serverInput.trim() || ownServer, search: "" });

  const [worlds, setWorlds] = useState<DirectoryWorld[]>([]);
  const [nextBatch, setNextBatch] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (since?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const auth = await getSessionAuth(platform, client.sessionId);
        if (!auth) throw new Error("Not signed in");
        const page = await fetchWorldDirectory(auth, {
          server: query.server === ownServer ? undefined : query.server,
          search: query.search || undefined,
          since,
        });
        setWorlds((current) => (since ? [...current, ...page.worlds] : page.worlds));
        setNextBatch(page.nextBatch);
      } catch (e) {
        if (!since) setWorlds([]);
        setNextBatch(undefined);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [platform, client, query, ownServer]
  );

  useEffect(() => {
    load();
  }, [load]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const server = serverInput.trim() || ownServer;
    setServerInput(server);
    saveServer(server);
    setQuery({ server, search: searchInput.trim() });
  };

  const useOwnServer = () => {
    setServerInput(ownServer);
    saveServer(ownServer);
    setQuery({ server: ownServer, search: searchInput.trim() });
  };

  return (
    <Window className="ExploreView">
      <Content
        top={
          <Header
            left={
              <HeaderTitle icon={<Icon color="surface" className="shrink-0" src={ExploreIC} />}>Explore</HeaderTitle>
            }
          />
        }
      >
        <form className="ExploreView__toolbar flex items-end gap-xs" onSubmit={submit}>
          <label className="ExploreView__field flex flex-column gap-xxs">
            <Text variant="b3" weight="semi-bold">
              Homeserver
            </Text>
            <Input
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              placeholder={ownServer}
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
          <label className="ExploreView__field ExploreView__field--grow flex flex-column gap-xxs">
            <Text variant="b3" weight="semi-bold">
              Search
            </Text>
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="World name or topic"
            />
          </label>
          <Button type="submit" disabled={loading}>
            Search
          </Button>
          {query.server !== ownServer && (
            <Button fill="outline" onClick={useOwnServer} disabled={loading}>
              My server
            </Button>
          )}
        </form>

        <Scroll type="hover">
          <div className="ExploreView__results flex flex-column gap-sm">
            <Text variant="b3">
              Public worlds listed on <b>{query.server}</b>
              {query.search ? <> matching “{query.search}”</> : null}
            </Text>

            {error && (
              <Text variant="b2" className="ExploreView__error">
                {error}
              </Text>
            )}

            {!error && !loading && worlds.length === 0 && (
              <Text variant="b2">
                No public worlds found. World owners can list a world here by making it public when they create it.
              </Text>
            )}

            <DiscoverGroupGrid itemMinWidth={380}>
              {worlds.map((world) => (
                <ExploreWorldCard
                  key={world.room_id}
                  world={world}
                  viaServer={query.server === ownServer ? undefined : query.server}
                />
              ))}
            </DiscoverGroupGrid>

            {loading && <Dots size="md" />}
            {!loading && nextBatch && (
              <Button fill="outline" onClick={() => load(nextBatch)}>
                Load more
              </Button>
            )}
          </div>
        </Scroll>
      </Content>
    </Window>
  );
}

function ExploreWorldCard({ world, viaServer }: { world: DirectoryWorld; viaServer?: string }) {
  const { session, platform, client } = useHydrogen(true);
  const selectWorld = useSetAtom(overlayWorldAtom);
  const setSidebarTab = useSetAtom(sidebarTabAtom);
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const [joining, setJoining] = useState(false);
  const [joinedId, setJoinedId] = useState<string>();
  const [error, setError] = useState<string>();

  const roomId = joinedId ?? world.room_id;
  const isJoined = !!joinedId || !!session.rooms.get(world.room_id);
  const name = world.name || world.canonical_alias || world.room_id;

  const view = () => {
    selectWorld(roomId);
    setSidebarTab(SidebarTab.Home);
    setOverlayWindow({ type: OverlayWindow.None });
  };

  const join = async () => {
    setJoining(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      setJoinedId(await joinDirectoryWorld(auth, world, viaServer));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJoining(false);
    }
  };

  return (
    <RoomPreviewCard
      avatar={
        <Avatar
          imageSrc={world.avatar_url && getAvatarHttpUrl(world.avatar_url, 60, platform, session.mediaRepository)}
          shape="circle"
          size="lg"
          bgColor={`var(--usercolor${getIdentifierColorNumber(world.room_id)})`}
          name={name}
        />
      }
      name={name}
      desc={error ?? world.topic}
      memberCount={world.num_joined_members}
      options={
        isJoined ? (
          <Button variant="secondary" fill="outline" size="sm" onClick={view}>
            View
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={joining} onClick={join}>
            {joining && <Dots size="sm" color="on-secondary" />}
            {joining ? "Joining" : "Join"}
          </Button>
        )
      }
    />
  );
}
