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
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
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

      console.log(`[BloatBuster] Exchanging OAuth code for permanent access token: ${shop}`);
      try {
        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: SHOPIFY_API_KEY,
            client_secret: SHOPIFY_API_SECRET,
            code
          })
        });
        const tokenData = await tokenRes.json();
        const cleanShop = shop.replace('.myshopify.com', '');
        
        if (tokenData.access_token) {
          saveSession(shop, {
            accessToken: tokenData.access_token,
            scope: tokenData.scope
          });
          console.log(`[BloatBuster] Successfully saved access token for store: ${shop}`);

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
                  test: true,
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
            const confirmationUrl = gqlData?.data?.appSubscriptionCreate?.confirmationUrl;
            if (confirmationUrl) {
              res.writeHead(302, { 'Location': confirmationUrl });
              return res.end();
            }
          }
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

      // If store hasn't completed OAuth yet, send full authorize URL
      if (!session || !session.accessToken) {
        console.log(`[BloatBuster Billing] No token found for ${cleanShop}. Generating full authorize URL.`);
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
          test: true,
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
          'X-Shopify-Access-Token': session.accessToken
        },
        body: JSON.stringify(graphqlQuery)
      });

      const gqlData = await gqlResponse.json();
      const subscriptionResult = gqlData?.data?.appSubscriptionCreate;

      if (subscriptionResult?.userErrors?.length > 0) {
        console.error('Billing user errors:', subscriptionResult.userErrors);
        return sendJson(res, 400, { error: subscriptionResult.userErrors[0].message });
      }

      if (subscriptionResult?.confirmationUrl) {
        console.log(`[BloatBuster Billing] Generated confirmationUrl: ${subscriptionResult.confirmationUrl}`);
        return sendJson(res, 200, {
          success: true,
          confirmationUrl: subscriptionResult.confirmationUrl
        });
      }

      return sendJson(res, 200, {
        success: true,
        confirmationUrl: `https://admin.shopify.com/store/${cleanShop.replace('.myshopify.com', '')}/charges/confirm`
      });
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
