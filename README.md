# Sapphire Discord Bot (basic scaffold)

## Setup

1. Create a bot in the Discord Developer Portal.
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`.
   - (Optional) Set `DISCORD_GUILD_ID` to register slash commands to one guild while developing.
3. Install deps:

```/dev/null/command.txt#L1-1
pnpm install
```

## Run (Node / Gateway)

```/dev/null/command.txt#L1-1
pnpm start
```

Or with auto-restart on changes:

```/dev/null/command.txt#L1-1
pnpm dev
```

> Note: Cloudflare Workers cannot run a Discord Gateway (websocket) bot. If you want to deploy on Workers, use the Interactions-based Worker below.

## Deploy on Cloudflare Workers (Interactions endpoint)

This repo includes a Workers-compatible implementation at `src/worker.mjs` that handles slash commands via Discord's Interactions HTTP endpoint.

Wrangler (the Cloudflare Workers CLI) requires Node 22+.

### Local dev

1. Copy `.dev.vars.example` to `.dev.vars` and fill in values.
2. Run:

```/dev/null/command.txt#L1-1
pnpm worker:dev
```

### Deploy

1. Set Worker secrets (one-time):

```/dev/null/command.txt#L1-3
pnpm wrangler secret put DISCORD_PUBLIC_KEY
pnpm wrangler secret put DISCORD_APPLICATION_ID
pnpm wrangler secret put DISCORD_TOKEN
```

2. Deploy:

```/dev/null/command.txt#L1-1
pnpm worker:deploy
```

### Register slash commands

Register commands using the Discord API (uses `DISCORD_APPLICATION_ID` + `DISCORD_TOKEN`):

```/dev/null/command.txt#L1-1
pnpm register:commands
```

- If `DISCORD_GUILD_ID` is set, commands are registered to that guild (instant updates while developing).
- Otherwise, commands are registered globally (can take time to appear).

### Configure Discord

In the Discord Developer Portal → your application → **General Information**:
- Set **Interactions Endpoint URL** to: `https://<your-worker-domain>/interactions`
- Copy **Public Key** into `DISCORD_PUBLIC_KEY`

## Try it

Use `/ping` or `/paint #ff00ff` in your server.

## Notes

- When `DISCORD_GUILD_ID` is **not** set, slash commands are registered **globally** and may take a while to appear.
- `/paint` requires the bot to have the `Manage Roles` permission, and the bot's highest role must be above the paint roles it creates.
- When inviting the bot, include the `applications.commands` scope so slash commands work.
