/**
 * BloatBuster - Shopify Polaris Native Frontend Logic
 */

let allSignatures = [];
let currentScanData = null;
let activeAppOverrides = new Set();

document.addEventListener('DOMContentLoaded', () => {
  initShopContext();
  initTabs();
  initBilling();
  loadSignatures();
  setupScanForm();
  setupDemoPills();
  setupLiquidInspector();
  setupModals();
});

// Helper to get current clean shop domain
function getCurrentShop() {
  const params = new URLSearchParams(window.location.search);
  const shopFromUrl = params.get('shop');
  const storeInput = document.getElementById('storeUrlInput');
  const raw = shopFromUrl || storeInput?.value || 'relayworks.myshopify.com';
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// Check and Initialize Billing Status
async function initBilling() {
  const params = new URLSearchParams(window.location.search);
  const isSubscribedFromUrl = params.get('plan') === 'pro' || params.get('subscribed') === 'true';
  const banner = document.getElementById('proActiveBanner');
  const openProBtn = document.getElementById('openProModal');
  const startTrialBtn = document.getElementById('btnStartTrial');
  const cleanShop = getCurrentShop();

  if (isSubscribedFromUrl && banner) {
    banner.style.display = 'flex';
    if (openProBtn) {
      openProBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 20 20" fill="#008060">
          <path fill-rule="evenodd" d="M10 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8.707 13.707a1 1 0 0 1-1.414 0l-3-3a1 1 0 0 1 1.414-1.414L8 11.586l6.293-6.293a1 1 0 0 1 1.414 1.414l-7 7Z" clip-rule="evenodd"/>
        </svg>
        Pro Plan Active
      `;
    }
  }

  // Check live billing status from backend
  try {
    const res = await fetch(`/api/billing/status?shop=${cleanShop}`);
    const data = await res.json();
    if (data.isPro) {
      if (banner) banner.style.display = 'flex';
      if (openProBtn) {
        openProBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 20 20" fill="#008060">
            <path fill-rule="evenodd" d="M10 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8.707 13.707a1 1 0 0 1-1.414 0l-3-3a1 1 0 0 1 1.414-1.414L8 11.586l6.293-6.293a1 1 0 0 1 1.414 1.414l-7 7Z" clip-rule="evenodd"/>
          </svg>
          Pro Plan Active
        `;
      }
    }
  } catch (err) {
    console.warn('Could not verify billing status:', err);
  }

  // Handle Trial / Subscription Click
  if (startTrialBtn) {
    startTrialBtn.addEventListener('click', async () => {
      startTrialBtn.disabled = true;
      startTrialBtn.innerHTML = `
        <span class="polaris-spinner" style="width: 16px; height: 16px; margin: 0 8px 0 0; display: inline-block; vertical-align: middle;"></span>
        Connecting to Shopify Billing...
      `;

      try {
        const res = await fetch('/api/billing/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop: cleanShop })
        });
        const data = await res.json();

        if (data.confirmationUrl) {
          // Open parent window directly to Shopify's native Subscription Approval Screen
          if (window.top) {
            window.top.location.href = data.confirmationUrl;
          } else {
            window.location.href = data.confirmationUrl;
          }
        } else if (data.error) {
          alert(`Shopify Billing Notice: ${data.error}`);
          startTrialBtn.disabled = false;
          startTrialBtn.textContent = 'Start 7-Day Free Trial';
        }
      } catch (err) {
        alert(`Failed to start subscription: ${err.message}`);
        startTrialBtn.disabled = false;
        startTrialBtn.textContent = 'Start 7-Day Free Trial';
      }
    });
  }
}

// 1. Detect Shop Context from Shopify Admin iframe query params
function initShopContext() {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get('shop');
  const storeInput = document.getElementById('storeUrlInput');
  const domainHeader = document.getElementById('storeDomainHeader');

  if (shop) {
    if (storeInput) storeInput.value = shop;
    if (domainHeader) domainHeader.textContent = shop;
  }
}

// 2. Navigation Tabs
function initTabs() {
  const tabs = document.querySelectorAll('.tab-link');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetTab = tab.dataset.tab;
      document.querySelectorAll('.tab-pane').forEach(c => c.style.display = 'none');
      const activeContent = document.getElementById(`tab-${targetTab}`);
      if (activeContent) activeContent.style.display = 'block';
    });
  });
}

// 3. Load App Signatures
async function loadSignatures() {
  try {
    const res = await fetch('/api/signatures');
    const data = await res.json();
    allSignatures = data.apps || [];
    renderSignatures(allSignatures);

    const filterInput = document.getElementById('filterSignaturesInput');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allSignatures.filter(app => 
          app.name.toLowerCase().includes(query) || 
          app.category.toLowerCase().includes(query) ||
          app.description.toLowerCase().includes(query)
        );
        renderSignatures(filtered);
      });
    }
  } catch (err) {
    console.error('Failed to load signatures:', err);
  }
}

function renderSignatures(apps) {
  const container = document.getElementById('signaturesGrid');
  if (!container) return;

  if (apps.length === 0) {
    container.innerHTML = `<div style="color: var(--p-color-text-secondary); grid-column: 1/-1;">No matching apps found.</div>`;
    return;
  }

  container.innerHTML = apps.map(app => `
    <div style="background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-radius-sm); padding: 14px; box-shadow: var(--p-shadow-card);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
        <div style="font-weight: 600; font-size: 13.5px; color: var(--p-color-text);">${escapeHtml(app.name)}</div>
        <span class="badge badge-${app.speedPenalty === 'High' ? 'critical' : app.speedPenalty === 'Medium' ? 'warning' : 'info'}">${app.speedPenalty}</span>
      </div>
      <div style="font-size: 11px; color: var(--p-color-text-secondary); margin-bottom: 8px;">${escapeHtml(app.category)}</div>
      <div style="font-size: 12px; color: var(--p-color-text-secondary); line-height: 1.4; margin-bottom: 10px;">${escapeHtml(app.description)}</div>
      <div style="font-size: 11px; font-family: var(--p-font-mono); color: var(--p-color-text-subdued);">
        Avg. Transfer: ~${app.avgSizeKB}KB &bull; Delay: +${app.avgDelayMs}ms
      </div>
    </div>
  `).join('');
}

// 4. Setup Scan Form
function setupScanForm() {
  const form = document.getElementById('scanForm');
  const input = document.getElementById('storeUrlInput');
  const btnTop = document.getElementById('btnRunAuditTop');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (url) executeScan(url);
    });
  }

  if (btnTop) {
    btnTop.addEventListener('click', () => {
      const url = input.value.trim() || 'relayworks.myshopify.com';
      executeScan(url);
    });
  }
}

function setupDemoPills() {
  const pills = document.querySelectorAll('.pill-btn[data-url]');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      const url = pill.dataset.url;
      const input = document.getElementById('storeUrlInput');
      input.value = url;
      executeScan(url);
    });
  });
}

// 5. Execute Storefront Scan
async function executeScan(storeUrl) {
  const scanningState = document.getElementById('scanningState');
  const reportView = document.getElementById('reportView');
  const submitBtn = document.getElementById('scanSubmitBtn');
  const statusMsg = document.getElementById('scanStatusMsg');

  reportView.style.display = 'none';
  scanningState.style.display = 'block';
  submitBtn.disabled = true;

  statusMsg.textContent = `Establishing connection to ${storeUrl}...`;
  setTimeout(() => { statusMsg.textContent = 'Extracting storefront scripts & preconnect tags...'; }, 500);
  setTimeout(() => { statusMsg.textContent = 'Comparing DOM against 52 verified app signatures...'; }, 1100);

  try {
    let result;
    if (storeUrl === 'demo-bloated-store') {
      result = getMockDemoScanResult();
      await new Promise(r => setTimeout(r, 1200));
    } else {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeUrl, activeApps: Array.from(activeAppOverrides) })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Scan error HTTP ${res.status}`);
      }
      result = await res.json();
    }

    currentScanData = result;
    activeAppOverrides.clear();
    renderReport(result);
  } catch (err) {
    alert(`Storefront Scan Error: ${err.message}`);
  } finally {
    scanningState.style.display = 'none';
    submitBtn.disabled = false;
  }
}

// 6. Render Report with Polaris Elements
function renderReport(data) {
  const reportView = document.getElementById('reportView');
  reportView.style.display = 'block';

  const suspectedOrphans = data.detectedApps.filter(app => !activeAppOverrides.has(app.appId));
  const activeApps = data.detectedApps.filter(app => activeAppOverrides.has(app.appId));

  const totalWastedKB = suspectedOrphans.reduce((sum, a) => sum + (a.avgSizeKB || 140), 0);
  const totalDelaySeconds = (suspectedOrphans.reduce((sum, a) => sum + (a.avgDelayMs || 250), 0) / 1000).toFixed(2);
  
  let score = 100 - (suspectedOrphans.length * 12);
  score = Math.max(15, Math.min(100, score));

  // Circular Dial Animation
  const dialCircle = document.getElementById('dialCircleValue');
  const scoreNum = document.getElementById('scoreNum');
  const scoreGrade = document.getElementById('scoreGrade');
  const headlineText = document.getElementById('headlineText');

  scoreNum.textContent = score;

  // Circle circumference for r=40 is ~251.2
  const circumference = 251.2;
  const offset = circumference - (score / 100) * circumference;
  dialCircle.style.strokeDashoffset = offset;

  if (score < 60) {
    dialCircle.style.stroke = 'var(--p-color-critical)';
    scoreGrade.textContent = 'Grade F • High Risk';
    scoreGrade.style.color = 'var(--p-color-critical)';
    headlineText.textContent = 'Critical Theme Debt';
  } else if (score < 80) {
    dialCircle.style.stroke = 'var(--p-color-warning)';
    scoreGrade.textContent = 'Grade C • Action Advised';
    scoreGrade.style.color = 'var(--p-color-warning)';
    headlineText.textContent = 'Moderate Theme Debt';
  } else {
    dialCircle.style.stroke = 'var(--p-color-primary)';
    scoreGrade.textContent = 'Grade A • Optimized';
    scoreGrade.style.color = 'var(--p-color-primary)';
    headlineText.textContent = 'Clean Theme Health';
  }

  // Update Metric KPIs
  document.getElementById('kpiOrphans').textContent = `${suspectedOrphans.length} Scripts`;
  document.getElementById('kpiWastedKB').textContent = `${totalWastedKB} KB`;
  document.getElementById('kpiDelay').textContent = `+${totalDelaySeconds}s`;
  document.getElementById('findingsBadge').textContent = `${suspectedOrphans.length} Action Items`;

  // Render Table Rows
  const container = document.getElementById('findingsContainer');
  if (!data.detectedApps || data.detectedApps.length === 0) {
    container.innerHTML = `
      <div style="padding: 28px; text-align: center; color: var(--p-color-primary); font-weight: 500;">
        Zero third-party orphan scripts detected on ${escapeHtml(data.storeUrl)}. Your storefront is exceptionally clean.
      </div>
    `;
    return;
  }

  container.innerHTML = data.detectedApps.map(app => {
    const isOrphan = !activeAppOverrides.has(app.appId);
    const evidence = app.matchReasons?.[0]?.evidence || 'External script tag found in HTML DOM';

    return `
      <div class="table-row">
        <div class="row-primary">
          <div class="app-avatar">
            ${getCategorySvg(app.category)}
          </div>
          <div class="app-details">
            <div class="app-title-bar">
              <span class="app-name">${escapeHtml(app.name)}</span>
              <span class="badge badge-${app.speedPenalty === 'High' ? 'critical' : 'warning'}">${app.speedPenalty} Impact</span>
              <span class="badge ${isOrphan ? 'badge-critical' : 'badge-success'}">
                ${isOrphan ? 'Leftover Orphan' : 'Active App'}
              </span>
            </div>
            <div class="code-evidence" title="${escapeHtml(evidence)}">
              ${escapeHtml(evidence)}
            </div>
          </div>
        </div>

        <div class="row-actions">
          <button class="btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="toggleAppStatus('${app.appId}')">
            ${!isOrphan ? 'Mark as Inactive' : 'Still In Use'}
          </button>
          <button class="btn-primary" style="font-size: 12px; padding: 6px 12px;" onclick="showExcisionModal('${app.appId}')">
            Excision Guide
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Unknown External Scripts
  const unknownSection = document.getElementById('unknownSection');
  const unknownContainer = document.getElementById('unknownContainer');
  const unknownCountBadge = document.getElementById('unknownCountBadge');

  if (data.unknownExternalScripts && data.unknownExternalScripts.length > 0) {
    unknownSection.style.display = 'block';
    unknownCountBadge.textContent = `${data.unknownExternalScripts.length} Scripts`;
    unknownContainer.innerHTML = data.unknownExternalScripts.map(s => `
      <div style="font-family: var(--p-font-mono); font-size: 11.5px; color: var(--p-color-text-secondary); background: var(--p-color-bg-surface-secondary); border: 1px solid var(--p-color-border-subdued); padding: 8px 12px; border-radius: 4px; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(s.url)}
      </div>
    `).join('');
  } else {
    unknownSection.style.display = 'none';
  }

  reportView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 7. Interactive Toggle
window.toggleAppStatus = function(appId) {
  if (activeAppOverrides.has(appId)) {
    activeAppOverrides.delete(appId);
  } else {
    activeAppOverrides.add(appId);
  }
  if (currentScanData) {
    renderReport(currentScanData);
  }
};

// 8. Safe Excision Modal
window.showExcisionModal = function(appId) {
  const app = currentScanData?.detectedApps?.find(a => a.appId === appId);
  if (!app) return;

  const modal = document.getElementById('excisionModal');
  document.getElementById('modalAppTitle').textContent = `Removal Protocol &bull; ${app.name}`;

  const evidence = app.matchReasons?.[0]?.evidence || `<script src="...${appId}..."></script>`;
  document.getElementById('modalOriginalCode').textContent = evidence;
  document.getElementById('modalReplacementCode').textContent = 
    `{%- comment -%} [BloatBuster Safe Excision] Removed ${app.name}: ${evidence} {%- endcomment -%}`;

  const stepsList = document.getElementById('modalStepsList');
  stepsList.innerHTML = `
    <li>Open your Shopify Admin &rarr; <strong>Online Store</strong> &rarr; <strong>Themes</strong>.</li>
    <li>Click <strong>&hellip; (Actions)</strong> next to your active theme &rarr; <strong>Edit Code</strong>.</li>
    <li>Locate <code>layout/theme.liquid</code> or snippets matching <code>${app.snippetPatterns?.[0] || appId}</code>.</li>
    <li>Delete the script tag or replace with the safe comment above.</li>
    <li>Click <strong>Save</strong> in the upper-right corner.</li>
  `;

  const cleanShop = (currentScanData?.storeUrl || 'store.myshopify.com').replace('.myshopify.com', '').replace(/^https?:\/\//, '');
  const editorUrl = `https://admin.shopify.com/store/${cleanShop}/themes/current/editor?key=layout/theme.liquid`;
  document.getElementById('modalEditorLink').href = editorUrl;

  modal.style.display = 'flex';
};

// 9. Theme.liquid Code Inspector
function setupLiquidInspector() {
  const scanBtn = document.getElementById('scanLiquidBtn');
  const input = document.getElementById('liquidCodeInput');
  const resultsCard = document.getElementById('liquidResultsCard');
  const badge = document.getElementById('liquidFindingsBadge');
  const container = document.getElementById('liquidFindingsContainer');

  if (!scanBtn) return;

  scanBtn.addEventListener('click', async () => {
    const liquidCode = input.value.trim();
    if (!liquidCode) {
      alert('Please paste liquid code from your theme file.');
      return;
    }

    scanBtn.disabled = true;
    scanBtn.textContent = 'Analyzing...';

    try {
      const res = await fetch('/api/scan-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liquidCode })
      });
      const data = await res.json();

      resultsCard.style.display = 'block';
      badge.textContent = `${data.findingsCount} References`;

      if (data.findingsCount === 0) {
        container.innerHTML = `<div style="padding: 20px; color: var(--p-color-primary); font-weight: 500; text-align: center;">No third-party app tags detected in this code block.</div>`;
      } else {
        container.innerHTML = data.findings.map(f => `
          <div class="table-row">
            <div class="row-primary">
              <div class="app-avatar">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4Zm1.5 4a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 5.5 6Zm0 3.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="app-details">
                <div class="app-title-bar">
                  <span class="app-name">Line ${f.line}: ${escapeHtml(f.appName)}</span>
                  <span class="badge badge-${f.speedPenalty === 'High' ? 'critical' : 'warning'}">${f.speedPenalty}</span>
                </div>
                <div class="code-evidence">
                  <code>${escapeHtml(f.codeSnippet)}</code>
                </div>
              </div>
            </div>
            <div class="row-actions">
              <button class="btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="alert('Line ${f.line}: ${escapeHtml(f.cleanupAdvice)}')">
                Advice
              </button>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      alert(`Liquid Inspector Error: ${err.message}`);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Analyze Liquid AST';
    }
  });
}

// 10. Modals
function setupModals() {
  const excisionModal = document.getElementById('excisionModal');
  const closeExcisionModal = document.getElementById('closeExcisionModal');
  if (closeExcisionModal) {
    closeExcisionModal.addEventListener('click', () => excisionModal.style.display = 'none');
  }

  const proModal = document.getElementById('proModal');
  const openProModal = document.getElementById('openProModal');
  const closeProModal = document.getElementById('closeProModal');

  if (openProModal) {
    openProModal.addEventListener('click', () => proModal.style.display = 'flex');
  }
  if (closeProModal) {
    closeProModal.addEventListener('click', () => proModal.style.display = 'none');
  }

  window.addEventListener('click', (e) => {
    if (e.target === excisionModal) excisionModal.style.display = 'none';
    if (e.target === proModal) proModal.style.display = 'none';
  });
}

// Crisp Vector SVGs for App Categories (No Emojis)
function getCategorySvg(category) {
  if (category.includes('Reviews')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 0 0 .95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 0 0-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 0 0-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 0 0-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 0 0 .951-.69l1.07-3.292Z"/></svg>`;
  }
  if (category.includes('Email') || category.includes('SMS')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z"/><path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z"/></svg>`;
  }
  if (category.includes('Analytics') || category.includes('Heatmap')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Zm4 11a1 1 0 0 0 2 0v-4a1 1 0 0 0-2 0v4Zm4 0a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v7Zm4 0a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0v2Z"/></svg>`;
  }
  if (category.includes('Support') || category.includes('Chat')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 2c-4.418 0-8 3.134-8 7 0 1.766.756 3.39 2.029 4.633a.75.75 0 0 1 .218.497l-.234 2.112a.75.75 0 0 0 .964.792l2.39-.797a.75.75 0 0 1 .459.027A8.47 8.47 0 0 0 10 16c4.418 0 8-3.134 8-7s-3.582-7-8-7Z" clip-rule="evenodd"/></svg>`;
  }
  if (category.includes('Subscription')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.451a.75.75 0 0 0 0-1.5H4.5a.75.75 0 0 0-.75.75v3.75a.75.75 0 0 0 1.5 0v-2.034l.432.432a7 7 0 0 0 11.666-3.138.75.75 0 1 0-1.458-.415ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.451a.75.75 0 0 0 0 1.5h3.75a.75.75 0 0 0 .75-.75V3.421a.75.75 0 0 0-1.5 0v2.034l-.432-.432a7 7 0 0 0-11.666 3.138.75.75 0 0 0 1.458.415Z" clip-rule="evenodd"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.5 2A2.5 2.5 0 0 0 2 4.5v11A2.5 2.5 0 0 0 4.5 18h11a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 15.5 2h-11ZM6.75 6.25a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3.5a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clip-rule="evenodd"/></svg>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function getMockDemoScanResult() {
  return {
    storeUrl: 'relayworks-sample.myshopify.com',
    finalUrl: 'https://relayworks.myshopify.com',
    scanDurationMs: 680,
    score: 52,
    grade: 'F',
    badgeColor: '#D72C0D',
    headline: 'Critical Theme Debt Detected',
    recommendation: '4 dead third-party scripts were found executing on your storefront.',
    metrics: {
      totalOrphans: 4,
      highSeverityCount: 3,
      mediumSeverityCount: 1,
      lowSeverityCount: 0,
      totalWastedKB: 745,
      estimatedDelaySeconds: 1.42,
      unknownScriptsCount: 1
    },
    summary: {
      totalScriptsFound: 16,
      externalScriptsCount: 10,
      inlineScriptsCount: 6,
      stylesheetsCount: 4,
      suspectedOrphansCount: 4,
      activeAppsCount: 0,
      unidentifiedThirdPartyCount: 1
    },
    detectedApps: [
      {
        appId: 'klaviyo',
        name: 'Klaviyo: Email & SMS',
        category: 'Email & SMS Marketing',
        speedPenalty: 'High',
        avgSizeKB: 185,
        avgDelayMs: 320,
        description: 'Identity tracking, signup popups, and event listeners.',
        snippetPatterns: ['klaviyo.liquid'],
        status: 'suspected_orphan',
        matchReasons: [{ type: 'external_script', evidence: 'https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=XYZ123' }]
      },
      {
        appId: 'loox',
        name: 'Loox: Product Reviews & Photos',
        category: 'Reviews & Social Proof',
        speedPenalty: 'High',
        avgSizeKB: 210,
        avgDelayMs: 380,
        description: 'Star rating badges, carousel modal scripts, and photo grids.',
        snippetPatterns: ['loox-rating.liquid'],
        status: 'suspected_orphan',
        matchReasons: [{ type: 'external_script', evidence: 'https://loox.io/widget/loox.js?shop=demo.myshopify.com' }]
      },
      {
        appId: 'hotjar',
        name: 'Hotjar: User Session Recordings',
        category: 'Analytics & Heatmaps',
        speedPenalty: 'High',
        avgSizeKB: 190,
        avgDelayMs: 450,
        description: 'Continuous DOM mutation observers logging user clicks and scrolls.',
        snippetPatterns: ['hotjar.liquid'],
        status: 'suspected_orphan',
        matchReasons: [{ type: 'inline_script', evidence: '(function(h,o,t,j,a,r){ ... static.hotjar.com ... })' }]
      },
      {
        appId: 'reconvert',
        name: 'ReConvert: Post Purchase Upsell',
        category: 'Upsells & Bundles',
        speedPenalty: 'Medium',
        avgSizeKB: 160,
        avgDelayMs: 270,
        description: 'Post-purchase upsell triggers and cart intercept listeners.',
        snippetPatterns: ['reconvert.liquid'],
        status: 'suspected_orphan',
        matchReasons: [{ type: 'external_script', evidence: 'https://cdn.reconvert.io/assets/stik-reconvert.js' }]
      }
    ],
    unknownExternalScripts: [
      { url: 'https://ad-pixel-unidentified-collector.org/pixel.js', snippet: 'src="https://ad-pixel-unidentified-collector.org/pixel.js"' }
    ]
  };
}
