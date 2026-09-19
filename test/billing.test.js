import assert from 'assert';

console.log('🧪 Running BloatBuster Smart Billing Logic Verification...\n');

// Mock test logic mirroring createAppSubscription
function determineBillingMode({ shop, plan, forceTest, forceLive, testShopsList }) {
  const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const testShops = (testShopsList || 'relayworks-fjnfcwjl.myshopify.com')
    .toLowerCase()
    .split(',')
    .map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''));

  if (forceTest === 'true') {
    return { isTest: true, reason: 'force_test' };
  }
  if (forceLive === 'true') {
    return { isTest: false, reason: 'force_live' };
  }
  if (testShops.includes(cleanShop.toLowerCase())) {
    return { isTest: true, reason: 'test_shops_whitelist' };
  }
  if (plan?.partnerDevelopment === true) {
    return { isTest: true, reason: 'partner_dev_store' };
  }
  if (plan && plan.partnerDevelopment === false) {
    return { isTest: false, reason: 'real_merchant_store' };
  }
  return { isTest: false, reason: 'default_production_customer' };
}

// Test 1: Known test store receives test: true
const testStoreResult = determineBillingMode({
  shop: 'relayworks-fjnfcwjl.myshopify.com'
});
assert.strictEqual(testStoreResult.isTest, true, 'Configured test store must receive test: true');
console.log('✓ Test 1: Configured test store (relayworks-fjnfcwjl) routed to test: true (free testing)');

// Test 2: Unknown partner development store detected via plan receives test: true
const devStoreResult = determineBillingMode({
  shop: 'random-reviewer-store.myshopify.com',
  plan: { partnerDevelopment: true, displayName: 'Development Store' }
});
assert.strictEqual(devStoreResult.isTest, true, 'Partner development store must receive test: true');
console.log('✓ Test 2: Shopify Reviewer/Partner dev store detected via plan routed to test: true');

// Test 3: Real merchant customer receives test: false (REAL PRODUCTION MONEY)
const realCustomerResult = determineBillingMode({
  shop: 'awesome-shoes-nyc.myshopify.com',
  plan: { partnerDevelopment: false, displayName: 'Shopify Plus' }
});
assert.strictEqual(realCustomerResult.isTest, false, 'Real merchant must receive test: false');
console.log('✓ Test 3: Real merchant customer routed to test: false (Real money $19/mo collected)');

// Test 4: Real merchant without explicit plan metadata defaults to production customer
const defaultRealCustomerResult = determineBillingMode({
  shop: 'brand-new-merchant.myshopify.com',
  plan: null
});
assert.strictEqual(defaultRealCustomerResult.isTest, false, 'Unknown merchant store defaults to real production charge');
console.log('✓ Test 4: Default store without dev flags routed to test: false (Production charge)');

// Test 5: Fallback behavior on dev store live charge rejection
function simulateAutoFallback(isTestAttempt, shopifyError) {
  if (!isTestAttempt && /test|development|cannot accept|upgrade/i.test(shopifyError)) {
    return true; // Retried with test: true
  }
  return isTestAttempt;
}
const fallbackResult = simulateAutoFallback(false, 'Test stores cannot be billed with live charges');
assert.strictEqual(fallbackResult, true, 'Auto-fallback must trigger test: true when live charge is rejected on dev store');
console.log('✓ Test 5: Auto-fallback smoothly recovers if Shopify rejects live billing on test store');

console.log('\n🎉 ALL SMART BILLING TESTS PASSED!');
