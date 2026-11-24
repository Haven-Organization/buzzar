# Self Hosting Buzzar

Buzzar is hosted at [buzzar.haven.software](https://buzzar.haven.software), and you can also run your own copy, for example to customize the client for your community.

Buzzar is a single page web app (SPA) and can be hosted on any static web server. You do not need your own Matrix homeserver to host the client; it works with accounts on any homeserver.

If you also want to self-host a Matrix homeserver, see the [Synapse documentation](https://element-hq.github.io/synapse/latest/welcome_and_overview.html).

## Homeserver requirements

- Synapse 1.62 or newer (for the `Cross-Origin-Resource-Policy: cross-origin` header on media downloads), or another homeserver that sends it.
- LiveKit, for world calls (the default call type): a LiveKit server plus the MatrixRTC authorization service ([lk-jwt-service](https://github.com/element-hq/lk-jwt-service)), announced in your `.well-known/matrix/client` under `org.matrix.msc4143.rtc_foci`. It's the same setup Element Call uses; see its [self-hosting guide](https://github.com/element-hq/element-call/blob/main/docs/self_hosting.md). Only whoever starts a world's call needs it: everyone who joins after them uses that server.
- Delayed events (MSC4140), recommended: players who close the app without leaving drop out of the call within seconds. In Synapse, set `max_event_delay_duration` (for example `24h`).
- A TURN server, for peer-to-peer world calls (see the tip below).
- Room versions: Buzzar creates worlds in your server's default room version, including v12.

::: tip
A world can choose a peer-to-peer call instead of LiveKit (World Settings → Calls), and Buzzar offers one when a LiveKit call can't connect. Those use Matrix's Group VoIP Calls, with players connecting directly to each other.
For them to connect in all networking scenarios, you should set up a TURN server such as Coturn. You can find more information on configuring Coturn in Synapse [here](https://element-hq.github.io/synapse/latest/turn-howto.html).
:::

## Prerequisites

To build the Buzzar client you'll need [Node](https://nodejs.org) (version 18+) and [yarn](https://classic.yarnpkg.com) (v1) installed on your system.

You'll also need to clone the Buzzar repository:

```bash
git clone https://github.com/Haven-Organization/buzzar.git
```

## Building the Client

First ensure that you are in the buzzar root directory

```bash
cd buzzar
```

Then install the dependencies:

```bash
yarn
```

Then build the client:

```bash
yarn build
```

::: tip
In some environments we've seen the build step allocate too much memory and fail. If you run into this issue, you can try increasing the memory limit for Node:

```bash
NODE_OPTIONS=--max_old_space_size=4096 yarn build
```

:::

The built client will be available in the `dist` directory.

## Hosting the Client

You can use any static web server to host the client. We recommend using [Caddy](https://caddyserver.com) as it's easy to configure and supports HTTPS out of the box. [Nginx](https://nginx.org) is another popular option.

### Caddy

To host the client with Caddy, first install Caddy on your system. You can find instructions for your platform [here](https://caddyserver.com/docs/install).

Then create a Caddyfile with the following content, make sure to change the root path to the path of the `dist` directory you built earlier:

```caddyfile
localhost:3000 {
  encode gzip

  handle {
    root * ./path/to/dist
    try_files {path} {path}.html {path}/index.html /index.html
    file_server
    header Cross-Origin-Opener-Policy "same-origin"
    header Cross-Origin-Embedder-Policy "require-corp"
  }
}
```

Then run Caddy in the same directory as your Caddyfile:

```bash
caddy run
```

You should now be able to access the client at `http://localhost:3000`.

You can change `localhost:3000` to whatever domain you're hosting the client on.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name buzzar.example.org;
    root /var/www/buzzar;
    index index.html;

    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    # The service worker must never be served stale, or new builds won't take over.
    location = /sw.js {
        add_header Cache-Control "no-cache" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
    }

    # These docs (built into dist/docs).
    location /docs/ {
        try_files $uri $uri.html $uri/ =404;
    }

    # Client-side routes (/world/…, /login, …) all load the app.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`scripts/buzzar/nginx-buzzar.conf` and `scripts/buzzar/deploy-local.sh` in the repository set up the same thing for a local build at `http://localhost:8090`.

## Required Headers

Buzzar requires the following headers to be set in order to function correctly. The engine's worker threads share memory (`SharedArrayBuffer`), which browsers only allow on cross-origin isolated pages:

```http
Cross-Origin-Opener-Policy "same-origin"
Cross-Origin-Embedder-Policy "require-corp"
```

If your homeserver is hosted on the same domain as your client you also must ensure that the `./well-known` directory is served properly so that the client can discover the homeserver configuration.

## Sign-in with Matrix Authentication Service

Homeservers that use [Matrix Authentication Service](https://element-hq.github.io/matrix-authentication-service/) (MAS) or another OAuth 2.0 server are found through `/_matrix/client/v1/auth_metadata`. Buzzar registers itself with the server automatically the first time someone signs in, so there's nothing to configure.

MAS only accepts `https` addresses for web apps. When Buzzar runs on `localhost` (for development or the desktop app), it registers as a native app and gives MAS a public `https` address as its home page. That's `https://buzzar.haven.software/` unless you set `oidcClientUri` in `config.json`.

## Additional Configuration

Configuration options can be found in the `/config.json` file. You can change the default homeserver displayed on the login page, the homeservers shown in the dropdown, the OpenID Connect provider configuration, and more there. This file should be modified before the client is built.

If you're hosting your own homeserver on the same domain as the client, you'll also want to adjust the files in the `./well-known` directory to point to your homeserver.

Other client modifications and configuration are up to you. We've left them undocumented for now and encourage you to explore the codebase to see what's possible. However, if you're looking to extensively modify the client's runtime behavior, we suggest you look to see if it's possible with the existing WebSG APIs first. For content to be interoperable across clients, it's important that we all use the same APIs and protocols. If you're interested in getting involved in shaping the future of the glTF or WebSG standards please open an issue on [GitHub](https://github.com/Haven-Organization/buzzar/issues).
