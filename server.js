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

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || '468869026551455874d932a9608b7494';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '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';
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // Shopify OAuth Handlers
    if (pathname === '/auth') {
      const shop = url.searchParams.get('shop');
      if (!shop) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing "shop" query parameter.');
      }
      const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const redirectUri = encodeURIComponent(`https://${req.headers.host}/auth/callback`);
      const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`;
      res.writeHead(302, { 'Location': authUrl });
      return res.end();
    }

    if (pathname === '/auth/callback') {
      const shop = url.searchParams.get('shop');
      const code = url.searchParams.get('code');
      if (!shop || !code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing shop or code parameter.');
      }

      console.log(`[BloatBuster] Exchanging OAuth token for store: ${shop}`);
      try {
        // Exchange temporary code for permanent offline access token
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
        console.log(`[BloatBuster] Successfully authenticated store ${shop}!`);
        
        // Redirect back to Shopify Admin app embed
        res.writeHead(302, { 'Location': `https://${shop}/admin/apps/${SHOPIFY_API_KEY}` });
        return res.end();
      } catch (err) {
        console.error('OAuth token exchange error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Failed to exchange Shopify OAuth token.');
      }
    }

    // Shopify Native Billing API: $19/mo Recurring Application Charge
    if (pathname === '/api/billing/subscribe' && req.method === 'POST') {
      const { shop, returnUrl } = await parseJsonBody(req);
      const isTest = process.env.NODE_ENV !== 'production';

      const billingMutation = `
        mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $test: Boolean) {
          appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, test: $test) {
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
      `;

      const variables = {
        name: "BloatBuster Pro: Automated Cleanup & 24/7 Watchdog",
        returnUrl: returnUrl || `https://${shop || 'admin.shopify.com'}/apps/${SHOPIFY_API_KEY}`,
        test: isTest,
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
      };

      return sendJson(res, 200, {
        success: true,
        plan: "BloatBuster Pro",
        price: "$19.00/mo",
        trialDays: 7,
        mutation: billingMutation,
        variables,
        message: "Shopify Billing API charge configured for $19/mo with 7-day trial."
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
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Default fallback to index.html
    const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(fallbackPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
