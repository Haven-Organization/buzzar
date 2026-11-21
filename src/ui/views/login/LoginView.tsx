import { ChangeEvent, KeyboardEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { AbortableOperation, Client, QueryLoginResult } from "../../../matrix";
import { Text } from "../../atoms/text/Text";
import { Input } from "../../atoms/input/Input";
import { Button } from "../../atoms/button/Button";
import { Label } from "../../atoms/text/Label";
import { SettingTile } from "../components/setting-tile/SettingTile";
import { useHydrogen } from "../../hooks/useHydrogen";
import LogoSVG from "../../../../res/svg/logo.svg";
import { useDebounce } from "../../hooks/useDebounce";
import { Dots } from "../../atoms/loading/Dots";
import { IconButton } from "../../atoms/button/IconButton";
import ChevronBottom from "../../../../res/ic/chevron-bottom.svg";
import { DropdownMenu } from "../../atoms/menu/DropdownMenu";
import { DropdownMenuItem } from "../../atoms/menu/DropdownMenuItem";
import { getMissingFeature, MissingFeature } from "../../utils/featureCheck";
import { MissingFeatureModal } from "./MissingFeatureModal";
import "./LoginView.css";
import { useIsMounted } from "../../hooks/useIsMounted";
import { discoverOidcIssuer, startOidcLogin } from "../../utils/oidc";

function useQueryHomeserver(client: Client, homeserver: string) {
  const queryRef = useRef<AbortableOperation<QueryLoginResult>>();
  const [data, setData] = useState<{
    homeserver: string;
    result: undefined | QueryLoginResult;
    error: string | undefined;
    loading: boolean;
  }>({
    homeserver,
    result: undefined,
    error: undefined,
    loading: false,
  });

  const queryCallback = useCallback(
    async (homeserver: string) => {
      setData({
        homeserver,
        result: undefined,
        loading: true,
        error: undefined,
      });
      const queryOperation = client.queryLogin(homeserver);
      queryRef.current = queryOperation;
      try {
        let result = await queryOperation.result;
        // Buzzar: Hydrogen only finds OIDC servers through a 2023 .well-known key; current homeservers with
        // Matrix Authentication Service (matrix.org, …) advertise it through /auth_metadata instead.
        if (!result.oidc) {
          const oidc = await discoverOidcIssuer(result.homeserver);
          if (queryRef.current !== queryOperation) return;
          if (oidc) result = { ...result, oidc };
        }
        setData({
          homeserver,
          result,
          loading: false,
          error: undefined,
        });
      } catch (e: any) {
        setData({
          homeserver,
          result: undefined,
          loading: false,
          error: e.name === "AbortError" ? undefined : "Unable to find homeserver.",
        });
      }
      if (queryRef.current === queryOperation) {
        queryRef.current = undefined;
      }
    },
    [client]
  );

  const debouncedCallback = useDebounce(queryCallback, { wait: 400 });

  useEffect(() => {
    queryRef.current?.abort();
    queryRef.current = undefined;
    queryCallback(homeserver);
  }, [homeserver, queryCallback]);

  const queryHomeserver = (homeserver: string) => {
    queryRef.current?.abort();
    queryRef.current = undefined;
    if (homeserver === "") return;
    debouncedCallback(homeserver);
  };

  return { ...data, queryHomeserver };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function LoginView() {
  const { platform, urlRouter, login, client } = useHydrogen();
  const [authenticating, setAuthenticating] = useState(false);
  const [oidcError, setOidcError] = useState<string>();
  // Why the visitor is back at the login page, when Buzzar sent them (e.g. after an update that needs a new sign-in).
  const [notice] = useState(() => {
    try {
      const text = sessionStorage.getItem("buzzar_signin_notice");
      sessionStorage.removeItem("buzzar_signin_notice");
      return text ?? undefined;
    } catch {
      return undefined;
    }
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const isMounted = useIsMounted();

  const [missingFeatures, setMissingFeature] = useState<MissingFeature[]>([]);
  useEffect(() => {
    const run = async () => {
      const missingFeature = await getMissingFeature();
      if (!isMounted()) return;
      setMissingFeature(missingFeature);
    };
    run();
  }, [isMounted]);

  const { homeserver, loading, error, result, queryHomeserver } = useQueryHomeserver(
    client,
    platform.config.defaultHomeServer
  );
  useEffect(() => {
    if (!formRef.current) return;
    const form = formRef.current.elements as typeof formRef.current.elements & {
      homeserver: HTMLInputElement;
    };
    form.homeserver.value = platform.config.defaultHomeServer;
  }, [platform]);

  const handleHomeserverSelect = (hs: string) => {
    if (!formRef.current) return;
    const form = formRef.current.elements as typeof formRef.current.elements & {
      homeserver: HTMLInputElement;
    };
    form.homeserver.value = hs;
    setOidcError(undefined);
    queryHomeserver(hs);
  };

  const handleKeyDown = (evt: KeyboardEvent<HTMLInputElement>) => {
    if (evt.key === "ArrowDown") {
      evt.preventDefault();
      setOpen(true);
    }
  };

  const handleHomeserverChange = (event: ChangeEvent<HTMLInputElement>) => {
    const hs = event.target.value.trim();
    setOidcError(undefined);
    queryHomeserver(hs);
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!result) return;

    const form = event.currentTarget.elements as typeof event.currentTarget.elements & {
      homeserver: HTMLInputElement;
      username: HTMLInputElement;
      password: HTMLInputElement;
    };
    if (form.homeserver.value !== homeserver) {
      return;
    }

    let loginMethod;
    setAuthenticating(true);
    setOidcError(undefined);

    if (result.oidc) {
      const create = (event.nativeEvent as SubmitEvent).submitter?.id === "create-account";
      try {
        await startOidcLogin(platform, urlRouter, result.homeserver, result.oidc, create ? { prompt: "create" } : {});
      } catch (e) {
        console.error(e);
        setOidcError(e instanceof Error ? e.message : "Couldn't reach the homeserver's sign-in service.");
      }

      setAuthenticating(false);
      return;
    } else if (result.password) {
      const username = form.username.value.trim();
      const password = form.password.value;
      if (!username || !password || !result) return;

      loginMethod = result.password(username, password);
    }

    if (!loginMethod) {
      setAuthenticating(false);
      return;
    }
    try {
      await login(loginMethod);
    } catch (error) {
      console.error(error);
    }
    setAuthenticating(false);
  };

  const renderPasswordLogin = () => (
    <>
      <Text variant="s1" weight="bold">
        Login
      </Text>
      <SettingTile
        label={
          <Label color="surface-low" htmlFor="username">
            Username
          </Label>
        }
      >
        <Input name="username" disabled={authenticating} required />
      </SettingTile>
      <SettingTile
        label={
          <Label color="surface-low" htmlFor="password">
            Password
          </Label>
        }
      >
        <Input name="password" type="password" disabled={authenticating} required />
      </SettingTile>
      <Button size="lg" variant="primary" type="submit" disabled={authenticating}>
        {authenticating ? <Dots color="on-primary" /> : "Login"}
      </Button>
    </>
  );

  if (missingFeatures.length > 0) return <MissingFeatureModal missingFeatures={missingFeatures} />;
  return (
    <div className="LoginView flex justify-center items-start">
      <div className="LoginView__card grow flex flex-column gap-xl">
        <div className="flex items-center gap-sm">
          <img src={LogoSVG} alt="" width={40} height={40} />
          <Text variant="h2" weight="bold">
            Buzzar
          </Text>
        </div>
        <form ref={formRef} className="LoginView__form flex flex-column gap-md" onSubmit={handleLogin}>
          <SettingTile
            label={
              <Label color="surface-low" htmlFor="homeserver">
                Homeserver
              </Label>
            }
          >
            <Input
              defaultValue={platform.config.defaultHomeServer}
              name="homeserver"
              disabled={authenticating}
              onChange={handleHomeserverChange}
              required
              onKeyDown={handleKeyDown}
              after={
                platform.config.homeserverList.length > 0 && (
                  <DropdownMenu
                    open={open}
                    onOpenChange={setOpen}
                    content={platform.config.homeserverList.map((hs: string) => (
                      <DropdownMenuItem key={hs} onSelect={() => handleHomeserverSelect(hs)}>
                        {hs}
                      </DropdownMenuItem>
                    ))}
                  >
                    <IconButton iconSrc={ChevronBottom} label="More Homeserver" tabIndex={-1} />
                  </DropdownMenu>
                )
              }
            />
          </SettingTile>
          {notice && <Text variant="b2">{notice}</Text>}
          {oidcError && (
            <Text color="danger" variant="b2">
              {oidcError}
            </Text>
          )}
          {loading && (
            <div className="flex items-center gap-sm">
              <Dots />
              <Text>Looking for homeserver</Text>
            </div>
          )}
          {result &&
            (result.oidc || result.password ? (
              <>
                {result.oidc && !oidcError ? (
                  <>
                    <Text variant="b2" color="surface-low">
                      {`You'll sign in on ${hostOf(result.oidc.issuer)}, your homeserver's account page.`}
                    </Text>
                    <Button size="lg" variant="primary" type="submit" disabled={authenticating}>
                      {authenticating ? <Dots color="on-primary" /> : "Continue"}
                    </Button>
                    <Button
                      id="create-account"
                      size="lg"
                      variant="primary"
                      fill="outline"
                      type="submit"
                      disabled={authenticating}
                    >
                      Create Account
                    </Button>
                  </>
                ) : (
                  result.password && renderPasswordLogin()
                )}
              </>
            ) : (
              <Text color="danger" variant="b2">
                This client is not supported by the homeserver.
              </Text>
            ))}
          {error && (
            <Text color="danger" variant="b2">
              {error}
            </Text>
          )}
        </form>
      </div>
    </div>
  );
}
