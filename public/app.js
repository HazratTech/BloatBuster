/**
 * BloatBuster - Shopify Polaris Native Frontend Logic
 * Version 2.2 Production Grade
 */

let allSignatures = [];
let currentScanData = null;
let currentThemeAuditData = null;
let activeAppOverrides = new Set();
let isProUser = false;
let currentShopTheme = null;

// Helper to retrieve App Bridge session token (JWT ID token)
async function getSessionToken() {
  try {
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      const idToken = await window.shopify.idToken();
      if (idToken) return idToken;
    }
  } catch (e) {
    console.warn('[BloatBuster] Could not retrieve App Bridge idToken:', e);
  }
  return null;
}

// Background Session Token Exchange (Shopify Managed Installation)
async function initTokenExchange() {
  try {
    const token = await getSessionToken();
    const shop = getCurrentShop();
    if (token && shop) {
      const res = await fetch('/api/auth/token-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, shop })
      });
      const data = await res.json();
      console.log('[BloatBuster App Bridge] Token exchange status:', data);
      return data;
    }
  } catch (e) {
    console.warn('[BloatBuster App Bridge] Token exchange error:', e);
  }
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize DOM, inputs, tabs, and all button click handlers immediately & synchronously
  try { initShopContext(); } catch (e) { console.error('[BloatBuster] initShopContext error:', e); }
  try { initTabs(); } catch (e) { console.error('[BloatBuster] initTabs error:', e); }
  try { initBilling(); } catch (e) { console.error('[BloatBuster] initBilling error:', e); }
  try { loadSignatures(); } catch (e) { console.error('[BloatBuster] loadSignatures error:', e); }
  try { setupScanForm(); } catch (e) { console.error('[BloatBuster] setupScanForm error:', e); }
  try { setupThemeAudit(); } catch (e) { console.error('[BloatBuster] setupThemeAudit error:', e); }
  try { setupLiquidInspector(); } catch (e) { console.error('[BloatBuster] setupLiquidInspector error:', e); }
  try { setupModals(); } catch (e) { console.error('[BloatBuster] setupModals error:', e); }
  try { setupBackupButton(); } catch (e) { console.error('[BloatBuster] setupBackupButton error:', e); }

  // 2. Perform background token exchange and dynamic theme detection (non-blocking)
  initTokenExchange()
    .catch(err => console.warn('[BloatBuster] Token exchange warning:', err))
    .finally(() => {
      initActiveTheme();
    });
});

// Helper to get current clean shop domain
function getCurrentShop() {
  const params = new URLSearchParams(window.location.search);
  let shop = params.get('shop');

  // Decode from App Bridge host param (e.g. atob("admin.shopify.com/store/xyz") -> "xyz.myshopify.com")
  if (!shop) {
    const host = params.get('host');
    if (host) {
      try {
        const decoded = atob(host);
        const match = decoded.match(/store\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          shop = `${match[1]}.myshopify.com`;
        }
      } catch (e) {}
    }
  }

  // Fallback to referrer pathname
  if (!shop && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      const match = ref.pathname.match(/\/store\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        shop = `${match[1]}.myshopify.com`;
      }
    } catch (e) {}
  }

  // Fallback to sessionStorage if previously detected
  if (!shop) {
    try {
      shop = sessionStorage.getItem('bloatbuster_shop');
    } catch (e) {}
  }

  // Fallback to storeUrlInput value if user typed it
  if (!shop) {
    const storeInput = document.getElementById('storeUrlInput');
    shop = storeInput?.value || '';
  }

  const clean = (shop || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (clean && clean.includes('.')) {
    try {
      sessionStorage.setItem('bloatbuster_shop', clean);
    } catch (e) {}
  }
  return clean;
}

// 1. Detect Shop Context and setup domain header
function initShopContext() {
  const shop = getCurrentShop();
  const storeInput = document.getElementById('storeUrlInput');
  const domainHeader = document.getElementById('storeDomainHeader');

  if (shop) {
    if (storeInput && (!storeInput.value || storeInput.value === 'https:///')) {
      storeInput.value = `https://${shop}/`;
    }
    if (domainHeader) {
      domainHeader.textContent = shop;
    }
  }

  if (storeInput && domainHeader) {
    storeInput.addEventListener('input', () => {
      const current = storeInput.value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
      if (current) {
        domainHeader.textContent = current;
      }
    });
  }
}

// 2. Fetch Active Published Theme Metadata from Shopify API
async function initActiveTheme() {
  const cleanShop = getCurrentShop();
  const themeDisplay = document.getElementById('activeThemeDisplay');
  if (!cleanShop || !themeDisplay) return;

  try {
    const sessionToken = await getSessionToken();
    const headers = {};
    if (sessionToken) {
      headers['Authorization'] = `Bearer ${sessionToken}`;
    }
    const res = await fetch(`/api/theme/live?shop=${encodeURIComponent(cleanShop)}`, { headers });
    const data = await res.json();
    if (data.success && data.theme) {
      currentShopTheme = data.theme;
      themeDisplay.textContent = `${data.theme.name} • Live`;
    } else {
      themeDisplay.textContent = 'Active Store Theme';
    }
  } catch (err) {
    console.warn('Could not fetch active theme:', err);
    themeDisplay.textContent = 'Active Store Theme';
  }
}

// 3. Navigation Tabs
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

// 4. Check and Initialize Billing Status
async function initBilling() {
  const params = new URLSearchParams(window.location.search);
  const isSubscribedFromUrl = params.get('plan') === 'pro' || params.get('subscribed') === 'true';
  const banner = document.getElementById('proActiveBanner');
  const openProBtn = document.getElementById('openProModal');
  const startTrialBtn = document.getElementById('btnStartTrial');
  const cleanShop = getCurrentShop();

  const billingError = params.get('billing_error');
  if (billingError) {
    showAlert({
      title: 'Shopify Billing Notice',
      message: billingError,
      type: 'warning',
      details: {
        'Resolution Guide': 'If this mentions "owned by a Shop", go to your Shopify Partner Dashboard -> Apps -> BloatBuster -> Distribution -> select "Public distribution".'
      },
      confirmText: 'Understood'
    });
  }

  function setProUiActive() {
    isProUser = true;
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

  if (isSubscribedFromUrl) {
    setProUiActive();
  }

  // Check live billing status from backend
  try {
    const res = await fetch(`/api/billing/status?shop=${cleanShop}`);
    const data = await res.json();
    if (data.isPro) {
      setProUiActive();
    }
  } catch (err) {
    console.warn('Could not verify billing status:', err);
  }

  // Handle Trial / Subscription Click in Pro Modal
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
          if (data.needsAuth) {
            window.open(data.confirmationUrl, '_blank');
            startTrialBtn.disabled = false;
            startTrialBtn.textContent = 'Approve App in Tab, Then Click Again';
            showAlert({
              title: 'App Authorization Required',
              message: 'A new window has opened to authorize BloatBuster on your test store.',
              type: 'info',
              details: {
                'Next Steps': '1. Click "Install app" in the opened tab.\n2. Return here and click "Start 7-Day Free Trial" to activate.'
              },
              confirmText: 'Ready'
            });
            return;
          }

          try {
            if (window.shopify && typeof window.shopify.open === 'function') {
              window.shopify.open(data.confirmationUrl, '_top');
            } else {
              window.open(data.confirmationUrl, '_top');
            }
          } catch (navErr) {
            window.location.href = data.confirmationUrl;
          }
        } else if (data.error) {
          startTrialBtn.disabled = false;
          startTrialBtn.textContent = 'Start 7-Day Free Trial';
          showAlert({
            title: 'Shopify Partner Billing Requirement',
            message: data.error,
            type: 'warning',
            details: {
              'Partner Configuration': 'To enable recurring subscriptions, ensure this app is configured with Public Distribution in your Shopify Partner Dashboard (partners.shopify.com).'
            },
            confirmText: 'Understood'
          });
        }
      } catch (err) {
        startTrialBtn.disabled = false;
        startTrialBtn.textContent = 'Start 7-Day Free Trial';
        showAlert({
          title: 'Subscription Initialization Failed',
          message: `Failed to initiate subscription: ${err.message}`,
          type: 'error',
          confirmText: 'Dismiss'
        });
      }
    });
  }
}

// 5. Setup Theme Safety Backup Button
function setupBackupButton() {
  const btn = document.getElementById('btnCreateBackup');
  const badge = document.getElementById('backupStatusBadge');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const cleanShop = getCurrentShop();

    if (!isProUser) {
      const proModal = document.getElementById('proModal');
      if (proModal) proModal.style.display = 'flex';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="polaris-spinner" style="width: 12px; height: 12px; margin-right: 6px; display: inline-block; vertical-align: middle;"></span> Creating...`;

    try {
      const sessionToken = await getSessionToken();
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const res = await fetch('/api/theme/duplicate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ shop: cleanShop, sessionToken })
      });
      const data = await res.json();

      if (data.success && data.backupTheme) {
        if (badge) {
          badge.textContent = `Backup: ${data.backupTheme.name.slice(0, 26)}...`;
          badge.className = 'badge badge-success';
        }
        showAlert({
          title: 'Theme Safety Backup Created',
          message: 'A complete duplicate of your live theme has been secured in your Shopify Admin before any modifications take place.',
          type: 'success',
          details: {
            'Backup Theme': data.backupTheme.name,
            'Theme ID': String(data.backupTheme.id),
            'Restore Path': 'Shopify Admin -> Online Store -> Themes'
          },
          confirmText: 'Awesome!'
        });
      } else {
        throw new Error(data.error || 'Failed to create backup.');
      }
    } catch (err) {
      showAlert({
        title: 'Theme Backup Error',
        message: err.message || 'Failed to create theme backup.',
        type: 'error',
        confirmText: 'Dismiss'
      });
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3.75 3A1.75 1.75 0 0 0 2 4.75v10.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-8.5A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM10 8a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 10 8Z" clip-rule="evenodd"/>
        </svg>
        Theme Backup
      `;
    }
  });
}

// 6. 1-Click Native Theme Code & Snippet Audit
function setupThemeAudit() {
  const runBtn = document.getElementById('btnRunThemeAudit');
  const spinner = document.getElementById('themeAuditSpinner');
  const statusMsg = document.getElementById('themeAuditStatusMsg');
  const resultsCard = document.getElementById('themeAuditResultsCard');

  if (!runBtn) return;

  runBtn.addEventListener('click', async () => {
    const cleanShop = getCurrentShop();
    if (!cleanShop) {
      showAlert({
        title: 'Shopify Admin Context Required',
        message: 'Please open BloatBuster from within your Shopify Admin to inspect theme assets.',
        type: 'warning',
        confirmText: 'Got It'
      });
      return;
    }

    runBtn.disabled = true;
    resultsCard.style.display = 'none';
    spinner.style.display = 'block';

    statusMsg.textContent = 'Connecting to Shopify Theme API...';
    setTimeout(() => { statusMsg.textContent = 'Fetching layout/theme.liquid & config/settings_data.json...'; }, 600);
    setTimeout(() => { statusMsg.textContent = 'Cross-referencing 52 app signatures against theme files...'; }, 1200);

    try {
      const sessionToken = await getSessionToken();
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const res = await fetch('/api/theme/scan-assets', {
        method: 'POST',
        headers,
        body: JSON.stringify({ shop: cleanShop, sessionToken })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Theme audit error HTTP ${res.status}`);
      }

      currentThemeAuditData = data;
      renderThemeAuditReport(data);
    } catch (err) {
      showAlert({
        title: 'Theme Asset Audit Error',
        message: err.message || 'Failed to complete theme scan.',
        type: 'error',
        confirmText: 'Dismiss'
      });
    } finally {
      spinner.style.display = 'none';
      runBtn.disabled = false;
    }
  });
}

// Render Theme Audit Findings
function renderThemeAuditReport(data) {
  const resultsCard = document.getElementById('themeAuditResultsCard');
  resultsCard.style.display = 'block';

  const audit = data.audit || {};
  const orphanLiquid = audit.orphanLiquidFindings || [];
  const orphanSnippets = audit.orphanSnippetFiles || [];
  const activeApps = audit.activeAppIds || [];

  // Update Mini KPIs
  document.getElementById('kpiThemeOrphanTags').textContent = `${orphanLiquid.length} Tags`;
  document.getElementById('kpiThemeSnippets').textContent = `${orphanSnippets.length} Files`;
  document.getElementById('kpiThemeActiveEmbeds').textContent = `${activeApps.length} Embeds`;

  document.getElementById('themeLiquidCountBadge').textContent = `${orphanLiquid.length} Findings`;
  document.getElementById('themeSnippetCountBadge').textContent = `${orphanSnippets.length} Snippets`;
  document.getElementById('themeActiveCountBadge').textContent = `${activeApps.length} Active`;

  // Section 1: Orphan Liquid Findings
  const liquidContainer = document.getElementById('themeLiquidFindingsContainer');
  if (orphanLiquid.length === 0) {
    liquidContainer.innerHTML = `
      <div style="padding: 18px; text-align: center; color: var(--p-color-primary); font-weight: 500;">
        Zero dead render or include tags detected in layout/theme.liquid. Your main layout template is lean!
      </div>
    `;
  } else {
    liquidContainer.innerHTML = orphanLiquid.map(finding => `
      <div class="table-row" id="row-${finding.appId}-${finding.line}">
        <div class="row-primary">
          <div class="app-avatar">
            ${getCategorySvg(finding.speedPenalty === 'High' ? 'Reviews' : 'Email')}
          </div>
          <div class="app-details">
            <div class="app-title-bar">
              <span class="app-name">Line ${finding.line}: ${escapeHtml(finding.appName)}</span>
              <span class="badge badge-${finding.speedPenalty === 'High' ? 'critical' : 'warning'}">${finding.speedPenalty} Impact</span>
              <span class="badge badge-critical">Orphaned Code</span>
            </div>
            <div class="code-evidence">
              <code>${escapeHtml(finding.codeSnippet)}</code>
            </div>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="showThemeExcisionGuide('${escapeHtml(finding.appName)}', '${finding.line}', '${escapeHtml(finding.codeSnippet)}')">
            Excision Guide
          </button>
          <button class="btn-primary" style="font-size: 12px; padding: 6px 12px;" onclick="executeSafeDeactivate('${escapeHtml(finding.appName)}', '${escapeHtml(finding.codeSnippet)}', this)">
            Safely Deactivate
          </button>
        </div>
      </div>
    `).join('');
  }

  // Section 2: Orphan Snippet Files
  const snippetContainer = document.getElementById('themeSnippetFilesContainer');
  if (orphanSnippets.length === 0) {
    snippetContainer.innerHTML = `
      <div style="padding: 18px; text-align: center; color: var(--p-color-primary); font-weight: 500;">
        No uninstalled app snippet files identified in snippets/.
      </div>
    `;
  } else {
    snippetContainer.innerHTML = orphanSnippets.map(snippet => `
      <div class="table-row">
        <div class="row-primary">
          <div class="app-avatar">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4Zm1.5 4a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 5.5 6Zm0 3.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div class="app-details">
            <div class="app-title-bar">
              <span class="app-name">${escapeHtml(snippet.filePath)}</span>
              <span class="badge badge-warning">Unused File</span>
            </div>
            <div style="font-size: 12px; color: var(--p-color-text-secondary); margin-top: 2px;">
              App: <strong>${escapeHtml(snippet.appName)}</strong> &bull; ${escapeHtml(snippet.cleanupAdvice)}
            </div>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="openThemeEditorForFile('${snippet.filePath}')">
            Delete in Editor
          </button>
        </div>
      </div>
    `).join('');
  }

  // Section 3: Verified Active App Embeds
  const activeContainer = document.getElementById('themeActiveEmbedsContainer');
  if (activeApps.length === 0) {
    activeContainer.innerHTML = `
      <div style="padding: 14px; font-size: 12.5px; color: var(--p-color-text-secondary);">
        No third-party App Embeds currently toggled ON in your Theme Customizer.
      </div>
    `;
  } else {
    activeContainer.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px;">
        ${activeApps.map(id => {
          const appMeta = allSignatures.find(a => a.id === id);
          return `
            <span class="badge badge-success" style="font-size: 12px; padding: 4px 10px;">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="margin-right: 4px;"><circle cx="4" cy="4" r="3"/></svg>
              ${escapeHtml(appMeta?.name || id)} (Active Embed)
            </span>
          `;
        }).join('')}
      </div>
    `;
  }

  resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 1-Click Safe Comment Deactivation for Pro Users
window.executeSafeDeactivate = async function(appName, codeSnippet, btnElement) {
  const cleanShop = getCurrentShop();

  if (!isProUser) {
    const proModal = document.getElementById('proModal');
    if (proModal) proModal.style.display = 'flex';
    return;
  }

  const confirmed = await showConfirm({
    title: `Deactivate ${appName} Reference?`,
    message: `Safely wrap this dead code reference in a comment tag so it no longer executes on your live storefront?`,
    type: 'warning',
    details: {
      'Target Snippet': codeSnippet,
      'Theme File': 'layout/theme.liquid',
      'Safety Guarantee': 'A timestamped safety backup of your theme will be created automatically before modifying the file.'
    },
    confirmText: 'Safely Deactivate',
    cancelText: 'Keep Snippet',
    isDestructive: true
  });
  if (!confirmed) return;

  btnElement.disabled = true;
  btnElement.innerHTML = `<span class="polaris-spinner" style="width: 12px; height: 12px; margin-right: 6px; display: inline-block; vertical-align: middle;"></span> Deactivating...`;

  try {
    const sessionToken = await getSessionToken();
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

    const res = await fetch('/api/theme/clean-snippet', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        shop: cleanShop,
        sessionToken,
        targetLine: codeSnippet,
        appName
      })
    });
    const data = await res.json();

    if (data.success) {
      btnElement.textContent = 'Deactivated ✓';
      btnElement.className = 'btn-secondary';
      btnElement.style.color = '#008060';
      btnElement.style.fontWeight = '600';
      showAlert({
        title: 'Reference Safely Deactivated',
        message: data.message || 'The dead code reference was safely deactivated.',
        type: 'success',
        details: {
          'Protection Applied': 'Wrapped in BloatBuster comment tags so browser execution is eliminated without breaking theme layout.',
          'Reversible': 'You can undo this at any time or restore from your automated theme backup.'
        },
        confirmText: 'Great!'
      });
    } else {
      throw new Error(data.error || 'Failed to deactivate snippet.');
    }
  } catch (err) {
    btnElement.disabled = false;
    btnElement.textContent = 'Safely Deactivate';
    showAlert({
      title: 'Deactivation Error',
      message: err.message,
      type: 'error',
      confirmText: 'Dismiss'
    });
  }
};

window.showThemeExcisionGuide = function(appName, line, codeSnippet) {
  const modal = document.getElementById('excisionModal');
  document.getElementById('modalAppTitle').textContent = `Excision Guide • ${appName}`;
  document.getElementById('modalOriginalCode').textContent = codeSnippet;
  document.getElementById('modalReplacementCode').textContent = 
    `{%- comment -%} [BloatBuster Safe Clean] Removed ${appName}: ${codeSnippet} {%- endcomment -%}`;

  const stepsList = document.getElementById('modalStepsList');
  stepsList.innerHTML = `
    <li>Open your Shopify Admin &rarr; <strong>Online Store</strong> &rarr; <strong>Themes</strong>.</li>
    <li>Click <strong>&hellip; (Actions)</strong> next to your active theme &rarr; <strong>Edit Code</strong>.</li>
    <li>Open <code>layout/theme.liquid</code> and scroll to Line ${line || 'search for ' + codeSnippet}.</li>
    <li>Delete the line or replace it with the safe comment above.</li>
    <li>Click <strong>Save</strong> in the upper right corner.</li>
  `;

  modal.style.display = 'flex';
};

window.openThemeEditorForFile = function(filePath) {
  const shop = getCurrentShop();
  const storeHandle = shop.replace('.myshopify.com', '').replace(/^https?:\/\//, '').split('/')[0];
  const editorUrl = `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?key=${encodeURIComponent(filePath)}`;
  
  try {
    if (window.shopify && typeof window.shopify.open === 'function') {
      window.shopify.open(editorUrl, '_top');
    } else {
      window.open(editorUrl, '_blank', 'noopener,noreferrer');
    }
  } catch (err) {
    window.open(editorUrl, '_blank', 'noopener,noreferrer');
  }
};

// Toggle Manual Liquid AST Inspector
window.toggleManualLiquidInspector = function() {
  const body = document.getElementById('manualLiquidBody');
  const arrow = document.getElementById('manualInspectorArrow');
  if (!body) return;

  if (body.style.display === 'none') {
    body.style.display = 'block';
    if (arrow) arrow.innerHTML = '&#9650;';
  } else {
    body.style.display = 'none';
    if (arrow) arrow.innerHTML = '&#9660;';
  }
};

// 7. Load App Signatures (52 Apps)
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

// 8. Setup Storefront Scan Form
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
      const url = input.value.trim() || getCurrentShop();
      if (url) {
        input.value = url;
        executeScan(url);
      }
    });
  }
}

// 9. Execute Storefront Scan
async function executeScan(storeUrl) {
  const scanningState = document.getElementById('scanningState');
  const reportView = document.getElementById('reportView');
  const submitBtn = document.getElementById('scanSubmitBtn');
  const statusMsg = document.getElementById('scanStatusMsg');

  reportView.style.display = 'none';
  scanningState.style.display = 'block';
  submitBtn.disabled = true;

  const cleanDomain = storeUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  const domainHeader = document.getElementById('storeDomainHeader');
  if (domainHeader && cleanDomain) {
    domainHeader.textContent = cleanDomain;
  }

  statusMsg.textContent = `Establishing connection to ${storeUrl}...`;
  setTimeout(() => { statusMsg.textContent = 'Extracting storefront scripts & preconnect tags...'; }, 500);
  setTimeout(() => { statusMsg.textContent = 'Comparing DOM against 52 verified app signatures...'; }, 1100);

  try {
    const sessionToken = await getSessionToken();
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

    const res = await fetch('/api/scan', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        storeUrl,
        shop: cleanDomain || getCurrentShop(),
        sessionToken,
        activeApps: Array.from(activeAppOverrides)
      })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Scan error HTTP ${res.status}`);
    }
    const result = await res.json();
    currentScanData = result;
    activeAppOverrides.clear();
    renderReport(result);
  } catch (err) {
    showAlert({
      title: 'Storefront Scan Error',
      message: err.message || 'Could not complete storefront scan.',
      type: 'error',
      confirmText: 'Dismiss'
    });
  } finally {
    scanningState.style.display = 'none';
    submitBtn.disabled = false;
  }
}

// 10. Render Storefront Report with Polaris Elements
function renderReport(data) {
  const reportView = document.getElementById('reportView');
  reportView.style.display = 'block';

  const autoActiveAppIds = new Set(data.autoActiveAppIds || []);

  const suspectedOrphans = data.detectedApps.filter(app => {
    if (activeAppOverrides.has(app.appId)) return false; // marked active by user
    if (autoActiveAppIds.has(app.appId)) return false;   // verified active via theme embeds
    return true;
  });

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

  const circumference = 251.2;
  const offset = circumference - (score / 100) * circumference;
  dialCircle.style.strokeDashoffset = offset;

  if (score < 60) {
    dialCircle.style.stroke = 'var(--p-color-critical)';
    scoreGrade.textContent = 'Grade F • High Risk';
    scoreGrade.style.color = 'var(--p-color-critical)';
    headlineText.textContent = 'Critical Theme Bloat';
  } else if (score < 80) {
    dialCircle.style.stroke = 'var(--p-color-warning)';
    scoreGrade.textContent = 'Grade C • Action Advised';
    scoreGrade.style.color = 'var(--p-color-warning)';
    headlineText.textContent = 'Moderate Theme Bloat';
  } else {
    dialCircle.style.stroke = 'var(--p-color-primary)';
    scoreGrade.textContent = 'Grade A • Optimized';
    scoreGrade.style.color = 'var(--p-color-primary)';
    headlineText.textContent = 'Clean Storefront Health';
  }

  // Update Metric KPIs
  document.getElementById('kpiOrphans').textContent = `${suspectedOrphans.length} Scripts`;
  document.getElementById('kpiWastedKB').textContent = `${totalWastedKB} KB`;
  document.getElementById('kpiDelay').textContent = `+${totalDelaySeconds}s`;
  document.getElementById('findingsBadge').textContent = `${data.detectedApps.length} Detected`;

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
    const isAutoActive = autoActiveAppIds.has(app.appId);
    const isUserActive = activeAppOverrides.has(app.appId);
    const isOrphan = !isAutoActive && !isUserActive;
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
                ${isOrphan ? 'Suspected Leftover' : (isAutoActive ? 'Verified Active Embed' : 'Active App')}
              </span>
            </div>
            <div class="code-evidence" title="${escapeHtml(evidence)}">
              ${escapeHtml(evidence)}
            </div>
          </div>
        </div>

        <div class="row-actions">
          <button class="btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="toggleAppStatus('${app.appId}')">
            ${isOrphan ? 'Still In Use' : 'Mark Inactive'}
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

// Interactive Toggle between Active vs Leftover
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

// Safe Excision Modal for Storefront Scripts
window.showExcisionModal = function(appId) {
  const app = currentScanData?.detectedApps?.find(a => a.appId === appId);
  if (!app) return;

  const modal = document.getElementById('excisionModal');
  document.getElementById('modalAppTitle').textContent = `Removal Protocol • ${app.name}`;

  const evidence = app.matchReasons?.[0]?.evidence || `<script src="...${appId}..."></script>`;
  document.getElementById('modalOriginalCode').textContent = evidence;
  document.getElementById('modalReplacementCode').textContent = 
    `{%- comment -%} [BloatBuster Safe Excision] Removed ${app.name}: ${evidence} {%- endcomment -%}`;

  const stepsList = document.getElementById('modalStepsList');
  stepsList.innerHTML = `
    <li>Open your Shopify Admin &rarr; <strong>Online Store</strong> &rarr; <strong>Themes</strong>.</li>
    <li>Click <strong>&hellip; (Actions)</strong> next to your active theme &rarr; <strong>Edit Code</strong>.</li>
    <li>Check <code>layout/theme.liquid</code> or snippets matching <code>${app.snippetPatterns?.[0] || appId}</code>.</li>
    <li>Delete the script tag or wrap with the safe comment above.</li>
    <li>Click <strong>Save</strong> in the upper-right corner.</li>
  `;

  modal.style.display = 'flex';
};

// 11. Manual Theme.liquid Code Inspector (Fallback)
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
      showToast('Please paste liquid code from your theme file to analyze.', 'warning');
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
              <button class="btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="showAdviceModal('${escapeHtml(f.appName)}', '${f.line}', '${escapeHtml(f.cleanupAdvice)}')">
                Advice
              </button>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      showAlert({
        title: 'Liquid Inspector Error',
        message: err.message,
        type: 'error',
        confirmText: 'Dismiss'
      });
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Analyze Raw Liquid Block';
    }
  });
}

// --- Production-Grade Polaris Feedback Modals & Toasts ---

const MODAL_ICONS = {
  success: `<svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/>
  </svg>`,
  error: `<svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clip-rule="evenodd"/>
  </svg>`,
  critical: `<svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clip-rule="evenodd"/>
  </svg>`,
  warning: `<svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/>
  </svg>`,
  info: `<svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .247.25v3.5a.25.25 0 0 1-.247.25H9a.75.75 0 0 0 0 1.5h2a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.247-.25v-4.25A.75.75 0 0 0 9.75 9H9Z" clip-rule="evenodd"/>
  </svg>`
};

let activeFeedbackResolve = null;

function closeFeedbackModal(val) {
  const modal = document.getElementById('polarisFeedbackModal');
  if (modal) modal.style.display = 'none';
  if (typeof activeFeedbackResolve === 'function') {
    activeFeedbackResolve(val);
    activeFeedbackResolve = null;
  }
}

/**
 * Copies text to clipboard and briefly indicates copied status
 */
window.copyFeedbackText = function(text, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied ✓';
      btn.style.borderColor = '#008060';
      btn.style.color = '#008060';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 1800);
    }).catch(() => {});
  }
};

/**
 * Render structured key-value rows or HTML inside feedback modal
 */
function renderFeedbackDetails(details) {
  const container = document.getElementById('feedbackModalDetails');
  if (!container) return;

  if (!details) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'block';

  if (typeof details === 'string') {
    container.innerHTML = `<div class="feedback-details-box">${details}</div>`;
    return;
  }

  if (typeof details === 'object') {
    const rows = Object.entries(details).map(([key, val]) => {
      const isCopyable = typeof val === 'string' && (val.startsWith('backup-') || key.toLowerCase().includes('id'));
      const valHtml = isCopyable
        ? `<span>${escapeHtml(val)}</span> <button type="button" class="copy-chip-btn" onclick="copyFeedbackText('${escapeHtml(val)}', this)">Copy</button>`
        : `<span>${escapeHtml(String(val))}</span>`;

      return `
        <div class="feedback-detail-row">
          <span class="feedback-detail-label">${escapeHtml(key)}:</span>
          <div class="feedback-detail-value">${valHtml}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="feedback-details-box">${rows}</div>`;
  }
}

window.showAlert = function({
  title = 'Notice',
  message = '',
  type = 'info',
  details = null,
  confirmText = 'Got it',
  confirmVariant = 'primary'
}) {
  return new Promise((resolve) => {
    activeFeedbackResolve = resolve;

    const modal = document.getElementById('polarisFeedbackModal');
    const iconEl = document.getElementById('feedbackModalIcon');
    const titleEl = document.getElementById('feedbackModalTitle');
    const msgEl = document.getElementById('feedbackModalMessage');
    const cancelBtn = document.getElementById('feedbackModalCancelBtn');
    const confirmBtn = document.getElementById('feedbackModalConfirmBtn');

    if (!modal) return resolve();

    const safeType = MODAL_ICONS[type] ? type : 'info';
    iconEl.className = `feedback-icon-badge type-${safeType}`;
    iconEl.innerHTML = MODAL_ICONS[safeType];

    titleEl.textContent = title;
    msgEl.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
    renderFeedbackDetails(details);

    cancelBtn.style.display = 'none';
    confirmBtn.className = confirmVariant === 'critical' ? 'btn-critical' : 'btn-primary';
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = () => closeFeedbackModal(true);

    modal.style.display = 'flex';
  });
};

window.showConfirm = function({
  title = 'Please Confirm',
  message = '',
  type = 'warning',
  details = null,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false
}) {
  return new Promise((resolve) => {
    activeFeedbackResolve = resolve;

    const modal = document.getElementById('polarisFeedbackModal');
    const iconEl = document.getElementById('feedbackModalIcon');
    const titleEl = document.getElementById('feedbackModalTitle');
    const msgEl = document.getElementById('feedbackModalMessage');
    const cancelBtn = document.getElementById('feedbackModalCancelBtn');
    const confirmBtn = document.getElementById('feedbackModalConfirmBtn');

    if (!modal) return resolve(false);

    const safeType = MODAL_ICONS[type] ? type : 'warning';
    iconEl.className = `feedback-icon-badge type-${safeType}`;
    iconEl.innerHTML = MODAL_ICONS[safeType];

    titleEl.textContent = title;
    msgEl.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
    renderFeedbackDetails(details);

    cancelBtn.style.display = 'inline-flex';
    cancelBtn.textContent = cancelText;
    cancelBtn.onclick = () => closeFeedbackModal(false);

    confirmBtn.className = isDestructive ? 'btn-critical' : 'btn-primary';
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = () => closeFeedbackModal(true);

    modal.style.display = 'flex';
  });
};

window.showToast = function(message, type = 'success', duration = 3500) {
  const container = document.getElementById('polarisToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'polaris-toast';

  const iconSvg = type === 'success' 
    ? `<svg width="14" height="14" viewBox="0 0 20 20" fill="#20BF6B"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/></svg>`
    : type === 'warning'
    ? `<svg width="14" height="14" viewBox="0 0 20 20" fill="#FFC93E"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 20 20" fill="#FF6B6B"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clip-rule="evenodd"/></svg>`;

  toast.innerHTML = `
    <span class="toast-icon">${iconSvg}</span>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hiding');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, duration);
};

window.showAdviceModal = function(appName, line, advice) {
  showAlert({
    title: `Cleanup Protocol • ${appName}`,
    message: `Remediation steps for Line ${line}:`,
    type: 'info',
    details: {
      'App Name': appName,
      'Theme File': `Line ${line}`,
      'Recommendation': advice
    },
    confirmText: 'Got It'
  });
};

// 12. Modals setup
function setupModals() {
  const excisionModal = document.getElementById('excisionModal');
  const closeExcisionModal = document.getElementById('closeExcisionModal');
  if (closeExcisionModal) {
    closeExcisionModal.addEventListener('click', () => excisionModal.style.display = 'none');
  }

  const modalEditorBtn = document.getElementById('modalEditorBtn');
  if (modalEditorBtn) {
    modalEditorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openThemeEditorForFile('layout/theme.liquid');
    });
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

  // Feedback Modal Controls
  const feedbackModal = document.getElementById('polarisFeedbackModal');
  const closeFeedbackModalBtn = document.getElementById('feedbackModalClose');
  if (closeFeedbackModalBtn) {
    closeFeedbackModalBtn.addEventListener('click', () => closeFeedbackModal(false));
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (feedbackModal && feedbackModal.style.display === 'flex') {
        closeFeedbackModal(false);
      }
      if (excisionModal && excisionModal.style.display === 'flex') {
        excisionModal.style.display = 'none';
      }
      if (proModal && proModal.style.display === 'flex') {
        proModal.style.display = 'none';
      }
    }
  });

  window.addEventListener('click', (e) => {
    if (e.target === excisionModal) excisionModal.style.display = 'none';
    if (e.target === proModal) proModal.style.display = 'none';
    if (e.target === feedbackModal) closeFeedbackModal(false);
  });
}

// Crisp Vector SVGs for App Categories
function getCategorySvg(category) {
  if (!category) return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="8"/></svg>`;
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
  if (category.includes('Loyalty') || category.includes('Rewards')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8.707 13.707a1 1 0 0 1-1.414 0l-3-3a1 1 0 0 1 1.414-1.414L8 11.586l6.293-6.293a1 1 0 0 1 1.414 1.414l-7 7Z" clip-rule="evenodd"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.5 2A2.5 2.5 0 0 0 2 4.5v11A2.5 2.5 0 0 0 4.5 18h11a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 15.5 2h-11ZM6.75 6.25a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3.5a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clip-rule="evenodd"/></svg>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}
