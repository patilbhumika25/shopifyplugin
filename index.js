import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

const __filenameRoot = fileURLToPath(import.meta.url);
const __dirnameRoot = path.dirname(__filenameRoot);

let dbUrl = process.env.DATABASE_URL;
if (!isProd) {
  dbUrl = `file:${path.resolve(__dirnameRoot, 'prisma/dev.db')}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
});

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST;

if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !HOST) {
  console.error('Missing SHOPIFY_API_KEY, SHOPIFY_API_SECRET, or HOST in .env file');
  process.exit(1);
}

// Ensure HOST does not have a trailing slash, and extract hostname
const hostName = new URL(HOST).hostname;

// Session storage: use file-based storage for dev (persists across restarts)
// Production should use SQLiteSessionStorage
let sessionStorage;
if (isProd) {
  const { SQLiteSessionStorage } = await import('@shopify/shopify-app-session-storage-sqlite');
  const sessionDbPath = process.env.SESSION_DB_PATH || 'session_db.sqlite';
  sessionStorage = new SQLiteSessionStorage(sessionDbPath);
} else {
  // File-based session storage — persists across server restarts
  const SESSION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sessions.json');
  console.log(`[DEBUG] Session file path: ${SESSION_FILE}`);

  function readSessions() {
    try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); }
    catch { return {}; }
  }
  function writeSessions(data) {
    try {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
      console.log(`[DEBUG] Written sessions.json (${Object.keys(data).length} sessions)`);
    } catch (e) {
      console.error(`[ERROR] Failed to write sessions.json: ${e.message}`);
    }
  }

  sessionStorage = {
    async storeSession(session) {
      console.log(`[DEBUG] storeSession called: id=${session.id}, shop=${session.shop}, hasToken=${!!session.accessToken}`);
      const data = readSessions();
      data[session.id] = session;
      writeSessions(data);
      return true;
    },
    async loadSession(id) {
      const data = readSessions();
      return data[id] || undefined;
    },
    async deleteSession(id) {
      const data = readSessions();
      delete data[id];
      writeSessions(data);
      return true;
    },
    async deleteSessions(ids) {
      const data = readSessions();
      ids.forEach(id => delete data[id]);
      writeSessions(data);
      return true;
    },
    async findSessionsByShop(shop) {
      const data = readSessions();
      return Object.values(data).filter(s => s.shop === shop);
    },
  };
  console.log('[DEBUG] Using file-based session storage (sessions.json)');
}

// Initialize the Shopify API Object
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES ? process.env.SCOPES.split(',') : ['read_products'],
  hostName: hostName,
  hostScheme: 'https',
  apiVersion: ApiVersion.January25,
  isEmbeddedApp: true,
  sessionStorage,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
console.log('[DEBUG] Express app created');

// Serve built frontend assets (run `cd frontend && npm run build`)
app.use(express.static(path.join(__dirnameRoot, 'frontend/dist'), { index: false }));

// Webhook handling must be parsed raw, before any other body parsers
app.post(
  '/api/webhooks',
  express.text({ type: '*/*' }),
  async (req, res) => {
    try {
      await shopify.webhooks.process({
        rawBody: req.body,
        rawRequest: req,
        rawResponse: res,
      });
      console.log('Webhook processed successfully');
    } catch (error) {
      console.error(`Failed to process webhook: ${error.message}`);
      // Send a 500 error if we failed to process the webhook
      if (!res.headersSent) {
        res.status(500).send(error.message);
      }
    }
  }
);

console.log('[DEBUG] Webhook POST route registered');
// We define our webhook handlers here
shopify.webhooks.addHandlers({
  APP_UNINSTALLED: {
    deliveryMethod: 'http',
    callbackUrl: '/api/webhooks',
    callback: async (topic, shop, body, webhookId) => {
      console.log(`[APP_UNINSTALLED] Cleaning up shop: ${shop}`);
      try {
        // Delete all activity logs for this shop's offers
        const offers = await prisma.offer.findMany({ where: { shop }, select: { id: true } });
        const offerIds = offers.map(o => o.id);
        if (offerIds.length > 0) {
          await prisma.offerActivity.deleteMany({ where: { offerId: { in: offerIds } } });
        }
        // Delete all offers for this shop
        await prisma.offer.deleteMany({ where: { shop } });
        // Delete sessions
        const sessions = await sessionStorage.findSessionsByShop(shop);
        if (sessions?.length > 0) {
          await sessionStorage.deleteSessions(sessions.map(s => s.id));
        }
        console.log(`[APP_UNINSTALLED] Cleaned up ${offerIds.length} offers and ${sessions?.length || 0} sessions for ${shop}`);
      } catch (err) {
        console.error(`[APP_UNINSTALLED] Cleanup error for ${shop}:`, err.message);
      }
    },
  },
  // Adding mandatory GDPR Webhook topics (Shopify will send these after app approval)
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: 'http',
    callbackUrl: '/api/webhooks',
    callback: async (topic, shop, body, webhookId) => {
      console.log(`[CUSTOMERS_DATA_REQUEST] Received for ${shop}`);
    }
  },
  CUSTOMERS_REDACT: {
    deliveryMethod: 'http',
    callbackUrl: '/api/webhooks',
    callback: async (topic, shop, body, webhookId) => {
      console.log(`[CUSTOMERS_REDACT] Received for ${shop}`);
    }
  },
  SHOP_REDACT: {
    deliveryMethod: 'http',
    callbackUrl: '/api/webhooks',
    callback: async (topic, shop, body, webhookId) => {
      console.log(`[SHOP_REDACT] Received for ${shop}`);
    }
  }
});

// Middleware for parsing JSON (must be placed after the webhook body parser)
app.use(express.json());
console.log('[DEBUG] JSON middleware added');

// Basic in-memory rate limiting (100 requests per 15 minutes per IP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 100;

app.use('/api', (req, res, next) => {
  // Skip webhooks and auth routes from rate limiting
  if (req.path.startsWith('/webhooks') || req.path.startsWith('/auth')) return next();

  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
});

// Clean up rate limit map every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.start > RATE_LIMIT_WINDOW) rateLimitMap.delete(ip);
  }
}, 30 * 60 * 1000);


// Universal Install Page for Merchants
app.get('/install', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Install Shopify App</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f6f8; margin: 0; }
        .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 100%; max-width: 400px; text-align: center; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #202223; }
        p { color: #6d7175; margin-bottom: 1.5rem; font-size: 0.9rem; margin-top: 0; }
        input { width: 100%; padding: 12px; margin-bottom: 1rem; border: 1px solid #c9cccf; border-radius: 4px; box-sizing: border-box; font-size: 1rem; outline: none; transition: border-color 0.2s; }
        input:focus { border-color: #008060; }
        button { background-color: #008060; color: white; border: none; padding: 12px 20px; font-size: 1rem; border-radius: 4px; cursor: pointer; width: 100%; font-weight: 600; transition: background-color 0.2s; }
        button:hover { background-color: #006e52; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Install Shopify App</h1>
        <p>Enter your store's domain to install this app.</p>
        <form action="/api/auth" method="GET">
          <input type="text" name="shop" placeholder="e.g. my-store.myshopify.com" required />
          <button type="submit">Install Now</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// OAuth: Begin the installation process
app.get('/api/auth', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      res.status(400).send('Missing shop parameter');
      return;
    }

    const authRoute = await shopify.auth.begin({
      shop: shop.toString(),
      callbackPath: '/api/auth/callback',
      isOnline: false, // Use offline tokens for backend processes
      rawRequest: req,
      rawResponse: res,
    });

    // The response is handled internally by shopify.auth.begin
  } catch (error) {
    console.error('Error starting OAuth:', error);
    res.status(500).send('Error starting OAuth');
  }
});

// OAuth: Handle the callback from Shopify
app.get('/api/auth/callback', async (req, res) => {
  try {
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callbackResponse;
    console.log(`[DEBUG] OAuth callback session: id=${session.id}, shop=${session.shop}, hasToken=${!!session.accessToken}`);

    // Explicitly store the session (v12 may not auto-store with custom storage)
    await sessionStorage.storeSession(session);

    // Register webhooks after installation
    await shopify.webhooks.register({ session });

    // Redirect to the embedded app UI in Shopify admin
    const shopUrl = `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
    res.redirect(shopUrl);
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).send('Error handling OAuth callback');
  }
});

// ---------------------------------------------------------------------
// API Routes for Managing Offers (Called by our App Bridge Frontend)
// ---------------------------------------------------------------------

// Get the shop name from the session
async function getShopFromSession(req, res) {
  // Try to get the real session first (works after OAuth install)
  try {
    const sessionId = await shopify.session.getCurrentId({ isOnline: false, rawRequest: req, rawResponse: res });
    if (sessionId) {
      const session = await shopify.config.sessionStorage.loadSession(sessionId);
      if (session?.shop) return session.shop;
    }
  } catch (e) {
    // No session token in request
  }

  // In dev mode, return a default shop so basic CRUD still works
  if (!isProd) {
    return process.env.SHOP || 'dev-store.myshopify.com';
  }
  return null;
}

// Load the offline session for a shop (stored during OAuth)
async function loadOfflineSession(shop) {
  // Offline session ID format: "offline_{shop}"
  const sessionId = `offline_${shop}`;
  try {
    const session = await shopify.config.sessionStorage.loadSession(sessionId);
    return session?.accessToken ? session : null;
  } catch (e) {
    return null;
  }
}

// Get an authenticated GraphQL client
// Tries: 1) session token from request, 2) offline session from stored shop
async function getGraphQLClient(req, res, shop) {
  try {
    // First try: get session from request Authorization header
    const sessionId = await shopify.session.getCurrentId({ isOnline: false, rawRequest: req, rawResponse: res });
    if (sessionId) {
      const session = await shopify.config.sessionStorage.loadSession(sessionId);
      if (session?.accessToken) {
        return new shopify.clients.Graphql({ session });
      }
    }
  } catch (e) {
    // No session token in request header — try offline session
  }

  // Fallback: load the offline session directly by shop name
  // The shop param can come from getShopFromSession or from stored sessions
  if (shop) {
    const session = await loadOfflineSession(shop);
    if (session) {
      return new shopify.clients.Graphql({ session });
    }
  }

  // Last resort: scan sessions.json directly for any valid session
  try {
    const SESSION_FILE = path.join(__dirname, 'sessions.json');
    console.log(`🔍 Scanning ${SESSION_FILE}...`);
    if (fs.existsSync(SESSION_FILE)) {
      const allSessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      const keys = Object.keys(allSessions);
      console.log(`🔍 Found ${keys.length} sessions: ${keys.join(', ')}`);
      for (const [key, session] of Object.entries(allSessions)) {
        // Shopify Session might serialize accessToken differently
        const token = session.accessToken || session.access_token;
        console.log(`🔍 Session ${key}: shop=${session.shop}, hasToken=${!!token}, keys=${Object.keys(session).join(',')}`);
        if (token) {
          // Ensure accessToken is set (normalize)
          session.accessToken = token;
          console.log(`📌 Found stored session for shop: ${session.shop}`);
          return new shopify.clients.Graphql({ session });
        }
      }
    } else {
      console.log('🔍 sessions.json does not exist');
    }
  } catch (e) {
    console.error('Error scanning sessions.json:', e.message);
  }

  console.log('ℹ️ No GraphQL session — offer saved locally only (Shopify discount not created)');
  return null;
}

// Map offer type to function extension handle
const TYPE_TO_HANDLE = {
  BOGO: 'bogo-discount',
  FREE_GIFT: 'free-gift-discount',
  VOLUME: 'volume-discount',
  COMBO: 'combo-discount',
};

// Find the Shopify Function ID by handle
async function findFunctionId(client, handle) {
  const query = `
    query {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
          app {
            handle
          }
        }
      }
    }
  `;
  try {
    const response = await client.request(query);
    const functions = response.data?.shopifyFunctions?.nodes || [];

    // Debug: log all available functions
    console.log(`🔍 Looking for function: "${handle}"`);
    console.log(`🔍 Available functions (${functions.length}):`);
    functions.forEach(f => {
      console.log(`   - id: ${f.id}, title: "${f.title}", apiType: ${f.apiType}, appHandle: ${f.app?.handle}`);
    });

    // Match by title, app handle, or ID
    const searchTerm = handle.replaceAll('-', ' ').toLowerCase();
    const found = functions.find(f =>
      f.title?.toLowerCase().includes(searchTerm) ||
      f.title?.toLowerCase().includes(handle) ||
      f.app?.handle?.toLowerCase() === handle ||
      f.id?.includes(handle)
    );

    if (found) {
      console.log(`✅ Matched function: ${found.id} (${found.title})`);
    }
    return found?.id || null;
  } catch (err) {
    console.error('Error finding function ID:', err.message);
    return null;
  }
}

// Create a Shopify automatic discount linked to a function
async function createShopifyDiscount(client, { title, type, configurationJson, functionId }) {
  // Namespace must match what run.graphql expects: $app:{extension-handle}
  const handle = TYPE_TO_HANDLE[type] || 'bogo-discount';
  const metafieldNamespace = `$app:${handle}`;
  const metafieldKey = 'function-configuration';

  const mutation = `
    mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    automaticAppDiscount: {
      title,
      functionId,
      startsAt: new Date().toISOString(),
      combinesWith: {
        orderDiscounts: true,
        productDiscounts: true,
        shippingDiscounts: true,
      },
      metafields: [
        {
          namespace: metafieldNamespace,
          key: metafieldKey,
          type: 'json',
          value: typeof configurationJson === 'string'
            ? configurationJson
            : JSON.stringify(configurationJson),
        },
      ],
    },
  };

  try {
    const response = await client.request(mutation, { variables });
    const result = response.data?.discountAutomaticAppCreate;
    if (result?.userErrors?.length > 0) {
      console.error('Shopify discount creation errors:', result.userErrors);
      return { error: result.userErrors.map(e => e.message).join(', ') };
    }
    return { discountId: result?.automaticAppDiscount?.discountId };
  } catch (err) {
    console.error('Error creating Shopify discount:', err.message);
    return { error: err.message };
  }
}

// Delete a Shopify automatic discount
async function deleteShopifyDiscount(client, discountId) {
  const mutation = `
    mutation discountAutomaticDelete($id: ID!) {
      discountAutomaticDelete(id: $id) {
        deletedAutomaticDiscountId
        userErrors {
          field
          message
        }
      }
    }
  `;
  try {
    await client.request(mutation, { variables: { id: discountId } });
  } catch (err) {
    console.error('Error deleting Shopify discount:', err.message);
  }
}

// Update the metafield on an existing Shopify automatic discount
async function updateShopifyDiscount(client, { discountId, title, type, configurationJson }) {
  const handle = TYPE_TO_HANDLE[type] || 'bogo-discount';
  const metafieldNamespace = `$app:${handle}`;
  const metafieldKey = 'function-configuration';

  // First, fetch the existing metafield ID on this discount
  const getQuery = `
    query getMetafield($id: ID!, $namespace: String!, $key: String!) {
      discountNode(id: $id) {
        metafield(namespace: $namespace, key: $key) {
          id
        }
      }
    }
  `;

  let existingMetafieldId = null;
  try {
    const getResponse = await client.request(getQuery, {
      variables: { id: discountId, namespace: metafieldNamespace, key: metafieldKey }
    });
    existingMetafieldId = getResponse.data?.discountNode?.metafield?.id;
  } catch (err) {
    console.error('Error fetching existing metafield:', err.message);
  }

  const mutation = `
    mutation discountAutomaticAppUpdate($automaticAppDiscount: DiscountAutomaticAppInput!, $id: ID!) {
      discountAutomaticAppUpdate(automaticAppDiscount: $automaticAppDiscount, id: $id) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const metafieldValue = typeof configurationJson === 'string'
    ? configurationJson
    : JSON.stringify(configurationJson);

  let metafieldInput;

  // If we found the existing metafield, tell Shopify its ID so it updates instead of creates.
  // Shopify rejects the update if `namespace` and `key` are included alongside the `id`.
  if (existingMetafieldId) {
    metafieldInput = {
      id: existingMetafieldId,
      type: 'json',
      value: metafieldValue,
    };
  } else {
    metafieldInput = {
      namespace: metafieldNamespace,
      key: metafieldKey,
      type: 'json',
      value: metafieldValue,
    };
  }

  const variables = {
    id: discountId,
    automaticAppDiscount: {
      title,
      metafields: [metafieldInput],
    },
  };

  try {
    const response = await client.request(mutation, { variables });
    const result = response.data?.discountAutomaticAppUpdate;
    if (result?.userErrors?.length > 0) {
      console.error('Shopify discount update errors:', result.userErrors);
      return { error: result.userErrors.map(e => e.message).join(', ') };
    }
    console.log('✅ Shopify discount updated:', discountId);
    return { discountId: result?.automaticAppDiscount?.discountId };
  } catch (err) {
    console.error('Error updating Shopify discount:', err.message);
    return { error: err.message };
  }
}

// Update the shop metafield to expose free gift config to the storefront App Embed
async function updateShopMetafield(client, configurationJson) {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const query = `query { shop { id } }`;
  try {
    const shopRes = await client.request(query);
    const shopId = shopRes.data?.shop?.id;

    if (shopId) {
      const variables = {
        metafields: [
          {
            ownerId: shopId,
            namespace: "custom_discounts",
            key: "free_gift_config",
            type: "json",
            value: typeof configurationJson === 'string' ? configurationJson : JSON.stringify(configurationJson)
          }
        ]
      };
      const response = await client.request(mutation, { variables });
      const errors = response.data?.metafieldsSet?.userErrors;
      if (errors?.length > 0) {
        console.error('Shopify metafield sync errors:', errors);
      } else {
        console.log('✅ Shopify Shop metafield updated successfully.');
      }
    }
  } catch (err) {
    console.error('Error updating shop metafield:', err.message);
  }
}

// Clear the shop metafield so the App Embed stops triggering auto-adds
async function clearShopMetafield(client) {
  console.log('Clearing free_gift_config metafield...');
  await updateShopMetafield(client, "{}");
}

app.get('/api/offers', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const offers = await prisma.offer.findMany({
      where: { shop },
      orderBy: { createdAt: 'desc' }
    });
    res.json(offers);
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get offer stats summary (MUST be before /api/offers/:id to avoid Express matching 'stats' as :id)
app.get('/api/offers/stats', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const [total, active, synced, byType] = await Promise.all([
      prisma.offer.count({ where: { shop } }),
      prisma.offer.count({ where: { shop, status: 'ACTIVE' } }),
      prisma.offer.count({ where: { shop, shopifyDiscountId: { not: null } } }),
      prisma.offer.groupBy({
        by: ['type'],
        where: { shop },
        _count: true,
      }),
    ]);

    res.json({
      total,
      active,
      synced,
      byType: byType.reduce((acc, item) => {
        acc[item.type] = item._count;
        return acc;
      }, {}),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single offer by ID
app.get('/api/offers/:id', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const offer = await prisma.offer.findUnique({
      where: { id: req.params.id },
    });

    if (!offer || offer.shop !== shop) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json(offer);
  } catch (error) {
    console.error('Error fetching offer:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new offer
app.post('/api/offers', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const { title, type, configType, configurationJson } = req.body;
    const configStr = typeof configurationJson === 'string'
      ? configurationJson
      : JSON.stringify(configurationJson);

    // Save to local database first
    const offer = await prisma.offer.create({
      data: {
        shop,
        title,
        type,
        configType: configType || 'BASIC',
        configurationJson: configStr,
        status: 'ACTIVE'
      }
    });

    // Try to create the real Shopify discount via GraphQL
    const client = await getGraphQLClient(req, res, shop);
    if (client) {
      const handle = TYPE_TO_HANDLE[type];
      if (handle) {
        const functionId = await findFunctionId(client, handle);
        if (functionId) {
          const result = await createShopifyDiscount(client, {
            title,
            type,
            configurationJson: configStr,
            functionId,
          });
          if (result.discountId) {
            // Store the Shopify discount ID in our database
            await prisma.offer.update({
              where: { id: offer.id },
              data: { shopifyDiscountId: result.discountId },
            });
            offer.shopifyDiscountId = result.discountId;
            console.log(`✅ Shopify discount created: ${result.discountId}`);
          } else {
            console.warn('⚠️ Shopify discount creation failed:', result.error);
          }
        } else {
          console.warn(`⚠️ Function '${handle}' not found. Deploy functions first: npx shopify app dev`);
        }
      }

      // Sync Free Gift Metafields for App Embeds
      if (type === 'FREE_GIFT') {
        await updateShopMetafield(client, configStr);
      }
    } else {
      console.log('ℹ️ No GraphQL session — offer saved locally only (Shopify discount not created)');
    }
    // Log activity
    await logActivity(offer.id, 'CREATED', { title, type, configType: configType || 'BASIC' });
    if (offer.shopifyDiscountId) {
      await logActivity(offer.id, 'SYNCED', { discountId: offer.shopifyDiscountId });
    }

    res.json(offer);
  } catch (error) {
    console.error('Error creating offer:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update an existing offer
app.put('/api/offers/:id', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const { title, type, configType, configurationJson, status } = req.body;

    const offer = await prisma.offer.update({
      where: {
        id: req.params.id,
        shop,
      },
      data: {
        ...(title !== undefined && { title }),
        ...(type !== undefined && { type }),
        ...(configType !== undefined && { configType }),
        ...(configurationJson !== undefined && { configurationJson: JSON.stringify(configurationJson) }),
        ...(status !== undefined && { status }),
      }
    });

    // ── Sync changes to Shopify ──────────────────────────────────────
    if (offer.shopifyDiscountId && (configurationJson || title)) {
      try {
        const client = await getGraphQLClient(req, res, shop);
        if (client) {
          const updateResult = await updateShopifyDiscount(client, {
            discountId: offer.shopifyDiscountId,
            title: title || offer.title,
            type: type || offer.type,
            configurationJson: configurationJson || JSON.parse(offer.configurationJson),
          });
          if (updateResult.error) {
            console.error('⚠️ Shopify sync failed (offer still saved locally):', updateResult.error);
          }
        }
      } catch (syncErr) {
        console.error('⚠️ Shopify sync error (offer still saved locally):', syncErr.message);
      }
    }

    // Sync Free Gift Metafields for App Embeds
    if (type === 'FREE_GIFT' && configurationJson) {
      try {
        const client = await getGraphQLClient(req, res, shop);
        if (client) {
          await updateShopMetafield(client, configurationJson);
        }
      } catch (err) {
        console.error('⚠️ Shopify metafield sync error:', err.message);
      }
    }

    // Log activity (before sending response to avoid post-response crashes)
    await logActivity(offer.id, 'UPDATED', { title, type, configType });

    res.json(offer);
  } catch (error) {
    console.error('Error updating offer:', error);
    res.status(500).json({ error: error.message });
  }
});

// Activity logging helper
async function logActivity(offerId, action, details = null) {
  try {
    await prisma.offerActivity.create({
      data: {
        offerId,
        action,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (e) {
    console.error('Failed to log activity:', e.message);
  }
}

// Get activity history
app.get('/api/activities', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const activities = await prisma.offerActivity.findMany({
      where: { offer: { shop } },
      include: {
        offer: {
          select: { id: true, title: true, type: true, configType: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch product images from Shopify for given IDs
app.post('/api/products/images', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const client = await getGraphQLClient(req, res, shop);
    if (!client) return res.json({});

    const { ids } = req.body; // array of GIDs
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.json({});

    const results = {};

    // Batch fetch nodes by ID
    const query = `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            featuredImage { url altText }
          }
          ... on ProductVariant {
            id
            displayName
            image { url altText }
            product {
              id
              title
              featuredImage { url altText }
            }
          }
        }
      }
    `;

    try {
      const response = await client.request(query, { variables: { ids: ids.slice(0, 50) } });
      const nodes = response.data?.nodes || [];

      for (const node of nodes) {
        if (!node) continue;
        const img = node.image || node.featuredImage || node.product?.featuredImage;
        results[node.id] = {
          title: node.displayName || node.title || node.product?.title || '',
          imageUrl: img?.url || null,
          altText: img?.altText || '',
        };
      }
    } catch (err) {
      console.error('Error fetching product images:', err.message);
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Quick status toggle (for Dashboard)
app.patch('/api/offers/:id/status', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    const { status } = req.body;
    if (!['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.shop !== shop) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const oldStatus = existing.status;
    const offer = await prisma.offer.update({
      where: { id: req.params.id },
      data: { status },
    });

    // ── Sync status to Shopify ─────────────────────────────────────────

    try {
      const client = await getGraphQLClient(req, res, shop);
      if (client) {
        // 1. Activate or Deactivate the Shopify discount function
        if (existing.shopifyDiscountId) {
          if (status === 'ACTIVE' && oldStatus !== 'ACTIVE') {
            const activateMutation = `
              mutation discountAutomaticActivate($id: ID!) {
                discountAutomaticActivate(id: $id) {
                  automaticDiscountNode { automaticDiscount { ... on DiscountAutomaticApp { discountId } } }
                  userErrors { field message }
                }
              }
            `;
            const result = await client.request(activateMutation, { variables: { id: existing.shopifyDiscountId } });
            const errors = result.data?.discountAutomaticActivate?.userErrors;
            if (errors?.length > 0) {
              console.error('⚠️ Failed to activate Shopify discount:', errors);
            } else {
              console.log(`✅ Shopify discount activated: ${existing.shopifyDiscountId}`);
            }
          } else if (status !== 'ACTIVE' && oldStatus === 'ACTIVE') {
            const deactivateMutation = `
              mutation discountAutomaticDeactivate($id: ID!) {
                discountAutomaticDeactivate(id: $id) {
                  automaticDiscountNode { automaticDiscount { ... on DiscountAutomaticApp { discountId } } }
                  userErrors { field message }
                }
              }
            `;
            const result = await client.request(deactivateMutation, { variables: { id: existing.shopifyDiscountId } });
            const errors = result.data?.discountAutomaticDeactivate?.userErrors;
            if (errors?.length > 0) {
              console.error('⚠️ Failed to deactivate Shopify discount:', errors);
            } else {
              console.log(`✅ Shopify discount deactivated: ${existing.shopifyDiscountId}`);
            }
          }
        }

        // 2. Clear or Restore Free Gift Metafield for App Embeds
        if (existing.type === 'FREE_GIFT') {
          if (status === 'ACTIVE' && oldStatus !== 'ACTIVE') {
            console.log('Restoring free gift metafield configuration...');
            await updateShopMetafield(client, existing.configurationJson);
          } else if (status !== 'ACTIVE' && oldStatus === 'ACTIVE') {
            console.log('Offer disabled: Clearing free gift metafield...');
            await clearShopMetafield(client);
          }
        }
      }
    } catch (syncErr) {
      console.error('⚠️ Status sync error (local status still updated):', syncErr.message);
    }

    // Log activity
    await logActivity(offer.id, 'STATUS_CHANGED', {
      oldStatus,
      newStatus: status,
      message: `Status changed from ${oldStatus} to ${status}`,
    });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an offer
app.delete('/api/offers/:id', async (req, res) => {
  try {
    const shop = await getShopFromSession(req, res);
    if (!shop) return res.status(401).send('Unauthorized');

    // Fetch the offer first to get the Shopify discount ID
    const offer = await prisma.offer.findUnique({
      where: { id: req.params.id },
    });

    if (!offer || offer.shop !== shop) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Delete the Shopify discount if it exists
    const client = await getGraphQLClient(req, res, shop);
    if (client) {
      if (offer.shopifyDiscountId) {
        await deleteShopifyDiscount(client, offer.shopifyDiscountId);
        console.log(`🗑️ Shopify discount deleted: ${offer.shopifyDiscountId}`);
      }

      // Clear Free Gift metafield if a free gift offer is deleted
      if (offer.type === 'FREE_GIFT') {
        console.log('Offer deleted: Clearing free gift metafield...');
        await clearShopMetafield(client);
      }
    }

    // Log activity before deletion (the cascade will delete this log too,
    // so we log it but also console.log for permanent server-side audit trail)
    console.log(`[AUDIT] Offer deleted: id=${offer.id}, title="${offer.title}", type=${offer.type}, shop=${shop}`);

    // Delete from local database (cascades to OfferActivity)
    await prisma.offer.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Catch-all: serve the built frontend (run `cd frontend && npm run build` first)
const frontendPath = path.join(__dirnameRoot, 'frontend/dist/index.html');
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  if (fs.existsSync(frontendPath)) {
    if (isProd) {
      // Inject SHOPIFY_API_KEY dynamically for App Bridge to work
      fs.readFile(frontendPath, 'utf8', (err, data) => {
        if (err) return next(err);
        const html = data.replace(/%VITE_SHOPIFY_API_KEY%/g, process.env.SHOPIFY_API_KEY || '');
        res.send(html);
      });
    } else {
      res.sendFile(frontendPath);
    }
  } else {
    res.send('Frontend not built yet. Run: cd frontend && npm run build');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Make sure your Ngrok URL is set to ${HOST}`);
  console.log(`App Install URL: ${HOST}/api/auth?shop=your-dev-store.myshopify.com`);
});
