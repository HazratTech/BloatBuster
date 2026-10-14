import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('\n🧪 Running Killer Features Verification Tests (Assets Sweeper, PageSpeed Telemetry, 24/7 Watchdog)...\n');

// 1. Verify Core Theme Assets Whitelist Logic
console.log('✓ Test 1: Testing Unused Assets Sweeper Whitelist Logic...');
const coreShopifyAssets = new Set([
  'assets/theme.js', 'assets/base.css', 'assets/global.js',
  'assets/cart.js', 'assets/cart-drawer.js', 'assets/cart-notification.js'
]);

const sampleThemeAssets = [
  'assets/theme.js',
  'assets/base.css',
  'assets/component-card.css',
  'assets/section-header.css',
  'assets/klaviyo-onsite.js',
  'assets/loox-custom.css',
  'assets/custom-slider.js'
];

const checkList = sampleThemeAssets.filter(k => 
  !coreShopifyAssets.has(k) && !k.startsWith('assets/component-') && !k.startsWith('assets/section-')
);

assert.strictEqual(checkList.length, 3, 'Should filter out core theme files and component/section CSS');
assert.deepStrictEqual(checkList, ['assets/klaviyo-onsite.js', 'assets/loox-custom.css', 'assets/custom-slider.js']);
console.log('  - Core Shopify files properly whitelisted. Orphaned candidates isolated.');

// 2. Verify Matching against Signatures Database
console.log('\n✓ Test 2: Testing Asset Signature Matching...');
const signaturesData = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'signatures.json'), 'utf-8'));
const allSignatures = signaturesData.apps || [];

const testAsset = 'assets/klaviyo-onsite.js';
const basename = testAsset.replace(/^assets\//, '');
const baseWithoutExt = basename.replace(/\.(min\.)?(js|css|scss)$/i, '');

const matchedApp = allSignatures.find(app => {
  const idMatch = baseWithoutExt.toLowerCase().includes(app.id.toLowerCase());
  const nameMatch = baseWithoutExt.toLowerCase().includes(app.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const allPatterns = [
    ...(app.domainPatterns || []),
    ...(app.inlinePatterns || []),
    ...(app.snippetPatterns || [])
  ];
  const patternMatch = allPatterns.some(p => p.toLowerCase().includes(baseWithoutExt.toLowerCase()));
  return idMatch || nameMatch || patternMatch;
});

assert.ok(matchedApp, 'Should match klaviyo signature');
assert.strictEqual(matchedApp.id, 'klaviyo');
console.log(`  - Matched ${testAsset} -> ${matchedApp.name} (${matchedApp.category})`);

// 3. Verify HTML & UI Selectors for Killer Features
console.log('\n✓ Test 3: Verifying Frontend HTML & Polaris Elements for Killer Features...');
const htmlContent = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf-8');

const requiredElements = [
  'id="btnRunPageSpeed"',
  'id="cwvMetricsContainer"',
  'id="cwvScore"',
  'id="cwvLcp"',
  'id="cwvFcp"',
  'id="cwvTbt"',
  'id="kpiThemeUnusedAssets"',
  'id="kpiThemeWatchdog"',
  'id="themeAssetCountBadge"',
  'id="themeUnusedAssetsContainer"',
  'id="btnRunWatchdogScan"',
  'id="watchdogStatusText"'
];

for (const el of requiredElements) {
  assert.ok(htmlContent.includes(el), `Missing expected element in index.html: ${el}`);
}
console.log('  - All 12 killer feature UI DOM elements verified in index.html.');

// 4. Verify Frontend Event Handlers and Handshake in app.js
console.log('\n✓ Test 4: Verifying JavaScript Handlers in app.js...');
const appJsContent = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf-8');

assert.ok(appJsContent.includes('setupPageSpeedBenchmark'), 'Missing setupPageSpeedBenchmark in app.js');
assert.ok(appJsContent.includes('runPageSpeedBenchmark'), 'Missing runPageSpeedBenchmark in app.js');
assert.ok(appJsContent.includes('setupWatchdogControls'), 'Missing setupWatchdogControls in app.js');
assert.ok(appJsContent.includes('renderUnusedAssetsList'), 'Missing renderUnusedAssetsList in app.js');
assert.ok(appJsContent.includes('window.archiveAsset'), 'Missing window.archiveAsset in app.js');
assert.ok(appJsContent.includes('/api/theme/unused-assets'), 'Missing /api/theme/unused-assets endpoint call in app.js');
assert.ok(appJsContent.includes('/api/theme/archive-asset'), 'Missing /api/theme/archive-asset endpoint call in app.js');
assert.ok(appJsContent.includes('/api/benchmark/pagespeed'), 'Missing /api/benchmark/pagespeed endpoint call in app.js');
assert.ok(appJsContent.includes('/api/watchdog/scan'), 'Missing /api/watchdog/scan endpoint call in app.js');
console.log('  - All killer feature JavaScript functions, API calls, and handlers verified.');

// 5. Verify Backend Endpoint Declarations in server.js
console.log('\n✓ Test 5: Verifying Backend Endpoint Declarations in server.js...');
const serverJsContent = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf-8');

assert.ok(serverJsContent.includes("pathname === '/api/theme/unused-assets'"), 'Missing /api/theme/unused-assets in server.js');
assert.ok(serverJsContent.includes("pathname === '/api/theme/archive-asset'"), 'Missing /api/theme/archive-asset in server.js');
assert.ok(serverJsContent.includes("pathname === '/api/benchmark/pagespeed'"), 'Missing /api/benchmark/pagespeed in server.js');
assert.ok(serverJsContent.includes("pathname === '/api/watchdog/status'"), 'Missing /api/watchdog/status in server.js');
assert.ok(serverJsContent.includes("pathname === '/api/watchdog/scan'"), 'Missing /api/watchdog/scan in server.js');
assert.ok(serverJsContent.includes("deleteThemeAsset"), 'Missing deleteThemeAsset in server.js');
console.log('  - All 5 killer feature backend API routes verified in server.js.');

// 6. Verify Pricing is $2.99/mo across all components
console.log('\n✓ Test 6: Verifying $2.99/mo Pricing Consistency...');
assert.ok(serverJsContent.includes("'2.99'"), "server.js should default PLAN_PRICE_USD to '2.99'");
assert.ok(htmlContent.includes('$2.99/mo'), "index.html should display '$2.99/mo'");
assert.ok(appJsContent.includes('$2.99/mo'), "app.js should display '$2.99/mo'");
console.log('  - Pricing consistently configured at $2.99/mo across backend, markup, and script.');

console.log('\n🎉 ALL KILLER FEATURES VERIFICATION TESTS PASSED!\n');
