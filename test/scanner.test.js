/**
 * BloatBuster - Verification Test Suite
 * Tests scanner matching against realistic Shopify storefront HTML and Liquid theme snippets.
 */

import { scanStorefrontHtml } from '../lib/scanner/storefrontScanner.js';
import { scanLiquidFile, scanSnippetFilenames } from '../lib/scanner/themeScanner.js';
import { calculateBloatScore } from '../lib/scanner/scoringEngine.js';
import { generateExcisionGuide } from '../lib/remover/safeRemover.js';

console.log('🧪 Running BloatBuster Core Engine Verification Tests...\n');

// 1. Mock HTML fixture of a typical Shopify storefront with leftover scripts
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

  <!-- Unidentified 3rd Party Script -->
  <script src="https://some-random-unknown-tracker.com/pixel.js"></script>
</head>
<body>
  <h1>Welcome to the store</h1>
</body>
</html>
`;

// Test 1: Storefront Scan
const storefrontResults = scanStorefrontHtml(mockStorefrontHtml, []);
console.log(`✓ Storefront Scan completed:`);
console.log(`  - Detected Apps: ${storefrontResults.detectedApps.length}`);
storefrontResults.detectedApps.forEach(app => {
  console.log(`    • ${app.name} (${app.speedPenalty} Impact, ~${app.avgSizeKB}KB)`);
});
console.log(`  - Unknown External Scripts: ${storefrontResults.unknownExternalScripts.length}`);

if (storefrontResults.detectedApps.length !== 3) {
  throw new Error(`Expected 3 detected apps, got ${storefrontResults.detectedApps.length}`);
}

// Test 2: Liquid Theme File Scan
const mockThemeLiquid = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  {{ content_for_header }}
  {% render 'klaviyo' %}
  {% include 'loox-rating' %}
  {% render 'judgeme_widgets' %}
</head>
<body>
  {{ content_for_layout }}
</body>
</html>
`;

const liquidFindings = scanLiquidFile('layout/theme.liquid', mockThemeLiquid, []);
console.log(`\n✓ Liquid Theme File Scan completed:`);
console.log(`  - Findings in layout/theme.liquid: ${liquidFindings.length}`);
liquidFindings.forEach(f => {
  console.log(`    • Line ${f.line}: ${f.appName} -> "${f.codeSnippet}"`);
});

if (liquidFindings.length !== 3) {
  throw new Error(`Expected 3 liquid findings, got ${liquidFindings.length}`);
}

// Test 3: Snippet Filenames Scan
const mockSnippets = ['snippets/klaviyo.liquid', 'snippets/loox-rating.liquid', 'snippets/icon-cart.liquid'];
const snippetFindings = scanSnippetFilenames(mockSnippets, []);
console.log(`\n✓ Snippet Filename Scan completed:`);
console.log(`  - Orphan snippets identified: ${snippetFindings.length}`);
snippetFindings.forEach(s => console.log(`    • ${s.filePath} (${s.appName})`));

if (snippetFindings.length !== 2) {
  throw new Error(`Expected 2 orphan snippets, got ${snippetFindings.length}`);
}

// Test 4: Health Score Calculation
const scoreResult = calculateBloatScore(storefrontResults.detectedApps, storefrontResults.unknownExternalScripts);
console.log(`\n✓ Score Calculation completed:`);
console.log(`  - Score: ${scoreResult.score}/100 (Grade: ${scoreResult.grade})`);
console.log(`  - Headline: ${scoreResult.headline}`);
console.log(`  - Estimated Wasted Weight: ${scoreResult.metrics.totalWastedKB} KB`);
console.log(`  - Estimated Page Delay: ${scoreResult.metrics.estimatedDelaySeconds}s`);

// Test 5: Safe Removal Guide Generation
const excisionGuide = generateExcisionGuide(liquidFindings[0], 'teststore.myshopify.com', '123456');
console.log(`\n✓ Excision Guide Generation completed:`);
console.log(`  - Deep link: ${excisionGuide.editorDeepLink}`);
console.log(`  - Replacement: ${excisionGuide.safeReplacementCode}`);

console.log('\n🎉 ALL 5 CORE ENGINE VERIFICATION TESTS PASSED!\n');
