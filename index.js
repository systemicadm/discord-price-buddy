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
const startupReadyMarker = process.env.STARTUP_READY_MARKER || 'PB_BOT_READY';
const MAX_DISCORD_REPLY_LENGTH = 1900;
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

function isHtmlDocument(text) {
  if (!text) {
    return false;
  }

  const normalized = text.trim().toLowerCase();
  return normalized.startsWith('<!doctype html') || normalized.startsWith('<html');
}

function toSingleLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function truncateForDiscord(text, maxLength = MAX_DISCORD_REPLY_LENGTH) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  const suffix = '...';
  return text.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
}

function getUserFacingErrorMessage(error) {
  const rawMessage = error?.message || 'Unknown error';
  let message = rawMessage;

  if (isHtmlDocument(rawMessage) || rawMessage.toLowerCase().includes('<html')) {
    message = 'PriceBuddy API returned an HTML error page. Check PRICEBUDDY_API_URL and ensure it points to the API base URL, not a website route.';
  }

  return truncateForDiscord(`Request failed: ${toSingleLine(message)}`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let shutdownInProgress = false;

async function shutdownGracefully(signal) {
  if (shutdownInProgress) {
    log('warn', 'Shutdown already in progress, ignoring duplicate signal', { signal });
    return;
  }

  shutdownInProgress = true;
  log('info', 'Shutdown signal received, closing Discord client gracefully', { signal });

  const hardStopTimer = setTimeout(() => {
    log('error', 'Graceful shutdown timeout reached, forcing process exit', { signal, timeoutMs: 10000 });
    process.exit(1);
  }, 10000);
  hardStopTimer.unref();

  try {
    if (client?.isReady()) {
      log('info', 'Destroying Discord client session');
    }

    client.destroy();
    clearTimeout(hardStopTimer);
    log('info', 'Discord client shutdown complete');
    process.exit(0);
  } catch (error) {
    log('error', 'Error during graceful shutdown', {
      signal,
      error: serializeError(error),
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdownGracefully('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdownGracefully('SIGINT');
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

function normalizeApiPath(path) {
  const rawPath = String(path || '').trim();
  if (!rawPath) {
    return '';
  }

  const pathWithoutLeadingSlash = rawPath.replace(/^\/+/, '');
  const basePath = new URL(`${apiBaseUrl}/`).pathname.replace(/^\/+|\/+$/g, '');

  if (!basePath) {
    return pathWithoutLeadingSlash;
  }

  if (pathWithoutLeadingSlash.toLowerCase() === basePath.toLowerCase()) {
    return '';
  }

  if (pathWithoutLeadingSlash.toLowerCase().startsWith(`${basePath.toLowerCase()}/`)) {
    return pathWithoutLeadingSlash.slice(basePath.length + 1);
  }

  return pathWithoutLeadingSlash;
}

function buildApiUrl(path, query = {}) {
  const base = apiBaseUrl.replace(/\/$/, '');
  const normalizedPath = normalizeApiPath(path);
  const url = new URL(normalizedPath, `${base}/`);

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
    Accept: 'application/json',
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
    const responsePreview = text ? text.slice(0, 500) : response.statusText;
    const responseSummary = isHtmlDocument(text)
      ? 'Received an HTML error page instead of API JSON. Verify PRICEBUDDY_API_URL points to your API base.'
      : toSingleLine((text || response.statusText || '').slice(0, 300));

    log('error', 'PriceBuddy API request failed', {
      requestId,
      path,
      method,
      status: response.status,
      durationMs: Date.now() - startTime,
      responseBodyPreview: responsePreview,
    });
    throw new Error(`PriceBuddy API request failed (${response.status}): ${responseSummary}`);
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
  const product = await resolveProductForWatch(sku);
  return getProductDetail(product.id, true);
}

async function getStatus() {
  return tryApiRoutes([
    '/client-config',
    '/api/client-config',
    '/status',
    '/api/status',
    '/health',
    '/api/health',
  ]);
}

async function searchProducts(term) {
  return tryApiRoutes([
    '/products',
    '/api/products',
  ], 'GET', undefined, {
    'filter[search]': term,
    per_page: 25,
  });
}

async function getPriceHistory(sku) {
  const product = await resolveProductForWatch(sku);
  return getProductDetail(product.id, true);
}

async function getWatchlist() {
  return tryApiRoutes([
    '/products',
    '/api/products',
  ]);
}

async function addWatch(sku, target) {
  const product = await resolveProductForWatch(sku);
  const payload = {
    title: product.title || product.name || `Product ${product.id}`,
    image: product.image || 'https://pricebuddy.systemicnet.com/favicon.ico',
    paused: false,
    notify_in_stock: true,
    notify_on_change: true,
  };

  if (target !== undefined && target !== null && target !== '') {
    const numericTarget = Number(target);
    if (!Number.isFinite(numericTarget)) {
      throw new Error('Target must be a number (for example: 19.99).');
    }

    payload.target_price = numericTarget;
  }

  await tryApiRoutes([
    `/products/${encodeURIComponent(product.id)}`,
    `/api/products/${encodeURIComponent(product.id)}`,
  ], 'PUT', payload);

  return {
    message: `Watch enabled for ${product.title || product.name || `product ${product.id}`}`,
    product_id: product.id,
    target_price: payload.target_price,
  };
}

async function removeWatch(sku) {
  const product = await resolveProductForWatch(sku);
  const payload = {
    title: product.title || product.name || `Product ${product.id}`,
    image: product.image || 'https://pricebuddy.systemicnet.com/favicon.ico',
    notify_in_stock: false,
    notify_on_change: false,
  };

  await tryApiRoutes([
    `/products/${encodeURIComponent(product.id)}`,
    `/api/products/${encodeURIComponent(product.id)}`,
  ], 'PUT', payload);

  return {
    message: `Watch disabled for ${product.title || product.name || `product ${product.id}`}`,
    product_id: product.id,
  };
}

async function getAlerts() {
  return tryApiRoutes([
    '/products',
    '/api/products',
  ]);
}

async function getAlert(id) {
  return getProductDetail(id, true);
}

async function addProductByUrl(productUrl) {
  const rawUrl = String(productUrl || '').trim();
  if (!rawUrl) {
    throw new Error('A product URL is required.');
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(rawUrl).toString();
  } catch (_error) {
    throw new Error('The product URL is invalid. Example: https://example.com/product/123');
  }

  const parsedUrl = new URL(normalizedUrl);
  const pathLeaf = decodeURIComponent(parsedUrl.pathname.split('/').filter(Boolean).pop() || '').trim();
  const derivedTitle = pathLeaf
    ? pathLeaf.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    : `Product from ${parsedUrl.hostname}`;

  const payloadCandidates = [
    { title: derivedTitle, url: normalizedUrl },
    { title: derivedTitle, product_url: normalizedUrl },
    { title: derivedTitle, link: normalizedUrl },
    { url: normalizedUrl },
    { product_url: normalizedUrl },
    { link: normalizedUrl },
  ];

  let lastError = null;
  for (const payload of payloadCandidates) {
    try {
      return await tryApiRoutes([
        '/products',
        '/api/products',
      ], 'POST', payload);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to add product by URL.');
}

async function getProductDetail(productId, includeInsights = false) {
  const query = includeInsights ? { include: 'insights' } : {};
  return tryApiRoutes([
    `/products/${encodeURIComponent(productId)}`,
    `/api/products/${encodeURIComponent(productId)}`,
  ], 'GET', undefined, query);
}

async function resolveProductForWatch(identifier) {
  const trimmedIdentifier = String(identifier || '').trim();
  if (!trimmedIdentifier) {
    throw new Error('A product identifier is required.');
  }

  if (/^\d+$/.test(trimmedIdentifier)) {
    try {
      const productById = await tryApiRoutes([
        `/products/${encodeURIComponent(trimmedIdentifier)}`,
        `/api/products/${encodeURIComponent(trimmedIdentifier)}`,
      ]);
      const unwrapped = unwrapData(productById);
      if (unwrapped && typeof unwrapped === 'object') {
        return unwrapped;
      }
    } catch (_error) {
      // Fall back to search lookup when ID lookup fails.
    }
  }

  const searchResult = await tryApiRoutes([
    '/products',
    '/api/products',
  ], 'GET', undefined, {
    'filter[search]': trimmedIdentifier,
    per_page: 25,
  });

  const products = pickCollection(searchResult);
  if (products.length === 0) {
    throw new Error(`No product found for "${trimmedIdentifier}".`);
  }

  const exactMatch = products.find((product) => {
    const candidates = [
      product?.sku,
      product?.title,
      product?.name,
      product?.id !== undefined ? String(product.id) : null,
    ].filter(Boolean).map((value) => String(value).toLowerCase());

    return candidates.includes(trimmedIdentifier.toLowerCase());
  });

  return exactMatch || products[0];
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

function unwrapData(result) {
  if (result && typeof result === 'object' && result.data !== undefined) {
    return result.data;
  }

  return result;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}

function formatMoney(value, currency) {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return String(value);
  }

  if (!currency) {
    return parsed.toFixed(2);
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(parsed);
  } catch (_error) {
    return `${parsed.toFixed(2)} ${currency}`;
  }
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractStoreName(item, productUrl) {
  const insightsStore = Array.isArray(item?.insights?.stores) && item.insights.stores.length > 0
    ? item.insights.stores[0]
    : null;

  const store = firstNonEmptyString([
    item?.store?.name,
    item?.store_name,
    item?.store,
    item?.merchant?.name,
    item?.merchant_name,
    item?.retailer?.name,
    item?.retailer_name,
    item?.vendor?.name,
    item?.vendor_name,
    item?.shop?.name,
    item?.shop_name,
    item?.source?.name,
    item?.latest_price?.store_name,
    item?.latestPrice?.store_name,
    insightsStore?.name,
  ]);

  if (store) {
    return store;
  }

  if (!productUrl) {
    return null;
  }

  try {
    return new URL(productUrl).hostname.replace(/^www\./i, '');
  } catch (_error) {
    return null;
  }
}

function extractProductUrl(item) {
  return firstNonEmptyString([
    item?.url,
    item?.product_url,
    item?.productUrl,
    item?.link,
    item?.store_url,
    item?.store?.url,
    item?.merchant?.url,
    item?.retailer?.url,
    item?.vendor?.url,
    item?.source?.url,
    item?.product?.url,
    item?.links?.self,
    item?.links?.product,
    item?.latest_price?.url,
    item?.latestPrice?.url,
    item?.insights?.url,
    item?.insights?.bestUrl,
  ]);
}

function friendlyStatus(result) {
  const payload = unwrapData(result);
  if (!payload || typeof payload !== 'object') {
    return `Status:\n${formatResult(result)}`;
  }

  const status = payload.status || payload.state || 'ok';
  const version = payload.app_version || payload.version;
  const capabilities = payload.capabilities && typeof payload.capabilities === 'object'
    ? Object.keys(payload.capabilities).filter((key) => payload.capabilities[key])
    : [];

  const lines = [
    `Service status: ${status}`,
  ];

  if (version) {
    lines.push(`Version: ${version}`);
  }

  if (capabilities.length > 0) {
    lines.push(`Capabilities: ${capabilities.slice(0, 6).join(', ')}`);
  }

  return lines.join('\n');
}

function friendlyPrice(sku, result) {
  const payload = unwrapData(result);
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item || typeof item !== 'object') {
    return `Price for ${sku}:\n${formatResult(result)}`;
  }

  const title = item.title || item.name || `Product ${sku}`;
  const price = item.price
    ?? item.current_price
    ?? item.currentPrice
    ?? item.insights?.stats?.current
    ?? item.insights?.bestPrice;
  const currency = item.currency || item.currency_code || item.insights?.currency;
  const store = item.store?.name || item.store_name || item.store;
  const updated = item.updated_at || item.updatedAt || item.last_checked_at;

  const lines = [
    `Price for ${title}`,
    `Current: ${formatMoney(price, currency)}`,
  ];

  if (store) {
    lines.push(`Store: ${store}`);
  }

  if (updated) {
    lines.push(`Updated: ${updated}`);
  }

  return lines.join('\n');
}

function pickCollection(result) {
  const payload = unwrapData(result);
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.items)) {
      return payload.items;
    }
    if (Array.isArray(payload.results)) {
      return payload.results;
    }
    if (Array.isArray(payload.history)) {
      return payload.history;
    }
  }

  return [];
}

function friendlySearch(term, result) {
  const items = pickCollection(result);
  if (items.length === 0) {
    return `No products found for "${term}".`;
  }

  const lines = [`Found ${items.length} result(s) for "${term}":`];
  items.slice(0, 8).forEach((item, index) => {
    const title = item?.title || item?.name || item?.sku || 'Untitled product';
    const price = formatMoney(
      item?.price
        ?? item?.current_price
        ?? item?.currentPrice
        ?? item?.latest_price?.price
        ?? item?.latestPrice?.price
        ?? item?.insights?.stats?.current
        ?? item?.insights?.bestPrice,
      item?.currency || item?.currency_code || item?.latest_price?.currency || item?.latestPrice?.currency || item?.insights?.currency,
    );
    const url = extractProductUrl(item);
    const store = extractStoreName(item, url);
    lines.push(`${index + 1}. ${title} (${price})`);
    if (store) {
      lines.push(`   Store: ${store}`);
    }
    if (url) {
      lines.push(`   URL: ${url}`);
    }
  });

  if (items.length > 8) {
    lines.push(`...and ${items.length - 8} more`);
  }

  return lines.join('\n');
}

function friendlyHistory(sku, result) {
  const payload = unwrapData(result);
  const history = Array.isArray(payload?.history)
    ? payload.history
    : Array.isArray(payload?.price_history)
      ? payload.price_history
      : Array.isArray(payload?.prices)
        ? payload.prices
        : Array.isArray(payload?.price_cache)
          ? payload.price_cache
          : Array.isArray(payload)
            ? payload
            : [];

  if (history.length === 0) {
    const title = payload?.title || payload?.name || sku;
    const current = payload?.insights?.stats?.current;
    const best = payload?.insights?.bestPrice;
    const currency = payload?.currency || payload?.currency_code || payload?.insights?.currency;

    if (current !== undefined || best !== undefined) {
      const lines = [
        `History for ${title}`,
      ];

      if (current !== undefined) {
        lines.push(`Current: ${formatMoney(current, currency)}`);
      }

      if (best !== undefined) {
        lines.push(`Best observed: ${formatMoney(best, currency)}`);
      }

      lines.push('No detailed history array returned by this endpoint.');
      return lines.join('\n');
    }

    return `No price history found for ${sku}.`;
  }

  const latest = history[history.length - 1];
  const previous = history[Math.max(history.length - 2, 0)];
  const latestPrice = latest?.price ?? latest?.value;
  const previousPrice = previous?.price ?? previous?.value;
  const currency = latest?.currency || previous?.currency;

  const lines = [
    `History for ${sku}`,
    `Entries: ${history.length}`,
    `Latest: ${formatMoney(latestPrice, currency)} (${latest?.date || latest?.timestamp || 'unknown date'})`,
  ];

  if (history.length > 1) {
    lines.push(`Previous: ${formatMoney(previousPrice, currency)} (${previous?.date || previous?.timestamp || 'unknown date'})`);
  }

  return lines.join('\n');
}

function friendlyCollection(title, result) {
  let items = pickCollection(result);

  if (title.toLowerCase() === 'alerts') {
    items = items.filter((item) => Boolean(
      item?.notify_on_change
      || item?.notify_in_stock
      || item?.target_price !== undefined
      || item?.target !== undefined
    ));
  }

  if (items.length === 0) {
    return `${title}: none found.`;
  }

  const lines = [`${title}: ${items.length} item(s)`];
  items.slice(0, 10).forEach((item, index) => {
    const name = item?.title || item?.name || item?.sku || item?.id || `item-${index + 1}`;
    const state = item?.active !== undefined ? (item.active ? 'active' : 'inactive') : null;
    lines.push(`${index + 1}. ${name}${state ? ` (${state})` : ''}`);
  });

  if (items.length > 10) {
    lines.push(`...and ${items.length - 10} more`);
  }

  return lines.join('\n');
}

function friendlyAction(prefix, result) {
  const payload = unwrapData(result);
  if (!payload || typeof payload !== 'object') {
    return `${prefix} complete.`;
  }

  const message = payload.message || payload.status || payload.result;
  return `${prefix}: ${message || 'ok'}`;
}

client.on('ready', () => {
  log('info', 'Discord client ready', {
    userTag: client.user?.tag,
    userId: client.user?.id,
  });
  // Plain startup marker for Pelican/Wings "done" detection.
  console.log(startupReadyMarker);
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
      await message.reply('Usage: `!pb help` | `!pb status` | `!pb sync` | `!pb add <url>` | `!pb price <sku>` | `!pb search <term>` | `!pb history <sku>` | `!pb watch <sku> [target]` | `!pb unwatch <sku>` | `!pb watchlist` | `!pb alerts`');
      return;
    }

    if (command === 'help') {
      await message.reply('Available commands: `status`, `sync`, `add <url>`, `price <sku>`, `search <term>`, `history <sku>`, `watch <sku> [target]`, `unwatch <sku>`, `watchlist`, `alerts`, `alert <id>`');
      return;
    }

    if (command === 'status') {
      const result = await getStatus();
      await message.reply(truncateForDiscord(friendlyStatus(result)));
      return;
    }

    if (command === 'sync') {
      const result = await callPriceBuddyApi('/sync', 'POST', { source: 'discord' });
      await message.reply(truncateForDiscord(friendlyAction('Sync started', result)));
      return;
    }

    if (command === 'add') {
      const productUrl = args[1];
      if (!productUrl) {
        await message.reply('Usage: `!pb add <url>`');
        return;
      }

      const result = await addProductByUrl(productUrl);
      await message.reply(truncateForDiscord(friendlyAction('Product add requested', result)));
      return;
    }

    if (command === 'price') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb price <sku>`');
        return;
      }

      const result = await getPriceForSku(sku);
      await message.reply(truncateForDiscord(friendlyPrice(sku, result)));
      return;
    }

    if (command === 'search') {
      const term = args.slice(1).join(' ');
      if (!term) {
        await message.reply('Usage: `!pb search <term>`');
        return;
      }

      const result = await searchProducts(term);
      await message.reply(truncateForDiscord(friendlySearch(term, result)));
      return;
    }

    if (command === 'history') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb history <sku>`');
        return;
      }

      const result = await getPriceHistory(sku);
      await message.reply(truncateForDiscord(friendlyHistory(sku, result)));
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
      await message.reply(truncateForDiscord(friendlyAction(`Watch created for ${sku}`, result)));
      return;
    }

    if (command === 'unwatch') {
      const sku = args[1];
      if (!sku) {
        await message.reply('Usage: `!pb unwatch <sku>`');
        return;
      }

      const result = await removeWatch(sku);
      await message.reply(truncateForDiscord(friendlyAction(`Removed watch for ${sku}`, result)));
      return;
    }

    if (command === 'watchlist') {
      const result = await getWatchlist();
      await message.reply(truncateForDiscord(friendlyCollection('Watchlist', result)));
      return;
    }

    if (command === 'alerts') {
      const result = await getAlerts();
      await message.reply(truncateForDiscord(friendlyCollection('Alerts', result)));
      return;
    }

    if (command === 'alert') {
      const id = args[1];
      if (!id) {
        await message.reply('Usage: `!pb alert <id>`');
        return;
      }

      const result = await getAlert(id);
      await message.reply(truncateForDiscord(friendlyAction(`Alert ${id}`, result)));
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
    await message.reply(getUserFacingErrorMessage(error));
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
      const result = await getStatus();
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('PriceBuddy status')
            .setDescription(truncateForDiscord(friendlyStatus(result)))
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
            .setDescription(truncateForDiscord(friendlyPrice(sku, result)))
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
            .setDescription(truncateForDiscord(friendlySearch(term, result)))
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
            .setDescription(truncateForDiscord(friendlyHistory(sku, result)))
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
            .setDescription(truncateForDiscord(friendlyAction(`Watch added for ${sku}`, result)))
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
            .setDescription(truncateForDiscord(friendlyAction(`Watch removed for ${sku}`, result)))
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
            .setDescription(truncateForDiscord(friendlyCollection('Watchlist', result)))
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
            .setDescription(truncateForDiscord(friendlyCollection('Alerts', result)))
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
            .setDescription(truncateForDiscord(friendlyAction(`Alert ${id}`, result)))
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

    if (interaction.commandName === 'add') {
      const productUrl = interaction.options.getString('url');
      const result = await addProductByUrl(productUrl);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Add product')
            .setDescription(truncateForDiscord(friendlyAction('Product add requested', result)))
            .setColor(0x00ae86),
        ],
      });
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
    const errorMessage = getUserFacingErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
      return;
    }

    await interaction.reply({ content: errorMessage, ephemeral: true });
  }
});

async function registerSlashCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
    log('warn', 'Skipping slash command registration because token or client ID is missing');
    return;
  }

  log('info', 'Registering Discord slash commands', {
    commandCount: 11,
    clientId: process.env.DISCORD_CLIENT_ID,
  });

  const commands = [
    { name: 'status', description: 'Check the PriceBuddy service status' },
    {
      name: 'add',
      description: 'Add a product by URL',
      options: [{ name: 'url', type: 3, description: 'Product URL', required: true }],
    },
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
  getStatus,
  getPriceHistory,
  getWatchlist,
  getAlerts,
  getAlert,
  addProductByUrl,
  isApiConfigured,
  searchProducts,
};
