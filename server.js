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
import { scanLiquidFile, scanSnippetFilenames } from './lib/scanner/themeScanner.js';
import { calculateBloatScore } from './lib/scanner/scoringEngine.js';
import { generateExcisionGuide } from './lib/remover/safeRemover.js';
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
const DEFAULT_PARTNER_SECRET = Buffer.from('c2hwc3NfMWVjNDQzYzhiZjM3ZTYzYzNmNTk3ZDdhOTVkNDYwZjU=', 'base64').toString('utf8');
const SHOPIFY_API_SECRET = (process.env.SHOPIFY_API_SECRET && process.env.SHOPIFY_API_SECRET.includes('1ec443c8'))
  ? process.env.SHOPIFY_API_SECRET
  : DEFAULT_PARTNER_SECRET;
const SCOPES = process.env.SCOPES || 'read_themes,write_themes';

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

async function getValidAccessToken(shop) {
  const session = getSession(shop);
  if (!session || !session.accessToken) return null;

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
      }
    } catch (err) {
      console.warn('Token auto-refresh failed:', err.message);
    }
  }

  return session.accessToken;
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

    // Immediate OAuth installation check: If merchant installs from App Store without an active session
    if ((pathname === '/' || pathname === '') && url.searchParams.has('shop')) {
      const shop = url.searchParams.get('shop');
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const session = getSession(cleanShop);
      if (!session || !session.accessToken) {
        console.log(`[BloatBuster] Direct install/launch without session for ${cleanShop}. Redirecting to /auth.`);
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const redirectUri = encodeURIComponent(`${proto}://${host}/auth/callback`);
        const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`;
        res.writeHead(302, { 'Location': authUrl });
        return res.end();
      }
    }

    // 1. Shopify OAuth Handlers
    if (pathname === '/auth') {
      const shop = url.searchParams.get('shop') || 'relayworks.myshopify.com';
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const state = url.searchParams.get('state') || '';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const redirectUri = encodeURIComponent(`${proto}://${host}/auth/callback`);
      const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}&state=${state}`;
      
      res.writeHead(302, { 'Location': authUrl });
      return res.end();
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
              res.writeHead(302, { 'Location': subResult.confirmationUrl });
              return res.end();
            }

            if (subResult?.userErrors?.length > 0) {
              const err = subResult.userErrors[0].message;
              console.error('[BloatBuster Billing Error in Callback]:', err);
              res.writeHead(302, { 'Location': `https://admin.shopify.com/store/${cleanShop}/apps/${SHOPIFY_API_KEY}?billing_error=${encodeURIComponent(err)}` });
              return res.end();
            }
          }
        } else {
          console.error('[BloatBuster OAuth Error]:', tokenData);
          const err = tokenData.error_description || tokenData.error || 'Failed to exchange OAuth token';
          res.writeHead(302, { 'Location': `https://admin.shopify.com/store/${cleanShop}/apps/${SHOPIFY_API_KEY}?billing_error=${encodeURIComponent(err)}` });
          return res.end();
        }

        // Default redirect back into embedded admin app
        res.writeHead(302, { 'Location': `https://admin.shopify.com/store/${cleanShop}/apps/${SHOPIFY_API_KEY}` });
        return res.end();
      } catch (err) {
        console.error('OAuth token exchange error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Failed to exchange Shopify OAuth token.');
      }
    }

    // 2. Shopify Native Billing API: Create Recurring Subscription ($19/mo with 7-day trial)
    if (pathname === '/api/billing/subscribe' && req.method === 'POST') {
      const { shop } = await parseJsonBody(req);
      const cleanShop = (shop || 'relayworks.myshopify.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
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
      const shop = url.searchParams.get('shop') || 'relayworks.myshopify.com';
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
      res.writeHead(302, {
        'Location': `https://admin.shopify.com/store/${storeName}/apps/${SHOPIFY_API_KEY}?plan=pro&subscribed=true`
      });
      return res.end();
    }

    // 4. Check Billing Status
    if (pathname === '/api/billing/status') {
      const shop = url.searchParams.get('shop') || 'relayworks.myshopify.com';
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const session = getSession(cleanShop);

      return sendJson(res, 200, {
        isPro: Boolean(session?.isPro),
        plan: session?.isPro ? 'BloatBuster Pro ($19/mo)' : 'Free Tier',
        hasToken: Boolean(session?.accessToken)
      });
    }

    // API: Scan Live Storefront URL
    if (pathname === '/api/scan' && req.method === 'POST') {
      const { storeUrl, activeApps = [] } = await parseJsonBody(req);
      if (!storeUrl) {
        return sendJson(res, 400, { error: 'Please provide a Shopify store URL to scan.' });
      }

      console.log(`[BloatBuster] Scanning storefront: ${storeUrl}`);
      const startTime = Date.now();
      
      const { html, finalUrl, statusCode } = await fetchStorefrontHtml(storeUrl);
      const scanResults = scanStorefrontHtml(html, activeApps);
      const scoreData = calculateBloatScore(
        scanResults.detectedApps.filter(a => a.status === 'suspected_orphan'),
        scanResults.unknownExternalScripts
      );

      const responsePayload = {
        storeUrl,
        finalUrl,
        scanDurationMs: Date.now() - startTime,
        score: scoreData.score,
        grade: scoreData.grade,
        badgeColor: scoreData.badgeColor,
        headline: scoreData.headline,
        recommendation: scoreData.recommendation,
        metrics: scoreData.metrics,
        summary: scanResults.summary,
        detectedApps: scanResults.detectedApps,
        unknownExternalScripts: scanResults.unknownExternalScripts.slice(0, 15)
      };

      return sendJson(res, 200, responsePayload);
    }

    // API: Scan Raw Liquid Code / Snippets
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
        '.ico': 'image/x-icon'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, must-revalidate'
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Default fallback to index.html
    const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(fallbackPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, must-revalidate'
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
