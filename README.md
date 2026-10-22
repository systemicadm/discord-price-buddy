# discord-price-buddy
A Discord bot for approved users to manage PriceBuddy through API calls.

## Features
- Restricts commands to a configured allowlist of Discord user IDs
- Supports `!pb status`, `!pb sync`, and `!pb price <sku>` commands
- Exposes equivalent slash commands for `status`, `sync`, and `price`
- Calls a configured PriceBuddy API using an API base URL and optional bearer/API key

## Setup
1. Copy `.env.example` to `.env`
2. Fill in your Discord bot token, application ID, PriceBuddy API URL, and API key
3. Set `APPROVED_USER_IDS` to a comma-separated list of allowed Discord user IDs
4. Start the bot:

```bash
npm install
npm start
```

## Environment variables
- `DISCORD_TOKEN`: Discord bot token
- `DISCORD_CLIENT_ID`: Discord application ID used for slash command registration
- `PRICEBUDDY_API_URL`: Base URL for the PriceBuddy API, e.g. `https://api.example.com`
- `PRICEBUDDY_API_KEY`: API key or bearer token for the PriceBuddy API
- `APPROVED_USER_IDS`: Comma-separated list of allowed Discord user IDs
