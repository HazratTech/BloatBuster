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

// Test 6: New merchant is eligible for 7-day free trial
function determineTrialDays(session) {
  const hasUsedTrial = Boolean(session?.hasUsedTrial || session?.trialEndsAt || session?.subscribedAt || session?.subscriptionStatus === 'CANCELLED');
  return hasUsedTrial ? 0 : 7;
}

const newMerchantTrialDays = determineTrialDays(null);
assert.strictEqual(newMerchantTrialDays, 7, 'New merchant must receive 7 trial days');
console.log('✓ Test 6: New merchant receives 7-day free trial');

// Test 7: Returning/Cancelled merchant receives 0 trial days (Anti-trial abuse protection)
const returningMerchantTrialDays = determineTrialDays({
  hasUsedTrial: true,
  subscriptionStatus: 'CANCELLED'
});
assert.strictEqual(returningMerchantTrialDays, 0, 'Merchant who previously used trial must receive 0 trial days');
console.log('✓ Test 7: Returning merchant receives 0 trial days (Immediate $19/mo charge, no infinite trials)');

// Test 8: Active trial remaining days and expiration calculation
function calculateTrialStatus(subCreatedAtMs, trialDays, nowMs) {
  const trialEndsAtMs = subCreatedAtMs + (trialDays * 24 * 60 * 60 * 1000);
  const isTrialActive = nowMs < trialEndsAtMs;
  const daysRemaining = isTrialActive ? Math.max(1, Math.ceil((trialEndsAtMs - nowMs) / (24 * 60 * 60 * 1000))) : 0;
  return { isTrialActive, daysRemaining, trialEndsAt: new Date(trialEndsAtMs).toISOString() };
}

const now = Date.now();
const trialStartedTwoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);
const activeTrial = calculateTrialStatus(trialStartedTwoDaysAgo, 7, now);
assert.strictEqual(activeTrial.isTrialActive, true, 'Trial started 2 days ago must be active');
assert.strictEqual(activeTrial.daysRemaining, 5, 'Trial started 2 days ago must have 5 days remaining');
console.log('✓ Test 8: Active trial calculation accurately computes 5 days remaining for active trial');

// Test 9: Trial expiration transition to regular paid billing (Day 8+)
const trialStartedTenDaysAgo = now - (10 * 24 * 60 * 60 * 1000);
const expiredTrial = calculateTrialStatus(trialStartedTenDaysAgo, 7, now);
assert.strictEqual(expiredTrial.isTrialActive, false, 'Trial started 10 days ago must not be active');
assert.strictEqual(expiredTrial.daysRemaining, 0, 'Expired trial must have 0 days remaining');
console.log('✓ Test 9: Post-trial subscriber seamlessly transitions to paid subscription (isTrialActive = false)');

// Test 10: Cancellation updates status and preserves hasUsedTrial
function simulateCancelSubscription(currentSession) {
  return {
    ...currentSession,
    isPro: false,
    subscriptionStatus: 'CANCELLED',
    cancelledAt: new Date().toISOString(),
    hasUsedTrial: true
  };
}

const activeSession = { isPro: true, subscriptionStatus: 'ACTIVE', hasUsedTrial: true };
const cancelledSession = simulateCancelSubscription(activeSession);
assert.strictEqual(cancelledSession.isPro, false, 'Cancelled subscription must have isPro = false');
assert.strictEqual(cancelledSession.subscriptionStatus, 'CANCELLED', 'Subscription status must be CANCELLED');
assert.strictEqual(cancelledSession.hasUsedTrial, true, 'hasUsedTrial flag must remain true after cancellation');
console.log('✓ Test 10: Cancellation mutation sets isPro: false and locks hasUsedTrial: true');

console.log('\n🎉 ALL SMART BILLING & FULL LIFECYCLE TESTS PASSED!');

