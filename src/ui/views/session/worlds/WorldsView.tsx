/**
 * Buzzar: the Worlds screen. "Your Worlds" shows the worlds you've joined and "Explore" shows the public worlds in
 * the room directories of your homeserver and any others you add, all as big picture tiles.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { GroupCall, Room } from "@thirdroom/hydrogen-view-sdk";
import { useAtom, useAtomValue, useSetAtom } from "jotai";

import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Icon } from "../../../atoms/icon/Icon";
import { IconButton } from "../../../atoms/button/IconButton";
import { Input } from "../../../atoms/input/Input";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { DropdownMenu } from "../../../atoms/menu/DropdownMenu";
import { DropdownMenuItem } from "../../../atoms/menu/DropdownMenuItem";
import { Checkbox } from "../../../atoms/checkbox/Checkbox";
import { SegmentControl } from "../../../atoms/segment-control/SegmentControl";
import { SegmentControlItem } from "../../../atoms/segment-control/SegmentControlItem";
import { Window } from "../../components/window/Window";
import { TileFallback, WorldTile, WorldTileGrid } from "../../components/world-tile/WorldTile";
import { WorldTileMembers } from "../sidebar/WorldTileMembers";
import { EnterWorldButton } from "../overlay/WorldPreview";
import { InviteDialog } from "../dialogs/InviteDialog";
import { JoinWithAliasDialog } from "../dialogs/JoinWithAliasDialog";
import { ExploreServersDialog } from "./ExploreServersDialog";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { useRoomsOfType, RoomTypes } from "../../../hooks/useRoomsOfType";
import { useCalls } from "../../../hooks/useCalls";
import { useRoom } from "../../../hooks/useRoom";
import { useDialog } from "../../../hooks/useDialog";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { markGameResumed, requestGamePointerLock } from "../../../utils/pointerLock";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { copyToClipboard } from "../../../utils/common";
import {
  DirectoryWorld,
  fetchExploreServers,
  fetchWorldDirectory,
  fetchWorldPreviewUrl,
  joinDirectoryWorld,
  serverNameOf,
  worldLink,
} from "../../../utils/worldDirectory";
import { worldAtom } from "../../../state/world";
import { overlayVisibilityAtom } from "../../../state/overlayVisibility";
import { activeChatsAtom } from "../../../state/overlayChat";
import { OverlayWindow, overlayWindowAtom, WorldsTab } from "../../../state/overlayWindow";
import { sidebarTabAtom, SidebarTab } from "../../../state/sidebarTab";
import { developerModeAtom } from "../../../state/developerMode";
import PlanetIC from "../../../../../res/ic/planet.svg";
import AddIC from "../../../../../res/ic/add.svg";

const TILE_IMAGE = { width: 640, height: 360 };

function useThumbnail(mxcOrHttp: string | undefined) {
  const { session } = useHydrogen(true);
  if (!mxcOrHttp) return undefined;
  if (!mxcOrHttp.startsWith("mxc:")) return mxcOrHttp;
  return session.mediaRepository.mxcUrlThumbnail(mxcOrHttp, TILE_IMAGE.width, TILE_IMAGE.height, "scale") ?? undefined;
}

export function WorldsView() {
  const [overlayWindow, setOverlayWindow] = useAtom(overlayWindowAtom);
  const tab: WorldsTab = (overlayWindow.type === OverlayWindow.Worlds && overlayWindow.tab) || "yours";
  const setTab = (value: WorldsTab) => setOverlayWindow({ type: OverlayWindow.Worlds, tab: value });
  const join = useDialog(false);

  return (
    <Window className="TileScreen">
      <Content
        top={
          <Header
            left={<HeaderTitle icon={<Icon color="surface" className="shrink-0" src={PlanetIC} />}>Worlds</HeaderTitle>}
            right={
              <>
                <Dialog open={join.open} onOpenChange={join.setOpen}>
                  <JoinWithAliasDialog requestClose={join.closeDialog} />
                </Dialog>
                <DropdownMenu
                  align="end"
                  content={
                    <>
                      <DropdownMenuItem onSelect={() => setOverlayWindow({ type: OverlayWindow.CreateWorld })}>
                        Create World
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={join.openDialog}>Join with Alias</DropdownMenuItem>
                    </>
                  }
                >
                  <IconButton label="Add" iconSrc={AddIC} />
                </DropdownMenu>
              </>
            }
          />
        }
      >
        <div className="TileScreen__bar flex items-center gap-sm">
          <SegmentControl>
            <SegmentControlItem value="yours" isSelected={tab === "yours"} onSelect={setTab}>
              Your Worlds
            </SegmentControlItem>
            <SegmentControlItem value="explore" isSelected={tab === "explore"} onSelect={setTab}>
              Explore
            </SegmentControlItem>
          </SegmentControl>
        </div>
        {tab === "yours" ? <YourWorlds /> : <ExploreWorlds />}
      </Content>
    </Window>
  );
}

// --- Your Worlds ----------------------------------------------------------------------------------------------------

function YourWorlds() {
  const { session } = useHydrogen(true);
  const [worlds] = useRoomsOfType(session, RoomTypes.World);
  const calls = useCalls(session);
  const { worldId, entered } = useAtomValue(worldAtom);
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const [filter, setFilter] = useState("");

  const groupCalls = useMemo(() => {
    const map = new Map<string, GroupCall>();
    for (const [, groupCall] of calls) map.set(groupCall.roomId, groupCall);
    return map;
  }, [calls]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle
      ? worlds.filter((room) =>
          [room.name, room.canonicalAlias, room.id].some((value) => value?.toLowerCase().includes(needle))
        )
      : [...worlds];
    // The world you're in first, then busy worlds, then by name.
    return list.sort((a, b) => {
      if (a.id === worldId) return -1;
      if (b.id === worldId) return 1;
      const live = (groupCalls.get(b.id)?.members.size ?? 0) - (groupCalls.get(a.id)?.members.size ?? 0);
      if (live !== 0) return live;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [worlds, filter, worldId, groupCalls]);

  return (
    <>
      <div className="TileScreen__bar flex items-center gap-sm">
        <Input
          className="TileScreen__search"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter your worlds"
        />
      </div>
      <Scroll type="hover">
        <div className="TileScreen__body">
          {worlds.length === 0 ? (
            <div className="flex flex-column items-start gap-sm">
              <Text variant="b2">You haven’t joined any worlds yet. Find some in Explore, or make your own.</Text>
              <Button onClick={() => setOverlayWindow({ type: OverlayWindow.CreateWorld })}>Create World</Button>
            </div>
          ) : (
            <WorldTileGrid>
              {shown.map((room) => (
                <YourWorldTile
                  key={room.id}
                  room={room}
                  groupCall={groupCalls.get(room.id)}
                  isHere={entered && room.id === worldId}
                />
              ))}
            </WorldTileGrid>
          )}
        </div>
      </Scroll>
    </>
  );
}

function useJoinedWorldPreview(room: Room) {
  const [preview, setPreview] = useState<string>();
  const [topic, setTopic] = useState<string>();
  const [hasScript, setHasScript] = useState(false);
  useEffect(() => {
    let cancelled = false;
    room
      .getStateEvent("org.matrix.msc3815.world")
      .then((result: any) => {
        const url = result?.event?.content?.scene_preview_url;
        if (!cancelled && typeof url === "string") setPreview(url);
        if (!cancelled) setHasScript(typeof result?.event?.content?.script_url === "string");
      })
      .catch(() => undefined);
    room
      .getStateEvent("m.room.topic")
      .then((result: any) => {
        const value = result?.event?.content?.topic;
        if (!cancelled && typeof value === "string") setTopic(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [room]);
  return { preview, topic, hasScript };
}

/** Closes the overlay and takes the pointer back while the click still counts as a gesture. */
function useReturnToWorld() {
  const mainThread = useMainThreadContext();
  const setOverlayVisibility = useSetAtom(overlayVisibilityAtom);
  return () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    markGameResumed();
    requestGamePointerLock(mainThread.canvas);
    setOverlayVisibility(false);
  };
}

function YourWorldTile({ room, groupCall, isHere }: { room: Room; groupCall?: GroupCall; isHere: boolean }) {
  const { session, platform } = useHydrogen(true);
  const { preview, topic, hasScript } = useJoinedWorldPreview(room);
  const previewSrc = useThumbnail(preview);
  const avatarSrc = useThumbnail(room.avatarUrl ?? undefined);
  const [withoutScriptRequest, setWithoutScriptRequest] = useState(0);
  const developerMode = useAtomValue(developerModeAtom);
  const { getPowerLevel, canSendStateEvent } = usePowerLevels(room);
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const returnToWorld = useReturnToWorld();
  const setActiveChat = useSetAtom(activeChatsAtom);
  const setSidebarTab = useSetAtom(sidebarTabAtom);
  const invite = useDialog(false);
  const name = room.name || "Unnamed world";
  const address = room.canonicalAlias ?? room.id;

  return (
    <>
      <Dialog open={invite.open} onOpenChange={invite.setOpen}>
        <InviteDialog roomId={room.id} requestClose={invite.closeDialog} />
      </Dialog>
      <WorldTile
        isActive={isHere}
        imageSrc={previewSrc ?? avatarSrc}
        fallback={<TileFallback name={name} color={`var(--usercolor${getIdentifierColorNumber(room.id)})`} />}
        title={name}
        subtitle={
          <>
            {room.canonicalAlias && (
              <Text variant="b3" color="surface-low">
                {room.canonicalAlias}
              </Text>
            )}
            {topic && <Text variant="b3">{topic}</Text>}
          </>
        }
        memberCount={room.joinedMemberCount}
        badge={isHere ? "You're here" : undefined}
        overlay={
          groupCall ? (
            <WorldTileMembers session={session} platform={platform} groupCall={groupCall} room={room} />
          ) : undefined
        }
        action={
          isHere ? (
            <Button size="sm" variant="primary" onClick={() => returnToWorld()}>
              Return
            </Button>
          ) : (
            <EnterWorldButton room={room} size="sm" label="Enter" withoutScriptRequest={withoutScriptRequest} />
          )
        }
        menu={
          <>
            <DropdownMenuItem
              onSelect={() => {
                setSidebarTab(SidebarTab.Chat);
                setActiveChat({ type: "OPEN", roomId: room.id });
              }}
            >
              Chat
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={invite.openDialog}>Invite</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyToClipboard(worldLink(address))}>Copy Link</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyToClipboard(address)}>
              {room.canonicalAlias ? "Copy Alias" : "Copy Room ID"}
            </DropdownMenuItem>
            {canSendStateEvent(undefined, getPowerLevel(session.userId)) && (
              <DropdownMenuItem
                onSelect={() => setOverlayWindow({ type: OverlayWindow.WorldSettings, roomId: room.id })}
              >
                Settings
              </DropdownMenuItem>
            )}
            {developerMode && hasScript && !isHere && (
              // Buzzar: Developer Mode only; this visit only, so a world never stays without its script by accident.
              <DropdownMenuItem onSelect={() => setWithoutScriptRequest((n) => n + 1)}>
                Enter Without Script
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="danger"
              onSelect={() => {
                if (confirm(`Leave ${name}?`)) room.leave();
              }}
            >
              Leave
            </DropdownMenuItem>
          </>
        }
      />
    </>
  );
}

// --- Explore --------------------------------------------------------------------------------------------------------

interface ServerResult {
  nextBatch?: string;
  error?: string;
}

interface FoundWorld {
  world: DirectoryWorld;
  /** Directory it was listed in (used to route the join over federation). */
  server: string;
}

function ExploreWorlds() {
  const { session, platform, client } = useHydrogen(true);
  const ownServer = serverNameOf(session.userId);

  const [extraServers, setExtraServers] = useState<string[]>();
  const servers = useMemo(
    () => [ownServer, ...(extraServers ?? []).filter((s) => s !== ownServer)],
    [ownServer, extraServers]
  );
  /** undefined = all servers (the default each time you open the tab). */
  const [selected, setSelected] = useState<string[]>();
  const activeServers = useMemo(
    () => (selected ? servers.filter((s) => selected.includes(s)) : servers),
    [selected, servers]
  );

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<FoundWorld[]>([]);
  const [results, setResults] = useState<Record<string, ServerResult>>({});
  const [loading, setLoading] = useState(false);
  const manage = useDialog(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getSessionAuth(platform, client.sessionId);
      const list = auth ? await fetchExploreServers(auth, session.userId).catch(() => []) : [];
      if (!cancelled) setExtraServers(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, client, session]);

  const load = useCallback(
    async (more?: Record<string, ServerResult>) => {
      if (extraServers === undefined) return;
      setLoading(true);
      const auth = await getSessionAuth(platform, client.sessionId);
      const targets = more ? activeServers.filter((server) => more[server]?.nextBatch) : activeServers;
      const pages = await Promise.all(
        targets.map(async (server) => {
          try {
            if (!auth) throw new Error("Not signed in");
            const page = await fetchWorldDirectory(auth, {
              server: server === ownServer ? undefined : server,
              search: search || undefined,
              since: more?.[server]?.nextBatch,
            });
            return { server, worlds: page.worlds, result: { nextBatch: page.nextBatch } as ServerResult };
          } catch (e) {
            return { server, worlds: [], result: { error: e instanceof Error ? e.message : String(e) } };
          }
        })
      );
      setResults((current) => {
        const next: Record<string, ServerResult> = more ? { ...current } : {};
        for (const page of pages) next[page.server] = page.result;
        return next;
      });
      setFound((current) => {
        const byId = new Map<string, FoundWorld>();
        for (const item of more ? current : []) byId.set(item.world.room_id, item);
        for (const page of pages) {
          for (const world of page.worlds) {
            if (!byId.has(world.room_id)) byId.set(world.room_id, { world, server: page.server });
          }
        }
        return [...byId.values()].sort((a, b) => b.world.num_joined_members - a.world.num_joined_members);
      });
      setLoading(false);
    },
    [platform, client, activeServers, ownServer, search, extraServers]
  );

  useEffect(() => {
    load();
  }, [load]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const toggleServer = (server: string) => {
    const current = selected ?? servers;
    const next = current.includes(server) ? current.filter((s) => s !== server) : [...current, server];
    setSelected(next.length === servers.length || next.length === 0 ? undefined : next);
  };

  const errors = Object.entries(results).filter(([, r]) => r.error);
  const hasMore = Object.values(results).some((r) => r.nextBatch);
  const serverLabel =
    activeServers.length === servers.length
      ? servers.length === 1
        ? servers[0]
        : `All servers (${servers.length})`
      : activeServers.length === 1
      ? activeServers[0]
      : `${activeServers.length} of ${servers.length} servers`;

  return (
    <>
      <ExploreServersDialog
        open={manage.open}
        onOpenChange={manage.setOpen}
        ownServer={ownServer}
        servers={extraServers ?? []}
        onChange={(list) => {
          setExtraServers(list);
          setSelected(undefined);
        }}
      />
      <form className="TileScreen__bar flex items-center gap-sm" onSubmit={submit}>
        <Input
          className="TileScreen__search"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search world names and topics"
        />
        <Button type="submit" disabled={loading}>
          Search
        </Button>
        <DropdownMenu
          align="start"
          content={
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setSelected(undefined);
                }}
                before={<Checkbox checked={activeServers.length === servers.length} />}
              >
                All servers
              </DropdownMenuItem>
              {servers.map((server) => (
                <DropdownMenuItem
                  key={server}
                  onSelect={(e) => {
                    e.preventDefault();
                    toggleServer(server);
                  }}
                  before={<Checkbox checked={activeServers.includes(server)} />}
                >
                  {server === ownServer ? `${server} (yours)` : server}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={manage.openDialog}>Add or Remove Servers…</DropdownMenuItem>
            </>
          }
        >
          <Button fill="outline">{extraServers === undefined ? "Servers…" : serverLabel}</Button>
        </DropdownMenu>
      </form>
      <Scroll type="hover">
        <div className="TileScreen__body flex flex-column gap-sm">
          <Text variant="b3" color="surface-low">
            Public worlds listed on {activeServers.join(", ")}
            {search ? ` matching “${search}”` : ""}.
          </Text>
          {errors.map(([server, r]) => (
            <Text key={server} variant="b3" color="danger">
              {server}: {r.error}
            </Text>
          ))}
          {!loading && found.length === 0 && (
            <Text variant="b2">
              No public worlds found. World owners can list a world here by making it public when they create it, and
              you can add more homeservers with the servers button.
            </Text>
          )}
          <WorldTileGrid>
            {found.map(({ world, server }) => (
              <ExploreWorldTile
                key={world.room_id}
                world={world}
                viaServer={server === ownServer ? undefined : server}
              />
            ))}
          </WorldTileGrid>
          {loading && <Dots size="md" />}
          {!loading && hasMore && (
            <div>
              <Button fill="outline" onClick={() => load(results)}>
                Load more
              </Button>
            </div>
          )}
        </div>
      </Scroll>
    </>
  );
}

function ExploreWorldTile({ world, viaServer }: { world: DirectoryWorld; viaServer?: string }) {
  const { session, platform, client } = useHydrogen(true);
  const [preview, setPreview] = useState<string>();
  const [joining, setJoining] = useState(false);
  const [joinedId, setJoinedId] = useState<string>();
  const [error, setError] = useState<string>();
  const { worldId, entered } = useAtomValue(worldAtom);
  const returnToWorld = useReturnToWorld();

  const joinedRoom = useRoom(session, joinedId ?? world.room_id);
  const previewSrc = useThumbnail(preview);
  const avatarSrc = useThumbnail(world.avatar_url);
  const name = world.name || world.canonical_alias || world.room_id;
  const address = world.canonical_alias ?? world.room_id;
  const isHere = entered && worldId === world.room_id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) return;
      const url = await fetchWorldPreviewUrl(auth, world.room_id);
      if (!cancelled && url) setPreview(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, client, world.room_id]);

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

  let action;
  if (isHere) {
    action = (
      <Button size="sm" variant="primary" onClick={() => returnToWorld()}>
        Return
      </Button>
    );
  } else if (joinedRoom) {
    action = <EnterWorldButton room={joinedRoom} size="sm" label="Enter" />;
  } else {
    action = (
      <Button size="sm" variant="secondary" disabled={joining || !!joinedId} onClick={join}>
        {joining || joinedId ? "Joining…" : "Join"}
      </Button>
    );
  }

  return (
    <WorldTile
      isActive={isHere}
      imageSrc={previewSrc ?? avatarSrc}
      fallback={<TileFallback name={name} color={`var(--usercolor${getIdentifierColorNumber(world.room_id)})`} />}
      title={name}
      subtitle={
        <>
          {world.canonical_alias && (
            <Text variant="b3" color="surface-low">
              {world.canonical_alias}
            </Text>
          )}
          {error ? (
            <Text variant="b3" color="danger">
              {error}
            </Text>
          ) : (
            world.topic && <Text variant="b3">{world.topic}</Text>
          )}
        </>
      }
      memberCount={world.num_joined_members}
      badge={isHere ? "You're here" : joinedRoom ? "Joined" : undefined}
      action={action}
      menu={
        <>
          <DropdownMenuItem onSelect={() => copyToClipboard(worldLink(address))}>Copy Link</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyToClipboard(address)}>
            {world.canonical_alias ? "Copy Alias" : "Copy Room ID"}
          </DropdownMenuItem>
          {!joinedRoom && (
            <DropdownMenuItem onSelect={join} disabled={joining}>
              Join
            </DropdownMenuItem>
          )}
        </>
      }
    />
  );
}
