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
- Uses PriceBuddy product-centric API routes for watchlist and alert-style workflows
- Calls a configured PriceBuddy API using an API base URL and optional bearer/API key
- Renders command results as human-readable summaries instead of raw JSON payloads
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

## Command Reference
The bot supports both message commands (`!pb ...`) and slash commands (`/status`, `/price`, etc.).

Notes:
- Message command examples assume your prefix is `!pb`.
- Most command results are the raw PriceBuddy API response formatted as JSON text.
- Exact keys can vary depending on your PriceBuddy backend.

### `help`
Shows available commands and quick usage hints.

Message command:
```text
!pb help
```

Expected return:
```text
Available commands: status, sync, price <sku>, search <term>, history <sku>, watch <sku> [target], unwatch <sku>, watchlist, alerts, alert <id>
```

### `status`
Checks service health/status from PriceBuddy.

Message command:
```text
!pb status
```

Slash command:
```text
/status
```

Expected return example:
```json
{
  "status": "ok",
  "service": "pricebuddy",
  "timestamp": "2026-10-25T20:40:12Z"
}
```

### `sync`
Triggers a PriceBuddy sync job.

Message command:
```text
!pb sync
```

Slash command:
```text
/sync
```

Expected return example:
```json
{
  "accepted": true,
  "jobId": "sync_12345",
  "source": "discord"
}
```

### `price <sku>`
Returns current pricing data for a specific SKU/product ID.

Message command:
```text
!pb price ABC-123
```

Slash command:
```text
/price sku:ABC-123
```

Expected return example:
```json
{
  "sku": "ABC-123",
  "price": 19.99,
  "currency": "USD",
  "updatedAt": "2026-10-25T20:39:00Z"
}
```

### `search <term>`
Searches products by text term.

Message command:
```text
!pb search wireless mouse
```

Slash command:
```text
/search term:wireless mouse
```

Expected return example:
```json
[
  {
    "sku": "MOUSE-001",
    "name": "Wireless Mouse Pro",
    "price": 29.99
  },
  {
    "sku": "MOUSE-002",
    "name": "Wireless Mouse Lite",
    "price": 19.99
  }
]
```

### `history <sku>`
Returns historical pricing timeline for a SKU.

Message command:
```text
!pb history ABC-123
```

Slash command:
```text
/history sku:ABC-123
```

Expected return example:
```json
{
  "sku": "ABC-123",
  "history": [
    { "date": "2026-10-01", "price": 24.99 },
    { "date": "2026-10-15", "price": 21.99 },
    { "date": "2026-10-25", "price": 19.99 }
  ]
}
```

### `watch <sku> [target]`
Enables notifications for a product by ID/title/SKU search text. Optional target sets `target_price`.

Message command:
```text
!pb watch ABC-123
!pb watch ABC-123 15.00
```

Slash command:
```text
/watch sku:ABC-123
/watch sku:ABC-123 target:15.00
```

Expected return example:
```json
{
  "created": true,
  "sku": "ABC-123",
  "target": "15.00"
}
```

### `unwatch <sku>`
Disables notifications for a product by ID/title/SKU search text.

Message command:
```text
!pb unwatch ABC-123
```

Slash command:
```text
/unwatch sku:ABC-123
```

Expected return example:
```json
{
  "removed": true,
  "sku": "ABC-123"
}
```

### `watchlist`
Lists products from PriceBuddy (product-backed watch view).

Message command:
```text
!pb watchlist
```

Slash command:
```text
/watchlist
```

Expected return example:
```json
[
  { "sku": "ABC-123", "target": "15.00" },
  { "sku": "XYZ-999", "target": null }
]
```

### `alerts`
Lists products that currently have watch-like notification settings enabled.

Message command:
```text
!pb alerts
```

Slash command:
```text
/alerts
```

Expected return example:
```json
[
  {
    "id": "alert_101",
    "sku": "ABC-123",
    "trigger": "price_below",
    "value": 15.0,
    "active": true
  }
]
```

### `alert <id>`
Returns one product detail (with insights) by product ID.

Message command:
```text
!pb alert alert_101
```

Slash command:
```text
/alert id:alert_101
```

Expected return example:
```json
{
  "id": "alert_101",
  "sku": "ABC-123",
  "trigger": "price_below",
  "value": 15.0,
  "createdAt": "2026-10-20T10:00:00Z",
  "active": true
}
```

### Common command errors
- Unauthorized user:
```text
Request failed: You are not authorized to use this bot.
```
- Missing argument example:
```text
Usage: !pb price <sku>
```
- API base URL misconfigured example:
```text
Request failed: PriceBuddy API returned an HTML error page. Check PRICEBUDDY_API_URL and ensure it points to the API base URL, not a website route.
```

## Environment variables
- `DISCORD_TOKEN`: Discord bot token
- `DISCORD_CLIENT_ID`: Discord application ID used for slash command registration
- `PRICEBUDDY_API_URL`: Base URL for the PriceBuddy API, e.g. `https://api.example.com` or `https://api.example.com/api`.
  - If your PriceBuddy instance serves API routes under `/api`, set this to `https://your-host/api`.
  - The bot now preserves base-path prefixes (like `/api`) when building endpoint URLs.
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

## Troubleshooting
- Error: `PriceBuddy API request failed (404)` with HTML in logs
  - Cause: `PRICEBUDDY_API_URL` likely points at a website route instead of the API base path.
  - Fix: Set `PRICEBUDDY_API_URL` to the API base URL and retest `!pb status`.

- Error: `PriceBuddy API request failed (403)` for `!pb status`
  - Cause: PriceBuddy `client-config` endpoint requires a token with `client-config:read` ability (or all-access token).
  - Fix: Recreate the API token in PriceBuddy with the required ability and update `PRICEBUDDY_API_KEY`.

- Error: `Invalid Form Body content[BASE_TYPE_MAX_LENGTH]`
  - Cause: A very large error body was being echoed to Discord.
  - Status: The bot now truncates and sanitizes user-facing error messages to stay within Discord limits.

## License
This project is licensed under the GNU General Public License v3.0.
See the `LICENSE` file for the full text.
