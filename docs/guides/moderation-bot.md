# Moderation Bot

Buzzar includes a small moderation bot for world hosts, in the [`bot/`](https://github.com/Haven-Organization/buzzar/tree/develop/bot) folder of the repository. It runs on an ordinary Matrix account on any homeserver and uses only the normal client-server API. You don't need your own homeserver, an appservice or admin access.

It only does what general Matrix moderation tools can't do for Buzzar worlds. For everything else, run one of those next to it:

- [Draupnir](https://github.com/the-draupnir-project/Draupnir) runs as an ordinary bot account too, so it works without your own homeserver. It handles room bans, redactions, flood and spam protection.
- [Meowlnir](https://github.com/maunium/meowlnir) is faster, but runs as an appservice, so it needs a homeserver you control.

Both can protect a world's room like any other room. Because a world room holds its bans as standard Matrix ban rules, they can also follow the world as a ban list.

Each world host runs their own copy of the bot. There is no shared bot.

## What it does

### Copies ban lists visitors can't read

In **World Settings → Moderation & Safety**, a world can ban accounts and servers, and follow other Matrix ban lists (policy lists, as published by Draupnir, Meowlnir and Mjolnir). Everyone's Buzzar holds back anyone those bans cover: nobody in the world sees or hears them, and they don't see or hear anyone.

Visitors' Buzzar reads a followed list directly only when anyone may read it. Most big public lists can only be read by people who join them, and visitors don't join them. The bot does: it joins each list the world follows and copies its bans into the world room, where every visitor's Buzzar applies them at once.

The bot copies:

- **Every server ban.**
- **A user ban, once someone it matches comes to the world** (joins, is invited or knocks). From then on it keeps the copy for as long as the list keeps the ban. Copying every user ban would make the world room heavy to load: big lists hold thousands.

To keep this safe:

- **It never copies a ban that would hold back itself, the world's creators, or anyone with a raised power level** (Moderators and Admins). A list that bans a moderator's whole server can't lock your moderators out.
- **It never touches bans your moderators make by hand.** Copies are marked as copies (`software.haven.copied_from`) and use their own state keys.
- **It removes a copy** when the list lifts that ban, or when the world stops following the list.
- **It keeps existing copies when a list can't be read for a while.** A network problem doesn't unban anyone.
- **It holds at most 2,000 copies per world**, and says so if a list needs more.

It doesn't copy anything from lists anyone can read: visitors' Buzzar already applies those itself.

### Reports in World Settings

The bot reports what it did in the world room. **World Settings → Moderation & Safety** shows:

- which bot it is;
- when it last checked;
- for each followed list, how many of its bans were copied;
- anything stopping it, such as missing permission or a list it can't join.

Bans it copied are counted under **Banned Accounts and Servers**, not listed one by one.

## Quickstart

You need [Node](https://nodejs.org) 22.18 or newer, and a Matrix account for the bot. Make a new account for it on any homeserver; don't use your own.

```bash
git clone https://github.com/Haven-Organization/buzzar.git
cd buzzar/bot
npm install
cp config.example.json config.json
```

Fill in `config.json`:

```json
{
  "homeserverUrl": "https://matrix.example.org",
  "userId": "@buzzar-bot:example.org",
  "password": "the bot account's password",
  "owners": ["@you:example.org"]
}
```

Then start it:

```bash
npm start
```

The first start logs in with the password and saves the session in `data/`. After that you can remove the password from `config.json`.

## Turning it on in a world

1. **Invite the bot.** In Buzzar, open the world's People list, choose **Invite to World**, and invite the bot's account. It accepts invites only from its `owners`.
2. **Make it a Moderator.** In the People list, open the ⋯ menu next to the bot and choose **Make Moderator**. It needs the power to change ban rules (`m.policy.rule.user` and `m.policy.rule.server` state events) and to post its report (`software.haven.world.moderation_bot`). Moderator covers both unless the world raised those events' power levels.
3. **Follow ban lists.** In **World Settings → Moderation & Safety → Ban Lists**, follow the lists you want, by address (like `#community-moderation-effort-bl:neko.dev`) or room ID. Within a few seconds the bot joins them, copies their bans, and its report appears under the list.

To stop copying from a list, remove it from **Ban Lists**: the bot removes its copies. To remove the bot from a world, kick it. Copies it made stay until a moderator lifts them, or until you invite it back and remove the list.

## Settings

All settings can also come from environment variables, which take precedence over `config.json`. This is handy in a container.

| `config.json` | Environment variable | What it is |
| --- | --- | --- |
| `homeserverUrl` | `BUZZAR_BOT_HOMESERVER` | The bot account's homeserver, like `https://matrix.example.org`. |
| `userId` | `BUZZAR_BOT_USER_ID` | The bot account, like `@buzzar-bot:example.org`. |
| `password` | `BUZZAR_BOT_PASSWORD` | Used once to log in. The session is then kept in the data folder. |
| `accessToken` | `BUZZAR_BOT_ACCESS_TOKEN` | Use an existing session instead of a password. |
| `owners` | `BUZZAR_BOT_OWNERS` (comma-separated) | Who may invite the bot into rooms. |
| `rooms` | `BUZZAR_BOT_ROOMS` (comma-separated) | Optional: the only worlds (room IDs or addresses) the bot works in. By default it works in every world it's in. |
| `dataDir` | `BUZZAR_BOT_DATA_DIR` | Where the session is kept (default `data`). |

Use `npm start -- --config path/to/config.json` to read the settings from somewhere else.

## Keeping it running

The bot is one Node process with no database. Run it however you run other services. For example, a systemd unit:

```ini
[Unit]
Description=Buzzar moderation bot
After=network-online.target

[Service]
WorkingDirectory=/opt/buzzar/bot
ExecStart=/usr/bin/npm start
Restart=always
User=buzzar-bot

[Install]
WantedBy=multi-user.target
```

It re-checks every world every 10 minutes, as well as whenever a world's settings, its members or a followed list change. So nothing is lost while it's stopped: it catches up when it starts again.

## Planned

- Watching Buzzar's own world settings (Things, avatars, world rules) and alerting moderators.
- Acting on in-world reports: turning a report into a world ban.
