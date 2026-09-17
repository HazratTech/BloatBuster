import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Running Polaris Modal & Toast System Verification...\n');

const htmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
const jsContent = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// Test 1: HTML Markup verification
assert(htmlContent.includes('id="polarisFeedbackModal"'), 'HTML must contain polarisFeedbackModal');
assert(htmlContent.includes('id="polarisToastContainer"'), 'HTML must contain polarisToastContainer');
assert(htmlContent.includes('id="feedbackModalIcon"'), 'HTML must contain feedbackModalIcon');
assert(htmlContent.includes('id="feedbackModalTitle"'), 'HTML must contain feedbackModalTitle');
assert(htmlContent.includes('id="feedbackModalMessage"'), 'HTML must contain feedbackModalMessage');
assert(htmlContent.includes('id="feedbackModalDetails"'), 'HTML must contain feedbackModalDetails');
assert(htmlContent.includes('id="feedbackModalConfirmBtn"'), 'HTML must contain feedbackModalConfirmBtn');
assert(htmlContent.includes('id="feedbackModalCancelBtn"'), 'HTML must contain feedbackModalCancelBtn');
console.log('✓ Test 1: HTML markup structure verified (Feedback Modal & Toast Container)');

// Test 2: CSS Styles verification
assert(cssContent.includes('.feedback-dialog'), 'CSS must define .feedback-dialog');
assert(cssContent.includes('.feedback-icon-badge.type-success'), 'CSS must define .type-success badge');
assert(cssContent.includes('.feedback-icon-badge.type-error'), 'CSS must define .type-error badge');
assert(cssContent.includes('.feedback-icon-badge.type-warning'), 'CSS must define .type-warning badge');
assert(cssContent.includes('.feedback-icon-badge.type-info'), 'CSS must define .type-info badge');
assert(cssContent.includes('.polaris-toast-container'), 'CSS must define .polaris-toast-container');
assert(cssContent.includes('.polaris-toast'), 'CSS must define .polaris-toast');
assert(cssContent.includes('.btn-critical'), 'CSS must define .btn-critical');
assert(cssContent.includes('.copy-chip-btn'), 'CSS must define .copy-chip-btn');
console.log('✓ Test 2: CSS styling verified (All 4 severity types, animations, toast pills)');

// Test 3: App.js Modal functions verification
assert(jsContent.includes('window.showAlert = function'), 'app.js must define window.showAlert');
assert(jsContent.includes('window.showConfirm = function'), 'app.js must define window.showConfirm');
assert(jsContent.includes('window.showToast = function'), 'app.js must define window.showToast');
assert(jsContent.includes('window.showAdviceModal = function'), 'app.js must define window.showAdviceModal');
assert(jsContent.includes('window.copyFeedbackText = function'), 'app.js must define window.copyFeedbackText');
console.log('✓ Test 3: Core Polaris modal & toast JavaScript APIs verified');

// Test 4: Zero generic browser alerts/confirms
const alertMatches = jsContent.match(/\balert\s*\(/g);
const confirmMatches = jsContent.match(/\bconfirm\s*\(/g);
const promptMatches = jsContent.match(/\bprompt\s*\(/g);

assert(!alertMatches, `Expected 0 alert() calls, found ${alertMatches ? alertMatches.length : 0}`);
assert(!confirmMatches, `Expected 0 confirm() calls, found ${confirmMatches ? confirmMatches.length : 0}`);
assert(!promptMatches, `Expected 0 prompt() calls, found ${promptMatches ? promptMatches.length : 0}`);
console.log('✓ Test 4: Verified 0 native alert(), 0 confirm(), and 0 prompt() calls across app.js');

// Test 5: Validate theme backup alert was replaced with rich metadata modal
assert(jsContent.includes("title: 'Theme Safety Backup Created'"), 'Theme backup success must use custom title');
assert(jsContent.includes("'Backup Theme': data.backupTheme.name"), 'Theme backup modal must display Backup Theme name');
assert(jsContent.includes("'Theme ID': String(data.backupTheme.id)"), 'Theme backup modal must display Theme ID');
assert(jsContent.includes("confirmText: 'Awesome!'"), 'Theme backup modal must display Awesome! action button');
console.log('✓ Test 5: Theme backup success modal verified with structured metadata and copy support');

console.log('\n🎉 ALL POLARIS FEEDBACK MODAL VERIFICATION TESTS PASSED!');
