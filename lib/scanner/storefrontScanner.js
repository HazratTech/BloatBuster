/**
 * BloatBuster - Storefront HTML Scanner
 * Parses public storefront HTML, extracts third-party scripts/stylesheets,
 * and matches them against the 50+ app signatures database.
 */

import signaturesData from '../../data/signatures.json' with { type: 'json' };

const SHOPIFY_SAFE_DOMAINS = [
  'cdn.shopify.com',
  'shopify.com',
  'myshopify.com',
  'monorail-edge.shopifysvc.com',
  'v.shopify.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.google.com/recaptcha'
];

/**
 * Normalizes storefront URL to ensure valid protocol
 */
export function normalizeStoreUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Please provide a valid Shopify store URL.');
  }
  let url = rawUrl.trim().toLowerCase();
  // Remove protocol if user typed http:// or https://
  url = url.replace(/^https?:\/\//, '');
  // Remove trailing slashes and paths
  url = url.split('/')[0];
  // If user entered only store handle, e.g. "gymshark", append .myshopify.com or default to domain
  if (!url.includes('.')) {
    url = `${url}.myshopify.com`;
  }
  return `https://${url}`;
}

/**
 * Fetches the public storefront HTML server-to-server (No CORS issues)
 */
export async function fetchStorefrontHtml(storeUrl, timeoutMs = 12000) {
  const targetUrl = normalizeStoreUrl(storeUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 BloatBuster/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to load store (HTTP ${response.status}: ${response.statusText})`);
    }

    const html = await response.text();
    return {
      html,
      finalUrl: response.url,
      statusCode: response.status
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Storefront request timed out after ${timeoutMs / 1000}s. The store may be slow or password protected.`);
    }
    throw new Error(`Unable to fetch storefront: ${err.message}`);
  }
}

/**
 * Extracts all script tags, link tags, and inline snippets from raw HTML
 */
export function extractResourceTags(html) {
  const scripts = [];
  const stylesheets = [];
  const inlineScripts = [];

  // Match <script ...>...</script>
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    const attributes = match[1];
    const inlineContent = match[2].trim();

    const srcMatch = /src=["']([^"']+)["']/i.exec(attributes);
    if (srcMatch) {
      scripts.push({
        src: srcMatch[1],
        attributes,
        type: 'external'
      });
    } else if (inlineContent.length > 0) {
      inlineScripts.push({
        contentSnippet: inlineContent.slice(0, 300),
        fullContent: inlineContent,
        length: inlineContent.length
      });
    }
  }

  // Match <link ... rel="stylesheet" ...>
  const linkRegex = /<link\b([^>]*)\/?>/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    const attributes = match[1];
    if (/rel=["']stylesheet["']/i.test(attributes)) {
      const hrefMatch = /href=["']([^"']+)["']/i.exec(attributes);
      if (hrefMatch) {
        stylesheets.push({
          href: hrefMatch[1],
          attributes
        });
      }
    }
  }

  return { scripts, stylesheets, inlineScripts };
}

/**
 * Matches extracted tags against signatures database
 */
export function scanStorefrontHtml(html, activeAppHandles = []) {
  const { scripts, stylesheets, inlineScripts } = extractResourceTags(html);
  const detectedApps = [];
  const unknownExternalScripts = [];
  const matchedAppIds = new Set();

  for (const app of signaturesData.apps) {
    let matched = false;
    const matchReasons = [];

    // 1. Check external script sources
    for (const script of scripts) {
      for (const pattern of app.domainPatterns) {
        if (script.src.toLowerCase().includes(pattern.toLowerCase())) {
          matched = true;
          matchReasons.push({
            type: 'external_script',
            evidence: script.src,
            pattern
          });
        }
      }
    }

    // 2. Check external stylesheets
    for (const sheet of stylesheets) {
      for (const pattern of app.domainPatterns) {
        if (sheet.href.toLowerCase().includes(pattern.toLowerCase())) {
          matched = true;
          matchReasons.push({
            type: 'stylesheet',
            evidence: sheet.href,
            pattern
          });
        }
      }
    }

    // 3. Check inline script bodies
    for (const inline of inlineScripts) {
      for (const pattern of app.inlinePatterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(inline.fullContent)) {
            matched = true;
            matchReasons.push({
              type: 'inline_script',
              evidence: inline.contentSnippet,
              pattern
            });
          }
        } catch {
          if (inline.fullContent.toLowerCase().includes(pattern.toLowerCase())) {
            matched = true;
            matchReasons.push({
              type: 'inline_script',
              evidence: inline.contentSnippet,
              pattern
            });
          }
        }
      }
    }

    if (matched && !matchedAppIds.has(app.id)) {
      matchedAppIds.add(app.id);
      const isConfirmedActive = activeAppHandles.includes(app.id);
      detectedApps.push({
        appId: app.id,
        name: app.name,
        category: app.category,
        speedPenalty: app.speedPenalty,
        avgSizeKB: app.avgSizeKB,
        avgDelayMs: app.avgDelayMs,
        description: app.description,
        cleanupAdvice: app.cleanupAdvice,
        status: isConfirmedActive ? 'active' : 'suspected_orphan',
        matchReasons
      });
    }
  }

  // Detect unidentified third-party scripts (potential custom tracking or unlisted apps)
  for (const script of scripts) {
    const isShopify = SHOPIFY_SAFE_DOMAINS.some(d => script.src.includes(d));
    const isMatched = Array.from(matchedAppIds).some(appId => {
      const app = signaturesData.apps.find(a => a.id === appId);
      return app?.domainPatterns.some(p => script.src.toLowerCase().includes(p.toLowerCase()));
    });

    if (!isShopify && !isMatched) {
      unknownExternalScripts.push({
        url: script.src,
        snippet: script.attributes
      });
    }
  }

  return {
    detectedApps,
    unknownExternalScripts,
    summary: {
      totalScriptsFound: scripts.length + inlineScripts.length,
      externalScriptsCount: scripts.length,
      inlineScriptsCount: inlineScripts.length,
      stylesheetsCount: stylesheets.length,
      suspectedOrphansCount: detectedApps.filter(a => a.status === 'suspected_orphan').length,
      activeAppsCount: detectedApps.filter(a => a.status === 'active').length,
      unidentifiedThirdPartyCount: unknownExternalScripts.length
    }
  };
}
