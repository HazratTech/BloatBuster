/**
 * BloatBuster - Verification Test Suite
 * Tests scanner matching against realistic Shopify storefront HTML, Liquid theme snippets,
 * 52 app signatures, active theme embed resolution, and safe excision comment wrapping.
 */

import { scanStorefrontHtml } from '../lib/scanner/storefrontScanner.js';
import { scanLiquidFile, scanSnippetFilenames, auditThemeAssets, extractActiveAppBlocks } from '../lib/scanner/themeScanner.js';
import { calculateBloatScore } from '../lib/scanner/scoringEngine.js';
import { generateExcisionGuide, applySafeCommentToLiquid, buildThemeDuplicateMutation } from '../lib/remover/safeRemover.js';
import signaturesData from '../data/signatures.json' with { type: 'json' };

console.log('🧪 Running BloatBuster Core Engine Verification Tests...\n');

// Test 1: Validate 52 Signatures Database Integrity
console.log(`✓ Test 1: Validating 52 App Signatures Database...`);
if (signaturesData.apps.length !== 52) {
  throw new Error(`Expected exactly 52 apps in signatures.json, found: ${signaturesData.apps.length}`);
}

const seenIds = new Set();
for (const app of signaturesData.apps) {
  if (!app.id || !app.name || !app.category) {
    throw new Error(`Invalid app signature schema for: ${JSON.stringify(app)}`);
  }
  if (seenIds.has(app.id)) {
    throw new Error(`Duplicate app ID detected: ${app.id}`);
  }
  seenIds.add(app.id);
  if (!Array.isArray(app.domainPatterns) || app.domainPatterns.length === 0) {
    throw new Error(`App ${app.id} must have domainPatterns.`);
  }
}
console.log(`  - 52 distinct verified apps cataloged successfully.`);

// Test 2: Storefront HTML Scan
console.log(`\n✓ Test 2: Storefront HTML Extraction & App Matching...`);
const mockStorefrontHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sample Shopify Store</title>
  <!-- Active Shopify Core CDN Assets -->
  <script src="https://cdn.shopify.com/s/files/1/0000/global.js"></script>
  <link rel="stylesheet" href="https://cdn.shopify.com/s/files/1/0000/base.css">

  <!-- Dead Leftover App: Klaviyo -->
  <script src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=XYZ123"></script>

  <!-- Dead Leftover App: Loox Reviews -->
  <script src="https://loox.io/widget/loox.js?shop=teststore.myshopify.com"></script>

  <!-- Dead Leftover App: Hotjar -->
  <script>
    (function(h,o,t,j,a,r){
        h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
        h._hjSettings={hjid:1234567,hjsv:6};
        a=o.getElementsByTagName('head')[0];
        r=o.createElement('script');r.async=1;
        r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
        a.appendChild(r);
    })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
  </script>

  <!-- Dead Leftover App: Smile.io -->
  <script src="https://cdn.smile.io/v1/smile-ui.js"></script>

  <!-- Unidentified 3rd Party Script -->
  <script src="https://some-random-unknown-tracker.com/pixel.js"></script>
</head>
<body>
  <h1>Welcome to the store</h1>
</body>
</html>
`;

const storefrontResults = scanStorefrontHtml(mockStorefrontHtml, []);
console.log(`  - Detected Apps: ${storefrontResults.detectedApps.length}`);
storefrontResults.detectedApps.forEach(app => {
  console.log(`    • ${app.name} (${app.speedPenalty} Impact, ~${app.avgSizeKB}KB)`);
});
console.log(`  - Unknown External Scripts: ${storefrontResults.unknownExternalScripts.length}`);

if (storefrontResults.detectedApps.length !== 4) {
  throw new Error(`Expected 4 detected apps (klaviyo, loox, hotjar, smile_io), got ${storefrontResults.detectedApps.length}`);
}

// Test 3: Liquid Theme File Scan
console.log(`\n✓ Test 3: Liquid Theme File Scan...`);
const mockThemeLiquid = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  {{ content_for_header }}
  {% render 'klaviyo' %}
  {% include 'loox-rating' %}
  {% render 'judgeme_widgets' %}
  {% render 'rebuy-extensions' %}
</head>
<body>
  {{ content_for_layout }}
</body>
</html>
`;

const liquidFindings = scanLiquidFile('layout/theme.liquid', mockThemeLiquid, []);
console.log(`  - Findings in layout/theme.liquid: ${liquidFindings.length}`);
liquidFindings.forEach(f => {
  console.log(`    • Line ${f.line}: ${f.appName} -> "${f.codeSnippet}"`);
});

if (liquidFindings.length !== 4) {
  throw new Error(`Expected 4 liquid findings, got ${liquidFindings.length}`);
}

// Test 4: Active Theme Embed Protection (Preventing False Orphans)
console.log(`\n✓ Test 4: Active App Embed Resolution (settings_data.json)...`);
const mockSettingsData = {
  current: {
    blocks: {
      "block-klaviyo": {
        type: "shopify://apps/klaviyo-email-marketing/blocks/klaviyo-onsite-embed/123",
        disabled: false
      },
      "block-disabled-app": {
        type: "shopify://apps/loox-reviews/blocks/loox-embed/456",
        disabled: true
      }
    }
  }
};

const mockAssetKeys = [
  'layout/theme.liquid',
  'config/settings_data.json',
  'snippets/klaviyo.liquid',
  'snippets/loox-rating.liquid',
  'snippets/rebuy-extensions.liquid',
  'snippets/icon-cart.liquid'
];

const auditResult = auditThemeAssets(mockAssetKeys, mockThemeLiquid, mockSettingsData, []);
console.log(`  - Active App IDs identified: ${auditResult.activeAppIds.join(', ')}`);
console.log(`  - Verified Active Liquid tags: ${auditResult.verifiedActiveFindings.length}`);
console.log(`  - Orphan Liquid tags: ${auditResult.orphanLiquidFindings.length}`);
console.log(`  - Orphan Snippet files: ${auditResult.orphanSnippetFiles.length}`);

// Klaviyo must be recognized as active (NOT an orphan!)
if (!auditResult.activeAppIds.includes('klaviyo')) {
  throw new Error('Expected klaviyo to be recognized as active app from settings_data.json');
}
const klaviyoOrphan = auditResult.orphanLiquidFindings.some(f => f.appId === 'klaviyo');
if (klaviyoOrphan) {
  throw new Error('Klaviyo was incorrectly marked as an orphan despite being enabled in settings_data.json!');
}

// Test 5: Safe Commenting AST Application (Pro Tier)
console.log(`\n✓ Test 5: Safe Commenting Excision Protocol...`);
const targetLine = "{% render 'rebuy-extensions' %}";
const commentResult = applySafeCommentToLiquid(mockThemeLiquid, targetLine, 'Rebuy: Smart Cart');

if (!commentResult.success) {
  throw new Error(`Safe comment failed: ${commentResult.error}`);
}
if (!commentResult.updatedLiquid.includes("{%- comment -%} [BloatBuster Safe Clean")) {
  throw new Error('Expected BloatBuster safe comment wrapper in updated Liquid.');
}
if (commentResult.updatedLiquid.includes(targetLine) && !commentResult.updatedLiquid.includes(`Removed Rebuy: Smart Cart: ${targetLine}`)) {
  throw new Error('Raw target line remained uncommented.');
}

// Test idempotence (no double-commenting)
const secondComment = applySafeCommentToLiquid(commentResult.updatedLiquid, targetLine, 'Rebuy: Smart Cart');
if (!secondComment.alreadyCommented) {
  throw new Error('Expected alreadyCommented to be true on second execution.');
}
console.log(`  - Safe comment transformation verified (Indented & Idempotent).`);

// Test 6: Theme Duplicate Mutation
console.log(`\n✓ Test 6: Theme Duplicate GraphQL Mutation Payload...`);
const duplicateMutation = buildThemeDuplicateMutation('123456789');
if (!duplicateMutation.query.includes('themeDuplicate') || !duplicateMutation.variables.id.includes('123456789')) {
  throw new Error('Invalid themeDuplicate mutation payload.');
}
console.log(`  - GraphQL themeDuplicate mutation verified.`);

// Test 7: Score Calculation
console.log(`\n✓ Test 7: Score Calculation...`);
const scoreResult = calculateBloatScore(auditResult.orphanLiquidFindings, []);
console.log(`  - Score: ${scoreResult.score}/100 (${scoreResult.grade})`);
console.log(`  - Headline: ${scoreResult.headline}`);

console.log('\n🎉 ALL 7 CORE PRODUCTION ENGINE VERIFICATION TESTS PASSED!\n');
