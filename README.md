# discord-price-buddy
A Discord bot for approved users to manage PriceBuddy through API calls.

## Features
- Restricts commands to a configured allowlist of Discord user IDs
- Supports rich PriceBuddy actions via Discord messages and slash commands:
  - `!pb status`
  - `!pb sync`
  - `!pb price <sku>`
  - `!pb search <term>`
  - `!pb history <sku>`
  - `!pb watch <sku> [target]`
  - `!pb unwatch <sku>`
  - `!pb watchlist`
  - `!pb alerts`
  - `!pb alert <id>`
- Falls back across common PriceBuddy route names for price, history, watchlist, and alert requests
- Calls a configured PriceBuddy API using an API base URL and optional bearer/API key
- Emits structured JSON logs for Discord connectivity, command handling, and PriceBuddy API request outcomes

## Setup
1. Copy `.env.example` to `.env`
2. Fill in your Discord bot token, application ID, PriceBuddy API URL, and API key
3. Set `APPROVED_USER_IDS` to a comma-separated list of allowed Discord user IDs
4. Start the bot:

```bash
npm install
npm start
```

## Discord Developer Portal Configuration
Use these settings in the Discord Developer Portal for this bot to start and operate correctly.

1. Create/select application
- Go to https://discord.com/developers/applications and create or select your app.

2. Collect IDs and token
- In `General Information`, copy `Application ID` and set it as `DISCORD_CLIENT_ID`.
- In `Bot`, create/reset the bot token and set it as `DISCORD_TOKEN`.
- Keep the token secret and rotate it if it is ever exposed.

3. Enable required gateway intents
- In `Bot` -> `Privileged Gateway Intents`:
  - Enable `Message Content Intent` (required for `!pb ...` message commands).
  - `Server Members Intent` is not required for this project.
  - `Presence Intent` is not required for this project.

4. Configure install scopes
- In `OAuth2` -> `URL Generator`:
  - Select scopes: `bot` and `applications.commands`.

5. Grant bot permissions
- In the same URL generator, select at least these bot permissions:
  - `View Channels`
  - `Send Messages`
  - `Embed Links`
  - `Read Message History`

6. Invite the bot
- Open the generated URL and invite the bot to your server.

7. If you do not want privileged intents
- Remove `GatewayIntentBits.MessageContent` from the code and use slash commands only.
- Then you can disable `Message Content Intent`.

## Environment variables
- `DISCORD_TOKEN`: Discord bot token
- `DISCORD_CLIENT_ID`: Discord application ID used for slash command registration
- `PRICEBUDDY_API_URL`: Base URL for the PriceBuddy API, e.g. `https://api.example.com`
- `PRICEBUDDY_API_KEY`: API key or bearer token for the PriceBuddy API
- `APPROVED_USER_IDS`: Comma-separated list of allowed Discord user IDs
- `LOG_LEVEL`: Log verbosity (`error`, `warn`, `info`, or `debug`). Default is `info`.
- `LOG_API_DETAILS`: Set to `1` to include PriceBuddy response payload previews in logs (off by default).

## Logging
Runtime logs are emitted as newline-delimited JSON, which works well with Pelican console output and log shippers.

- Discord connectivity events logged:
  - Ready/login state
  - Shard disconnect/reconnect/resume/error
  - Discord client warnings and errors
- PriceBuddy API usage logged:
  - Request start, status code, and latency
  - Fallback route attempts and failures
  - Error responses with a short body preview
- Command flow logged:
  - Incoming message/slash commands
  - Handler failures with context (user, guild, channel, command)
