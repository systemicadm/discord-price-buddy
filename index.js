'use strict';

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

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

  const url = buildApiUrl(path, query);
  const headers = {
    'Content-Type': 'application/json',
  };

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
    throw new Error(`PriceBuddy API request failed (${response.status}): ${text || response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text === '' ? null : text;
}

async function tryApiRoutes(routes, method = 'GET', body = undefined, query = {}) {
  let lastError = new Error('No matching PriceBuddy API route responded successfully.');

  for (const route of routes) {
    try {
      return await callPriceBuddyApi(route, method, body, query);
    } catch (error) {
      lastError = error;
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
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!pb')) {
    return;
  }

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
    console.error('Message command failed:', error);
    await message.reply(`Request failed: ${error.message}`);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    ensureApprovedUser(interaction);

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
    console.error('Interaction failed:', error);
    await interaction.reply({ content: `Request failed: ${error.message}`, ephemeral: true });
  }
});

async function registerSlashCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
    return;
  }

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
}

(async () => {
  try {
    if (!process.env.DISCORD_TOKEN) {
      throw new Error('DISCORD_TOKEN is required. Copy .env.example to .env and add your token.');
    }

    await registerSlashCommands();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    console.error('Bot startup failed:', error);
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
