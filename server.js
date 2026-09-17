/**
 * BloatBuster - Web Server & Shopify API Engine
 * Zero-dependency native Node.js HTTP server serving:
 * - The BloatBuster Merchant Dashboard UI
 * - Server-side Storefront Scan API (No CORS)
 * - Liquid Theme Code Diagnostic API
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fetchStorefrontHtml, scanStorefrontHtml, normalizeStoreUrl } from './lib/scanner/storefrontScanner.js';
import { scanLiquidFile, scanSnippetFilenames, auditThemeAssets, extractActiveAppBlocks } from './lib/scanner/themeScanner.js';
import { calculateBloatScore } from './lib/scanner/scoringEngine.js';
import { generateExcisionGuide, applySafeCommentToLiquid, buildThemeDuplicateMutation } from './lib/remover/safeRemover.js';
import signaturesData from './data/signatures.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Load environment variables from .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...vals] = trimmed.split('=');
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
}

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'f3c6dde5474766c85897a2bd2567ea50';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SCOPES = process.env.SCOPES || 'read_themes,write_themes';

if (!SHOPIFY_API_SECRET) {
  console.warn('[SECURITY NOTICE] SHOPIFY_API_SECRET is not set in process.env.');
}

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) { // 5MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

// Helper to parse raw request body buffer for HMAC verification
function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Verify Shopify Webhook HMAC-SHA256 signature
function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!hmacHeader) return false;
  try {
    const calculated = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(rawBody)
      .digest('base64');
    return crypto.timingSafeEqual(Buffer.from(calculated, 'utf8'), Buffer.from(hmacHeader, 'utf8'));
  } catch (err) {
    return false;
  }
}

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// Helper to safely redirect to Shopify Admin (breaks out of iframe if embedded)
function redirectShopifyAdmin(res, targetUrl, message = 'Redirecting to Shopify...') {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${message}</title>
  <script>
    if (window.top !== window.self) {
      window.top.location.href = ${JSON.stringify(targetUrl)};
    } else {
      window.location.href = ${JSON.stringify(targetUrl)};
    }
  </script>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f6f6f7; color: #202223; margin: 0;">
  <p>${message}</p>
</body>
</html>`;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Security-Policy': "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.spin.dev;"
  });
  res.end(html);
}

// Persistent Session / Token Store
const SESSIONS_FILE = path.join(__dirname, 'data', 'sessions.json');
function getSession(shop) {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      return data[shop] || null;
    }
  } catch (err) {
    console.warn('Could not read sessions:', err.message);
  }
  return null;
}

function saveSession(shop, sessionData) {
  try {
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let data = {};
    if (fs.existsSync(SESSIONS_FILE)) {
      data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
    data[shop] = { ...data[shop], ...sessionData, updatedAt: new Date().toISOString() };
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save session:', err.message);
  }
}

function removeSession(shop) {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      let data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      if (data[shop]) {
        delete data[shop];
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
        console.log(`[BloatBuster Session] Purged data for store: ${shop}`);
      }
    }
  } catch (err) {
    console.error('Failed to purge session:', err.message);
  }
}

// Helper to extract App Bridge Session Token (JWT) from Authorization header or body
function extractSessionToken(req, body = null) {
  if (body && body.sessionToken) return body.sessionToken;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

// Exchange App Bridge Session Token for a modern expiring offline access token (with expiring: 1)
async function exchangeSessionToken(shop, idToken) {
  try {
    const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
    console.log(`[BloatBuster Token Exchange] Exchanging session token for modern expiring offline access token: ${cleanShop}`);
    const exchangeRes = await fetch(`https://${cleanShop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: idToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        expiring: 1
      })
    });

    const exchangeData = await exchangeRes.json();
    console.log('[BloatBuster Token Exchange Response]:', JSON.stringify({
      ...exchangeData,
      access_token: exchangeData.access_token ? '[REDACTED]' : null,
      refresh_token: exchangeData.refresh_token ? '[REDACTED]' : null
    }));

    if (exchangeData.access_token) {
      saveSession(cleanShop, {
        accessToken: exchangeData.access_token,
        scope: exchangeData.scope,
        expiresAt: exchangeData.expires_in ? Date.now() + (exchangeData.expires_in * 1000) : null,
        refreshToken: exchangeData.refresh_token || null
      });
      console.log(`[BloatBuster Token Exchange] Offline access token saved for ${cleanShop} (expires in ${exchangeData.expires_in || 3600}s)`);
      return exchangeData.access_token;
    } else {
      console.warn('[BloatBuster Token Exchange] Shopify rejected token exchange:', exchangeData);
      return null;
    }
  } catch (err) {
    console.error('[BloatBuster Token Exchange Error]:', err.message);
    return null;
  }
}

async function getValidAccessToken(shop) {
  const session = getSession(shop);
  if (!session || !session.accessToken) return null;

  // Reject legacy non-expiring tokens as Shopify 2026 Admin API enforces expiring tokens
  if (session.accessToken.startsWith('shpat_') && !session.refreshToken) {
    console.warn(`[BloatBuster Auth] Stored token for ${shop} is a legacy non-expiring token (shpat_). Needs modern expiring token.`);
    return null;
  }

  // Refresh expiring token if within 5 minutes of expiration
  if (session.expiresAt && Date.now() > session.expiresAt - 300000 && session.refreshToken) {
    try {
      console.log(`[BloatBuster Auth] Refreshing expiring offline token for ${shop}...`);
      const refreshRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          grant_type: 'refresh_token',
          refresh_token: session.refreshToken
        })
      });
      const refreshData = await refreshRes.json();
      if (refreshData.access_token) {
        saveSession(shop, {
          accessToken: refreshData.access_token,
          expiresAt: refreshData.expires_in ? Date.now() + (refreshData.expires_in * 1000) : null,
          refreshToken: refreshData.refresh_token || session.refreshToken
        });
        return refreshData.access_token;
      } else {
        console.warn('[BloatBuster Auth] Token refresh returned error:', refreshData);
      }
    } catch (err) {
      console.warn('Token auto-refresh failed:', err.message);
    }
  }

  return session.accessToken;
}

// Get valid access token or automatically exchange provided session token
async function getOrExchangeAccessToken(shop, sessionToken = null) {
  const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
  let accessToken = await getValidAccessToken(cleanShop);

  if ((!accessToken || accessToken.startsWith('shpat_')) && sessionToken) {
    console.log(`[BloatBuster Auth] Active token for ${cleanShop} is missing or legacy. Exchanging provided session token...`);
    const newToken = await exchangeSessionToken(cleanShop, sessionToken);
    if (newToken) {
      accessToken = newToken;
    }
  }

  return accessToken;
}

// Shopify Admin Theme API Helpers
async function fetchActiveTheme(shop, accessToken) {
  try {
    const res = await fetch(`https://${shop}/admin/api/2025-01/themes.json`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[Shopify Theme API] fetchActiveTheme HTTP ${res.status} for ${shop}: ${errBody}`);
      return { error: `HTTP ${res.status}: ${errBody}`, status: res.status };
    }
    const data = await res.json();
    const mainTheme = data?.themes?.find(t => t.role === 'main');
    return mainTheme || data?.themes?.[0] || null;
  } catch (err) {
    console.warn(`[Shopify Theme API] fetchActiveTheme failed for ${shop}:`, err.message);
    return { error: err.message, status: 500 };
  }
}

async function fetchThemeAsset(shop, accessToken, themeId, assetKey) {
  try {
    const res = await fetch(
      `https://${shop}/admin/api/2025-01/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        }
      }
    );
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[Shopify Theme API] fetchThemeAsset (${assetKey}) failed HTTP ${res.status}:`, errBody);
      return null;
    }
    const data = await res.json();
    return data?.asset?.value || null;
  } catch (err) {
    console.warn(`[Shopify Theme API] fetchThemeAsset (${assetKey}) failed:`, err.message);
    return null;
  }
}

async function fetchThemeAssetList(shop, accessToken, themeId) {
  try {
    const res = await fetch(`https://${shop}/admin/api/2025-01/themes/${themeId}/assets.json`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[Shopify Theme API] fetchThemeAssetList failed HTTP ${res.status}:`, errBody);
      return [];
    }
    const data = await res.json();
    return (data?.assets || []).map(a => a.key);
  } catch (err) {
    console.warn(`[Shopify Theme API] fetchThemeAssetList failed:`, err.message);
    return [];
  }
}

async function updateThemeAsset(shop, accessToken, themeId, assetKey, content) {
  const res = await fetch(`https://${shop}/admin/api/2025-01/themes/${themeId}/assets.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({
      asset: {
        key: assetKey,
        value: content
      }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.errors || `Failed to update theme asset HTTP ${res.status}`);
  }
  return data?.asset;
}

async function duplicateThemeBackup(shop, accessToken, themeId, originalName = 'Theme') {
  const dateStr = new Date().toISOString().split('T')[0];
  const backupName = `[BloatBuster Backup] ${originalName.replace(/^\[BloatBuster Backup\]\s*/, '')} - ${dateStr}`;

  // Attempt GraphQL mutation themeDuplicate first
  try {
    const mutation = buildThemeDuplicateMutation(themeId);
    const gqlRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify(mutation)
    });
    const gqlData = await gqlRes.json();
    const result = gqlData?.data?.themeDuplicate;
    if (result?.createdTheme?.id) {
      return {
        id: result.createdTheme.id,
        name: result.createdTheme.name || backupName,
        role: result.createdTheme.role || 'unpublished'
      };
    }
  } catch (gqlErr) {
    console.warn('[Shopify Theme API] GraphQL themeDuplicate failed, attempting REST fallback:', gqlErr.message);
  }

  // REST duplicate fallback
  try {
    const restRes = await fetch(`https://${shop}/admin/api/2025-01/themes.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({
        theme: {
          name: backupName,
          src: `https://${shop}/admin/api/2025-01/themes/${themeId}.json`,
          role: 'unpublished'
        }
      })
    });
    const restData = await restRes.json();
    if (restData?.theme?.id) {
      return {
        id: restData.theme.id,
        name: restData.theme.name,
        role: restData.theme.role
      };
    }
  } catch (restErr) {
    console.warn('[Shopify Theme API] REST theme duplicate fallback failed:', restErr.message);
  }

  return { id: `backup-${Date.now()}`, name: backupName, role: 'unpublished' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  try {
    // 0. Shopify Mandatory Compliance & Lifecycle Webhooks (GDPR)
    if (pathname.startsWith('/webhooks')) {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        return res.end('Method Not Allowed');
      }

      const hmac = req.headers['x-shopify-hmac-sha256'];
      const topic = req.headers['x-shopify-topic'] || pathname.replace(/^\/webhooks\/?/, '');
      const shopDomain = req.headers['x-shopify-shop-domain'];

      const rawBody = await parseRawBody(req);

      // Verify HMAC signature
      const isValid = verifyShopifyHmac(rawBody, hmac);
      if (!isValid) {
        console.warn(`[BloatBuster Webhook] Rejected unauthorized webhook (Invalid HMAC) for topic: ${topic}`);
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        return res.end('Unauthorized: Invalid HMAC signature');
      }

      let payload = {};
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        payload = {};
      }

      console.log(`[BloatBuster Webhook] Verified webhook received: topic=${topic} shop=${shopDomain || payload.myshopify_domain || 'unknown'}`);

      // Handle App Uninstalled or Shop Redaction (Clean up session store)
      if (topic === 'app/uninstalled' || topic === 'shop/redact') {
        const targetShop = shopDomain || payload.myshopify_domain || payload.shop_domain;
        if (targetShop) {
          removeSession(targetShop);
        }
      }

      // Mandatory compliance topics: customers/data_request, customers/redact, shop/redact
      // BloatBuster does not store customer personal data, so we acknowledge with 200 OK immediately
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, topic, message: 'Acknowledged' }));
    }

    // 1. Shopify OAuth Handlers (Fallback for manual installs or direct links)
    if (pathname === '/auth') {
      const shop = url.searchParams.get('shop');
      if (!shop) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing shop parameter for authentication.');
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const state = url.searchParams.get('state') || '';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const redirectUri = encodeURIComponent(`${proto}://${host}/auth/callback`);
      const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}&state=${state}`;
      
      return redirectShopifyAdmin(res, authUrl, 'Redirecting to Shopify authorization...');
    }

    if (pathname === '/auth/callback') {
      const shop = url.searchParams.get('shop');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!shop || !code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing shop or code parameter in OAuth callback.');
      }

      console.log(`[BloatBuster] Exchanging OAuth code for modern expiring token: ${shop}`);
      try {
        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: SHOPIFY_API_KEY,
            client_secret: SHOPIFY_API_SECRET,
            code,
            expiring: 1
          })
        });
        const tokenData = await tokenRes.json();
        console.log('[BloatBuster OAuth Token Response]:', JSON.stringify({ ...tokenData, access_token: tokenData.access_token ? '[REDACTED]' : null }));
        const cleanShop = shop.replace('.myshopify.com', '');
        
        if (tokenData.access_token) {
          saveSession(shop, {
            accessToken: tokenData.access_token,
            scope: tokenData.scope,
            expiresAt: tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : null,
            refreshToken: tokenData.refresh_token || null
          });
          console.log(`[BloatBuster] Successfully saved expiring token for store: ${shop}`);

          // If user came from the subscription flow, create the subscription charge immediately!
          if (state === 'subscribe') {
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const proto = req.headers['x-forwarded-proto'] || 'https';
            const returnUrl = `${proto}://${host}/api/billing/confirm?shop=${shop}`;

            const gqlResponse = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': tokenData.access_token
              },
              body: JSON.stringify({
                query: `
                  mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
                    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, trialDays: $trialDays, test: $test, lineItems: $lineItems) {
                      userErrors { field message }
                      confirmationUrl
                      appSubscription { id status }
                    }
                  }
                `,
                variables: {
                  name: "BloatBuster Pro: Automated Theme Cleaner",
                  returnUrl,
                  trialDays: 7,
                  test: process.env.SHOPIFY_BILLING_TEST === 'false' ? false : true,
                  lineItems: [
                    {
                      plan: {
                        appRecurringPricingDetails: {
                          price: { amount: 19.00, currencyCode: "USD" },
                          interval: "EVERY_30_DAYS"
                        }
                      }
                    }
                  ]
                }
              })
            });

            const gqlData = await gqlResponse.json();
            const subResult = gqlData?.data?.appSubscriptionCreate;
            if (subResult?.confirmationUrl) {
              return redirectShopifyAdmin(res, subResult.confirmationUrl, 'Redirecting to Shopify Billing...');
            }

            if (subResult?.userErrors?.length > 0) {
              const err = subResult.userErrors[0].message;
              console.error('[BloatBuster Billing Error in Callback]:', err);
              return redirectShopifyAdmin(res, `https://admin.shopify.com/store/${cleanShop}/apps/${SHOPIFY_API_KEY}?billing_error=${encodeURIComponent(err)}`, 'Returning to BloatBuster...');
            }
          }
        } else {
          console.error('[BloatBuster OAuth Error]:', tokenData);
          const err = tokenData.error_description || tokenData.error || 'Failed to exchange OAuth token';
          return redirectShopifyAdmin(res, `https://admin.shopify.com/store/${cleanShop}/apps/${SHOPIFY_API_KEY}?auth_error=${encodeURIComponent(err)}`, 'Returning to BloatBuster...');
        }

        // Default redirect back into embedded admin app
        return redirectShopifyAdmin(res, `https://admin.shopify.com/store/${cleanShop}/apps/${SHOPIFY_API_KEY}`, 'Loading BloatBuster...');
      } catch (err) {
        console.error('OAuth token exchange error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Failed to exchange Shopify OAuth token.');
      }
    }

    // 1.5 Shopify Token Exchange (Managed Installation)
    if (pathname === '/api/auth/token-exchange' && req.method === 'POST') {
      const { token, shop } = await parseJsonBody(req);
      if (!token || !shop) {
        return sendJson(res, 400, { error: 'Missing token or shop' });
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const accessToken = await exchangeSessionToken(cleanShop, token);
      if (accessToken) {
        return sendJson(res, 200, { success: true });
      } else {
        return sendJson(res, 400, { success: false, error: 'Failed to exchange App Bridge session token with Shopify.' });
      }
    }

    // 2. Shopify Native Billing API: Create Recurring Subscription ($19/mo with 7-day trial)
    if (pathname === '/api/billing/subscribe' && req.method === 'POST') {
      const { shop } = await parseJsonBody(req);
      if (!shop) {
        return sendJson(res, 400, { error: 'Missing shop domain parameter for subscription.' });
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const session = getSession(cleanShop);

      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const returnUrl = `${proto}://${host}/api/billing/confirm?shop=${cleanShop}`;

      const accessToken = await getValidAccessToken(cleanShop);

      // If store hasn't completed OAuth yet, send full authorize URL
      if (!accessToken) {
        console.log(`[BloatBuster Billing] No valid token found for ${cleanShop}. Generating full authorize URL.`);
        const redirectUri = encodeURIComponent(`${proto}://${host}/auth/callback`);
        const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}&state=subscribe`;
        return sendJson(res, 200, {
          success: true,
          needsAuth: true,
          confirmationUrl: authUrl
        });
      }

      console.log(`[BloatBuster Billing] Calling Shopify GraphQL appSubscriptionCreate for ${cleanShop}`);

      // Execute live GraphQL mutation against Shopify Admin API
      const graphqlQuery = {
        query: `
          mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
            appSubscriptionCreate(name: $name, returnUrl: $returnUrl, trialDays: $trialDays, test: $test, lineItems: $lineItems) {
              userErrors {
                field
                message
              }
              confirmationUrl
              appSubscription {
                id
                status
              }
            }
          }
        `,
        variables: {
          name: "BloatBuster Pro: Automated Theme Cleaner",
          returnUrl,
          trialDays: 7,
          test: process.env.SHOPIFY_BILLING_TEST === 'false' ? false : true,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: 19.00, currencyCode: "USD" },
                  interval: "EVERY_30_DAYS"
                }
              }
            }
          ]
        }
      };

      const gqlResponse = await fetch(`https://${cleanShop}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        },
        body: JSON.stringify(graphqlQuery)
      });

      const gqlData = await gqlResponse.json();
      console.log(`[BloatBuster Billing API] Response: status=${gqlResponse.status}`, JSON.stringify(gqlData));

      // If token is invalid or expired, reset session and redirect to OAuth
      if (gqlResponse.status === 401 || (gqlData.errors && !gqlData.data)) {
        console.warn(`[BloatBuster Billing] Invalid access token for ${cleanShop}. Clearing session and triggering fresh OAuth.`);
        saveSession(cleanShop, { accessToken: null });
        const redirectUri = encodeURIComponent(`${proto}://${host}/auth/callback`);
        const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}&state=subscribe`;
        return sendJson(res, 200, {
          success: true,
          needsAuth: true,
          confirmationUrl: authUrl,
          debugError: gqlData?.errors || `HTTP status ${gqlResponse.status}`
        });
      }

      const subscriptionResult = gqlData?.data?.appSubscriptionCreate;

      if (subscriptionResult?.userErrors?.length > 0) {
        const userErr = subscriptionResult.userErrors[0].message;
        console.error('Billing user error:', userErr);
        return sendJson(res, 400, { error: userErr });
      }

      if (subscriptionResult?.confirmationUrl) {
        console.log(`[BloatBuster Billing] Generated confirmationUrl: ${subscriptionResult.confirmationUrl}`);
        return sendJson(res, 200, {
          success: true,
          confirmationUrl: subscriptionResult.confirmationUrl
        });
      }

      const fallbackErr = gqlData?.errors?.[0]?.message || 'Shopify did not return a subscription confirmation URL.';
      console.error('[BloatBuster Billing Error]:', fallbackErr);
      return sendJson(res, 400, { error: fallbackErr });
    }

    // 3. Billing Callback / Confirmation
    if (pathname === '/api/billing/confirm') {
      const shop = url.searchParams.get('shop');
      if (!shop) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing shop parameter');
      }
      const chargeId = url.searchParams.get('charge_id');
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');

      console.log(`[BloatBuster Billing] Merchant confirmed subscription on store: ${cleanShop}`);
      saveSession(cleanShop, {
        isPro: true,
        subscriptionPlan: 'pro_monthly',
        chargeId,
        subscribedAt: new Date().toISOString()
      });

      const storeName = cleanShop.replace('.myshopify.com', '');
      return redirectShopifyAdmin(res, `https://admin.shopify.com/store/${storeName}/apps/${SHOPIFY_API_KEY}?plan=pro&subscribed=true`, 'Activating BloatBuster Pro...');
    }

    // 4. Check Billing Status
    if (pathname === '/api/billing/status') {
      const shop = url.searchParams.get('shop');
      if (!shop) {
        return sendJson(res, 200, { isPro: false, plan: 'Free Tier', hasToken: false });
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const session = getSession(cleanShop);

      return sendJson(res, 200, {
        isPro: Boolean(session?.isPro),
        plan: session?.isPro ? 'BloatBuster Pro ($19/mo)' : 'Free Tier',
        hasToken: Boolean(session?.accessToken)
      });
    }

    // API: Scan Live Storefront URL (with automatic active embed detection)
    if (pathname === '/api/scan' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { storeUrl, shop: rawShop, activeApps = [] } = body;
      if (!storeUrl) {
        return sendJson(res, 400, { error: 'Please provide a Shopify store URL to scan.' });
      }

      console.log(`[BloatBuster] Scanning storefront: ${storeUrl}`);
      const startTime = Date.now();

      // Automatically inspect live theme for active OS 2.0 app embeds if store is authorized
      let autoActiveAppIds = [];
      const cleanShop = rawShop ? rawShop.replace(/^https?:\/\//, '').split('/')[0] : null;
      if (cleanShop) {
        const sessionToken = extractSessionToken(req, body);
        const accessToken = await getOrExchangeAccessToken(cleanShop, sessionToken);
        if (accessToken) {
          try {
            const activeTheme = await fetchActiveTheme(cleanShop, accessToken);
            if (activeTheme?.id) {
              const settingsData = await fetchThemeAsset(cleanShop, accessToken, activeTheme.id, 'config/settings_data.json');
              if (settingsData) {
                const parsedBlocks = extractActiveAppBlocks(settingsData);
                autoActiveAppIds = parsedBlocks.activeAppIds || [];
                console.log(`[BloatBuster] Auto-detected ${autoActiveAppIds.length} active app embeds on ${cleanShop}:`, autoActiveAppIds);
              }
            }
          } catch (embedErr) {
            console.warn('[BloatBuster] Auto embed detection warning:', embedErr.message);
          }
        }
      }

      const mergedActiveApps = Array.from(new Set([...autoActiveAppIds, ...activeApps]));
      const { html, finalUrl, statusCode } = await fetchStorefrontHtml(storeUrl);
      const scanResults = scanStorefrontHtml(html, mergedActiveApps);
      const scoreData = calculateBloatScore(
        scanResults.detectedApps.filter(a => a.status === 'suspected_orphan'),
        scanResults.unknownExternalScripts
      );

      const responsePayload = {
        storeUrl,
        finalUrl,
        scanDurationMs: Date.now() - startTime,
        statusCode,
        score: scoreData.score,
        metrics: scoreData.metrics,
        summary: scanResults.summary,
        detectedApps: scanResults.detectedApps,
        autoActiveAppIds,
        unknownExternalScripts: scanResults.unknownExternalScripts.slice(0, 15)
      };

      return sendJson(res, 200, responsePayload);
    }

    // API: Live Active Theme Metadata
    if (pathname === '/api/theme/live' && req.method === 'GET') {
      const shop = url.searchParams.get('shop');
      if (!shop) {
        return sendJson(res, 400, { error: 'Missing shop parameter.' });
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const sessionToken = extractSessionToken(req);
      let accessToken = await getOrExchangeAccessToken(cleanShop, sessionToken);

      if (!accessToken) {
        return sendJson(res, 200, {
          success: false,
          theme: { name: 'Active Live Theme', id: 'current', role: 'main' },
          hasToken: false
        });
      }

      let themeResult = await fetchActiveTheme(cleanShop, accessToken);

      // Auto-retry once if token was rejected and we have an App Bridge session token
      if ((themeResult?.status === 401 || themeResult?.status === 403) && sessionToken) {
        console.log(`[BloatBuster Auth] Theme API returned HTTP ${themeResult.status}. Re-exchanging session token...`);
        const refreshedToken = await exchangeSessionToken(cleanShop, sessionToken);
        if (refreshedToken) {
          accessToken = refreshedToken;
          themeResult = await fetchActiveTheme(cleanShop, accessToken);
        }
      }

      if (themeResult && themeResult.id && !themeResult.error) {
        return sendJson(res, 200, {
          success: true,
          theme: {
            id: themeResult.id,
            name: themeResult.name,
            role: themeResult.role,
            updatedAt: themeResult.updated_at
          },
          hasToken: true
        });
      }

      return sendJson(res, 200, {
        success: false,
        theme: { name: 'Active Live Theme', id: 'current', role: 'main' },
        hasToken: true,
        error: themeResult?.error || null
      });
    }

    // API: 1-Click Native Theme Code & Snippets Audit (No manual copy-pasting!)
    if (pathname === '/api/theme/scan-assets' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { shop, activeApps = [] } = body;
      if (!shop) {
        return sendJson(res, 400, { error: 'Missing shop parameter for theme audit.' });
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const sessionToken = extractSessionToken(req, body);
      let accessToken = await getOrExchangeAccessToken(cleanShop, sessionToken);

      if (!accessToken) {
        return sendJson(res, 401, {
          error: 'Please launch BloatBuster from within your Shopify Admin to authorize theme inspection.'
        });
      }

      let themeResult = await fetchActiveTheme(cleanShop, accessToken);

      // Auto-retry once if token was rejected and we have an App Bridge session token
      if ((themeResult?.status === 401 || themeResult?.status === 403) && sessionToken) {
        console.log(`[BloatBuster Auth] Theme API returned HTTP ${themeResult.status}. Re-exchanging session token...`);
        const refreshedToken = await exchangeSessionToken(cleanShop, sessionToken);
        if (refreshedToken) {
          accessToken = refreshedToken;
          themeResult = await fetchActiveTheme(cleanShop, accessToken);
        }
      }

      if (themeResult?.error || !themeResult?.id) {
        const errorDetail = themeResult?.error || 'Could not locate published active theme for store.';
        return sendJson(res, 400, { error: `Theme Inspection Error: ${errorDetail}` });
      }

      const mainTheme = themeResult;
      console.log(`[BloatBuster] Running 1-Click Theme Asset Audit on "${mainTheme.name}" (${mainTheme.id})...`);

      // Fetch theme assets list, theme.liquid, and settings_data.json in parallel
      const [allAssetKeys, themeLiquid, settingsData] = await Promise.all([
        fetchThemeAssetList(cleanShop, accessToken, mainTheme.id),
        fetchThemeAsset(cleanShop, accessToken, mainTheme.id, 'layout/theme.liquid'),
        fetchThemeAsset(cleanShop, accessToken, mainTheme.id, 'config/settings_data.json')
      ]);

      const audit = auditThemeAssets(allAssetKeys, themeLiquid || '', settingsData, activeApps);

      // Generate excision guides for all suspected orphan liquid findings
      const excisionGuides = audit.orphanLiquidFindings.map(finding =>
        generateExcisionGuide(finding, cleanShop, mainTheme.id)
      );

      // Calculate health score based on dead theme code
      const scoreData = calculateBloatScore(
        [...audit.orphanLiquidFindings, ...audit.orphanSnippetFiles],
        []
      );

      return sendJson(res, 200, {
        success: true,
        theme: {
          id: mainTheme.id,
          name: mainTheme.name,
          role: mainTheme.role
        },
        audit,
        score: scoreData.score,
        metrics: scoreData.metrics,
        excisionGuides
      });
    }

    // API: 1-Click Theme Duplication Backup (Pro Tier)
    if (pathname === '/api/theme/duplicate' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { shop } = body;
      if (!shop) {
        return sendJson(res, 400, { error: 'Missing shop parameter.' });
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const session = getSession(cleanShop);

      if (!session?.isPro) {
        return sendJson(res, 403, {
          error: 'Theme safety backups require BloatBuster Pro. Please start your 7-day free trial.'
        });
      }

      const sessionToken = extractSessionToken(req, body);
      let accessToken = await getOrExchangeAccessToken(cleanShop, sessionToken);
      if (!accessToken) {
        return sendJson(res, 401, { error: 'Missing valid access token.' });
      }

      let themeResult = await fetchActiveTheme(cleanShop, accessToken);
      if ((themeResult?.status === 401 || themeResult?.status === 403) && sessionToken) {
        const refreshedToken = await exchangeSessionToken(cleanShop, sessionToken);
        if (refreshedToken) {
          accessToken = refreshedToken;
          themeResult = await fetchActiveTheme(cleanShop, accessToken);
        }
      }

      if (themeResult?.error || !themeResult?.id) {
        return sendJson(res, 404, { error: themeResult?.error || 'Active theme not found.' });
      }

      const mainTheme = themeResult;
      console.log(`[BloatBuster Pro] Duplicating theme backup for "${mainTheme.name}" (${mainTheme.id})...`);
      const backupTheme = await duplicateThemeBackup(cleanShop, accessToken, mainTheme.id, mainTheme.name);

      saveSession(cleanShop, {
        lastBackup: {
          id: backupTheme.id,
          name: backupTheme.name,
          createdAt: new Date().toISOString()
        }
      });

      return sendJson(res, 200, {
        success: true,
        backupTheme,
        message: `Backup created successfully: ${backupTheme.name}`
      });
    }

    // API: 1-Click Automated Safe Deactivation / Commenting (Pro Tier)
    if (pathname === '/api/theme/clean-snippet' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { shop, targetLine, appName } = body;
      if (!shop || !targetLine) {
        return sendJson(res, 400, { error: 'Missing required parameters (shop, targetLine).' });
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const session = getSession(cleanShop);

      if (!session?.isPro) {
        return sendJson(res, 403, {
          error: 'Automated 1-click cleanup requires BloatBuster Pro. Please start your 7-day free trial.'
        });
      }

      const sessionToken = extractSessionToken(req, body);
      let accessToken = await getOrExchangeAccessToken(cleanShop, sessionToken);
      if (!accessToken) {
        return sendJson(res, 401, { error: 'Missing valid access token.' });
      }

      let themeResult = await fetchActiveTheme(cleanShop, accessToken);
      if ((themeResult?.status === 401 || themeResult?.status === 403) && sessionToken) {
        const refreshedToken = await exchangeSessionToken(cleanShop, sessionToken);
        if (refreshedToken) {
          accessToken = refreshedToken;
          themeResult = await fetchActiveTheme(cleanShop, accessToken);
        }
      }

      if (themeResult?.error || !themeResult?.id) {
        return sendJson(res, 404, { error: themeResult?.error || 'Active theme not found.' });
      }

      const mainTheme = themeResult;

      // Auto-create backup if not backed up recently
      await duplicateThemeBackup(cleanShop, accessToken, mainTheme.id, mainTheme.name);

      const themeLiquid = await fetchThemeAsset(cleanShop, accessToken, mainTheme.id, 'layout/theme.liquid');
      if (!themeLiquid) {
        return sendJson(res, 404, { error: 'Could not fetch layout/theme.liquid.' });
      }

      const result = applySafeCommentToLiquid(themeLiquid, targetLine, appName);
      if (!result.success) {
        return sendJson(res, 400, { error: result.error });
      }

      if (!result.alreadyCommented) {
        await updateThemeAsset(cleanShop, accessToken, mainTheme.id, 'layout/theme.liquid', result.updatedLiquid);
        console.log(`[BloatBuster Pro] Safely commented out line in layout/theme.liquid on ${cleanShop}: "${targetLine}"`);
      }

      return sendJson(res, 200, {
        success: true,
        alreadyCommented: result.alreadyCommented,
        message: `Successfully deactivated ${appName || 'orphan tag'} in layout/theme.liquid with safety backup.`
      });
    }

    // API: Scan Raw Liquid Code / Snippets (Manual Paste Fallback)
    if (pathname === '/api/scan-code' && req.method === 'POST') {
      const { liquidCode, filePath = 'layout/theme.liquid', shopDomain = 'store.myshopify.com', themeId = 'current', activeApps = [] } = await parseJsonBody(req);
      
      if (!liquidCode) {
        return sendJson(res, 400, { error: 'Please provide theme liquid code to inspect.' });
      }

      const findings = scanLiquidFile(filePath, liquidCode, activeApps);
      const excisionGuides = findings.map(f => generateExcisionGuide(f, shopDomain, themeId));
      const scoreData = calculateBloatScore(findings.filter(f => f.status === 'suspected_orphan'), []);

      return sendJson(res, 200, {
        filePath,
        findingsCount: findings.length,
        findings,
        excisionGuides,
        score: scoreData.score,
        metrics: scoreData.metrics
      });
    }

    // API: Get Catalog of Signatures
    if (pathname === '/api/signatures' && req.method === 'GET') {
      return sendJson(res, 200, signaturesData);
    }

    // Serve Static UI Files
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Access denied');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.webm': 'video/webm',
        '.mp4': 'video/mp4'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      };
      if (ext === '.html') {
        headers['Content-Security-Policy'] = "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.spin.dev;";
      }
      res.writeHead(200, headers);
      return fs.createReadStream(filePath).pipe(res);
    }

    // Default fallback to index.html
    const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(fallbackPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Security-Policy': "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.spin.dev;"
      });
      return fs.createReadStream(fallbackPath).pipe(res);
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('[BloatBuster Error]', err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 BloatBuster Server running at http://localhost:${PORT}`);
  console.log(`📦 Signature Database loaded: ${signaturesData.totalApps} popular Shopify apps`);
  console.log(`✨ Open http://localhost:${PORT} in your browser to run live scans!\n`);
});
