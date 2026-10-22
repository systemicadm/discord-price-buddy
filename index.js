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

async function callPriceBuddyApi(path, method = 'GET', body = undefined) {
  if (!apiBaseUrl) {
    throw new Error('PRICEBUDDY_API_URL is not configured.');
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = 'Bearer ' + apiKey;
    headers['X-API-Key'] = apiKey;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PriceBuddy API request failed (${response.status}): ${text || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

function ensureApprovedUser(interactionOrMessage) {
  const userId = interactionOrMessage.user?.id ?? interactionOrMessage.author?.id;
  if (!userId || !approvedUserIds.has(userId)) {
    throw new Error('You are not authorized to use this bot.');
  }
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
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand) {
      await message.reply('Usage: `!pb status` | `!pb sync` | `!pb price <sku>`');
      return;
    }

    if (subcommand === 'status') {
      const result = await callPriceBuddyApi('/status');
      await message.reply(`Status: ${JSON.stringify(result)}`);
      return;
    }

    if (subcommand === 'sync') {
      const result = await callPriceBuddyApi('/sync', 'POST', { source: 'discord' });
      await message.reply(`Sync started: ${JSON.stringify(result)}`);
      return;
    }

    if (subcommand === 'price') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb price <sku>`');
        return;
      }

      const result = await callPriceBuddyApi(`/prices/${encodeURIComponent(sku)}`);
      await message.reply(`Price for ${sku}: ${JSON.stringify(result)}`);
      return;
    }

    await message.reply('Unknown command. Usage: `!pb status` | `!pb sync` | `!pb price <sku>`');
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
            .setDescription(JSON.stringify(result, null, 2))
            .setColor(0x00ae86),
        ],
      });
      return;
    }

    if (interaction.commandName === 'price') {
      const sku = interaction.options.getString('sku');
      const result = await callPriceBuddyApi(`/prices/${encodeURIComponent(sku)}`);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Price for ${sku}`)
            .setDescription(JSON.stringify(result, null, 2))
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
    {
      name: 'status',
      description: 'Check the PriceBuddy service status',
    },
    {
      name: 'price',
      description: 'Look up a product price',
      options: [{ name: 'sku', type: 3, description: 'SKU or product identifier', required: true }],
    },
    {
      name: 'sync',
      description: 'Trigger a service sync',
    },
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
  callPriceBuddyApi,
  ensureApprovedUser,
  isApiConfigured,
};
