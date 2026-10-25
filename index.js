'use strict';

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const configuredLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const activeLogLevel = Object.prototype.hasOwnProperty.call(LOG_LEVELS, configuredLogLevel)
  ? LOG_LEVELS[configuredLogLevel]
  : LOG_LEVELS.info;
const logApiDetails = process.env.LOG_API_DETAILS === '1';
let apiRequestCounter = 0;

function serializeError(error) {
  if (!error) {
    return { message: 'Unknown error' };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code,
  };
}

function log(level, message, metadata = {}) {
  const levelName = LOG_LEVELS[level] === undefined ? 'info' : level;
  if (LOG_LEVELS[levelName] > activeLogLevel) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level: levelName,
    message,
    ...metadata,
  };

  const line = JSON.stringify(entry);

  if (levelName === 'error') {
    console.error(line);
    return;
  }

  if (levelName === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

function nextApiRequestId() {
  apiRequestCounter += 1;
  return `api-${apiRequestCounter}`;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const approvedUserIds = new Set(
  (process.env.APPROVED_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

const apiBaseUrl = (process.env.PRICEBUDDY_API_URL || '').replace(/\/$/, '');
const apiKey = process.env.PRICEBUDDY_API_KEY || '';

function isApiConfigured() {
  return Boolean(apiBaseUrl && apiKey);
}

function buildApiUrl(path, query = {}) {
  const base = apiBaseUrl.replace(/\/$/, '');
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

async function callPriceBuddyApi(path, method = 'GET', body = undefined, query = {}) {
  if (!apiBaseUrl) {
    throw new Error('PRICEBUDDY_API_URL is not configured.');
  }

  const requestId = nextApiRequestId();
  const startTime = Date.now();
  const url = buildApiUrl(path, query);
  const headers = {
    'Content-Type': 'application/json',
  };

  log('debug', 'PriceBuddy API request started', {
    requestId,
    path,
    method,
    queryKeys: Object.keys(query),
    hasBody: body !== undefined,
    apiBaseUrl,
  });

  if (apiKey) {
    headers.Authorization = 'Bearer ' + apiKey;
    headers['X-API-Key'] = apiKey;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    log('error', 'PriceBuddy API request failed', {
      requestId,
      path,
      method,
      status: response.status,
      durationMs: Date.now() - startTime,
      responseBodyPreview: text ? text.slice(0, 500) : response.statusText,
    });
    throw new Error(`PriceBuddy API request failed (${response.status}): ${text || response.statusText}`);
  }

  log('info', 'PriceBuddy API request succeeded', {
    requestId,
    path,
    method,
    status: response.status,
    durationMs: Date.now() - startTime,
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const jsonResult = await response.json();
    if (logApiDetails) {
      log('debug', 'PriceBuddy API response payload', {
        requestId,
        path,
        payload: jsonResult,
      });
    }

    return jsonResult;
  }

  const text = await response.text();
  if (logApiDetails && text) {
    log('debug', 'PriceBuddy API response text', {
      requestId,
      path,
      payload: text.slice(0, 500),
    });
  }

  return text === '' ? null : text;
}

async function tryApiRoutes(routes, method = 'GET', body = undefined, query = {}) {
  let lastError = new Error('No matching PriceBuddy API route responded successfully.');

  for (const route of routes) {
    try {
      const result = await callPriceBuddyApi(route, method, body, query);
      log('debug', 'PriceBuddy API route succeeded', {
        route,
        method,
      });
      return result;
    } catch (error) {
      lastError = error;
      log('warn', 'PriceBuddy API route failed, trying next fallback route', {
        route,
        method,
        error: serializeError(error),
      });
    }
  }

  throw lastError;
}

async function getPriceForSku(sku) {
  return tryApiRoutes([
    `/prices/${encodeURIComponent(sku)}`,
    `/products/${encodeURIComponent(sku)}`,
    `/catalog/${encodeURIComponent(sku)}`,
  ]);
}

async function searchProducts(term) {
  return tryApiRoutes([
    '/products/search',
    '/search/products',
    '/prices/search',
  ], 'GET', undefined, { q: term, query: term, term });
}

async function getPriceHistory(sku) {
  return tryApiRoutes([
    `/prices/${encodeURIComponent(sku)}/history`,
    `/products/${encodeURIComponent(sku)}/history`,
    `/products/${encodeURIComponent(sku)}/price-history`,
  ]);
}

async function getWatchlist() {
  return tryApiRoutes([
    '/watchlist',
    '/products/watchlist',
    '/alerts/watchlist',
  ]);
}

async function addWatch(sku, target) {
  const payload = { sku };
  if (target) {
    payload.target = target;
  }

  return tryApiRoutes([
    '/watchlist',
    '/products/watchlist',
    `/watchlist/${encodeURIComponent(sku)}`,
  ], 'POST', payload);
}

async function removeWatch(sku) {
  return tryApiRoutes([
    `/watchlist/${encodeURIComponent(sku)}`,
    '/watchlist',
  ], 'DELETE', { sku });
}

async function getAlerts() {
  return tryApiRoutes([
    '/alerts',
    '/notifications/alerts',
    '/watchlist/alerts',
  ]);
}

async function getAlert(id) {
  return tryApiRoutes([
    `/alerts/${encodeURIComponent(id)}`,
    `/notifications/alerts/${encodeURIComponent(id)}`,
  ]);
}

function ensureApprovedUser(interactionOrMessage) {
  const userId = interactionOrMessage.user?.id ?? interactionOrMessage.author?.id;
  if (!userId || !approvedUserIds.has(userId)) {
    throw new Error('You are not authorized to use this bot.');
  }
}

function formatResult(result) {
  if (result === null || result === undefined) {
    return 'No content returned.';
  }

  if (typeof result === 'string') {
    return result;
  }

  return JSON.stringify(result, null, 2);
}

client.on('ready', () => {
  log('info', 'Discord client ready', {
    userTag: client.user?.tag,
    userId: client.user?.id,
  });
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('warn', (message) => {
  log('warn', 'Discord client warning', { message });
});

client.on('error', (error) => {
  log('error', 'Discord client error', { error: serializeError(error) });
});

client.on('shardDisconnect', (event, shardId) => {
  log('warn', 'Discord shard disconnected', {
    shardId,
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
  });
});

client.on('shardReconnecting', (shardId) => {
  log('warn', 'Discord shard reconnecting', { shardId });
});

client.on('shardResume', (shardId, replayedEvents) => {
  log('info', 'Discord shard resumed', { shardId, replayedEvents });
});

client.on('shardError', (error, shardId) => {
  log('error', 'Discord shard error', {
    shardId,
    error: serializeError(error),
  });
});

client.on('invalidated', () => {
  log('error', 'Discord session invalidated');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!pb')) {
    return;
  }

  log('info', 'Discord message command received', {
    userId: message.author?.id,
    guildId: message.guildId,
    channelId: message.channelId,
  });

  try {
    ensureApprovedUser(message);

    const [, ...args] = message.content.trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    if (!command) {
      await message.reply('Usage: `!pb help` | `!pb status` | `!pb sync` | `!pb price <sku>` | `!pb search <term>` | `!pb history <sku>` | `!pb watch <sku> [target]` | `!pb unwatch <sku>` | `!pb watchlist` | `!pb alerts`');
      return;
    }

    if (command === 'help') {
      await message.reply('Available commands: `status`, `sync`, `price <sku>`, `search <term>`, `history <sku>`, `watch <sku> [target]`, `unwatch <sku>`, `watchlist`, `alerts`, `alert <id>`');
      return;
    }

    if (command === 'status') {
      const result = await callPriceBuddyApi('/status');
      await message.reply(`Status: ${formatResult(result)}`);
      return;
    }

    if (command === 'sync') {
      const result = await callPriceBuddyApi('/sync', 'POST', { source: 'discord' });
      await message.reply(`Sync started: ${formatResult(result)}`);
      return;
    }

    if (command === 'price') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb price <sku>`');
        return;
      }

      const result = await getPriceForSku(sku);
      await message.reply(`Price for ${sku}:\n\n${formatResult(result)}`);
      return;
    }

    if (command === 'search') {
      const term = args.slice(1).join(' ');
      if (!term) {
        await message.reply('Usage: `!pb search <term>`');
        return;
      }

      const result = await searchProducts(term);
      await message.reply(`Search results for "${term}":\n\n${formatResult(result)}`);
      return;
    }

    if (command === 'history') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb history <sku>`');
        return;
      }

      const result = await getPriceHistory(sku);
      await message.reply(`Price history for ${sku}:\n\n${formatResult(result)}`);
      return;
    }

    if (command === 'watch') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb watch <sku> [target]`');
        return;
      }

      const target = args[2];
      const result = await addWatch(sku, target);
      await message.reply(`Watch created for ${sku}:\n\n${formatResult(result)}`);
      return;
    }

    if (command === 'unwatch') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb unwatch <sku>`');
        return;
      }

      const result = await removeWatch(sku);
      await message.reply(`Removed watch for ${sku}:\n\n${formatResult(result)}`);
      return;
    }

    if (command === 'watchlist') {
      const result = await getWatchlist();
      await message.reply(`Watchlist:\n\n${formatResult(result)}`);
      return;
    }

    if (command === 'alerts') {
      const result = await getAlerts();
      await message.reply(`Alerts:\n\n${formatResult(result)}`);
      return;
    }

    if (command === 'alert') {
      const id = args[1];
      if (!id) {
        await message.reply('Usage: `!pb alert <id>`');
        return;
      }

      const result = await getAlert(id);
      await message.reply(`Alert ${id}:\n\n${formatResult(result)}`);
      return;
    }

    await message.reply('Unknown command. Try `!pb help` for a list of actions.');
  } catch (error) {
    log('error', 'Discord message command failed', {
      userId: message.author?.id,
      guildId: message.guildId,
      channelId: message.channelId,
      error: serializeError(error),
    });
    await message.reply(`Request failed: ${error.message}`);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    ensureApprovedUser(interaction);
    log('info', 'Discord slash command received', {
      userId: interaction.user?.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      commandName: interaction.commandName,
    });

    if (interaction.commandName === 'status') {
      const result = await callPriceBuddyApi('/status');
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('PriceBuddy status')
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'price') {
      const sku = interaction.options.getString('sku');
      const result = await getPriceForSku(sku);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Price for ${sku}`)
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'search') {
      const term = interaction.options.getString('term');
      const result = await searchProducts(term);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Search results for ${term}`)
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'history') {
      const sku = interaction.options.getString('sku');
      const result = await getPriceHistory(sku);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Price history for ${sku}`)
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'watch') {
      const sku = interaction.options.getString('sku');
      const target = interaction.options.getString('target');
      const result = await addWatch(sku, target);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Watch added for ${sku}`)
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'unwatch') {
      const sku = interaction.options.getString('sku');
      const result = await removeWatch(sku);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Watch removed for ${sku}`)
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'watchlist') {
      const result = await getWatchlist();
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Watchlist')
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'alerts') {
      const result = await getAlerts();
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Alerts')
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'alert') {
      const id = interaction.options.getString('id');
      const result = await getAlert(id);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Alert ${id}`)
            .setDescription(formatResult(result))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'sync') {
      await callPriceBuddyApi('/sync', 'POST', { source: 'discord' });
      await interaction.reply('Sync job has been triggered.');
      return;
    }
  } catch (error) {
    log('error', 'Discord slash command failed', {
      userId: interaction.user?.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      commandName: interaction.commandName,
      error: serializeError(error),
    });
    await interaction.reply({ content: `Request failed: ${error.message}`, ephemeral: true });
  }
});

async function registerSlashCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
    log('warn', 'Skipping slash command registration because token or client ID is missing');
    return;
  }

  log('info', 'Registering Discord slash commands', {
    commandCount: 10,
    clientId: process.env.DISCORD_CLIENT_ID,
  });

  const commands = [
    { name: 'status', description: 'Check the PriceBuddy service status' },
    {
      name: 'price',
      description: 'Look up a product price',
      options: [{ name: 'sku', type: 3, description: 'SKU or product identifier', required: true }],
    },
    {
      name: 'search',
      description: 'Search for products',
      options: [{ name: 'term', type: 3, description: 'Search term', required: true }],
    },
    {
      name: 'history',
      description: 'Look up a product price history',
      options: [{ name: 'sku', type: 3, description: 'SKU or product identifier', required: true }],
    },
    {
      name: 'watch',
      description: 'Add a price watch for a SKU',
      options: [
        { name: 'sku', type: 3, description: 'SKU to watch', required: true },
        { name: 'target', type: 3, description: 'Optional price target or note', required: false },
      ],
    },
    {
      name: 'unwatch',
      description: 'Remove a price watch',
      options: [{ name: 'sku', type: 3, description: 'SKU to remove', required: true }],
    },
    { name: 'watchlist', description: 'List watched products' },
    { name: 'alerts', description: 'List active alerts' },
    {
      name: 'alert',
      description: 'Look up a specific alert',
      options: [{ name: 'id', type: 3, description: 'Alert ID', required: true }],
    },
    { name: 'sync', description: 'Trigger a service sync' },
  ];

  const response = await fetch(`https://discord.com/api/v10/applications/${process.env.DISCORD_CLIENT_ID}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Failed to register slash commands: ${response.status} ${await response.text()}`);
  }

  log('info', 'Discord slash command registration succeeded');
}

(async () => {
  try {
    log('info', 'Bot startup initiated', {
      hasDiscordToken: Boolean(process.env.DISCORD_TOKEN),
      hasDiscordClientId: Boolean(process.env.DISCORD_CLIENT_ID),
      hasPriceBuddyApiUrl: Boolean(process.env.PRICEBUDDY_API_URL),
      hasPriceBuddyApiKey: Boolean(process.env.PRICEBUDDY_API_KEY),
      approvedUserCount: approvedUserIds.size,
      logLevel: configuredLogLevel,
      logApiDetails,
    });

    if (!process.env.DISCORD_TOKEN) {
      throw new Error('DISCORD_TOKEN is required. Copy .env.example to .env and add your token.');
    }

    await registerSlashCommands();
    await client.login(process.env.DISCORD_TOKEN);
    log('info', 'Discord login call completed');
  } catch (error) {
    log('error', 'Bot startup failed', {
      error: serializeError(error),
    });
    process.exit(1);
  }
})();

module.exports = {
  approvedUserIds,
  buildApiUrl,
  callPriceBuddyApi,
  ensureApprovedUser,
  getPriceForSku,
  getPriceHistory,
  getWatchlist,
  getAlerts,
  getAlert,
  isApiConfigured,
  searchProducts,
};
