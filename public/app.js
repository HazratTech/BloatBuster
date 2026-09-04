/**
 * BloatBuster - Frontend Application Logic
 */

let allSignatures = [];
let currentScanData = null;
let activeAppOverrides = new Set(); // tracks which apps user marked as active

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadSignatures();
  setupScanForm();
  setupDemoChips();
  setupLiquidInspector();
  setupModals();
});

// 1. Navigation Tabs
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetTab = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      const activeContent = document.getElementById(`tab-${targetTab}`);
      if (activeContent) activeContent.style.display = 'block';
    });
  });
}

// 2. Load App Signatures
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
    container.innerHTML = `<div style="color: var(--text-dim); grid-column: 1/-1;">No matching apps found.</div>`;
    return;
  }

  container.innerHTML = apps.map(app => `
    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
        <div style="font-weight: 700; font-size: 14px;">${escapeHtml(app.name)}</div>
        <span class="tag-severity severity-${app.speedPenalty.toLowerCase()}">${app.speedPenalty}</span>
      </div>
      <div style="font-size: 11px; color: var(--shopify-green); margin-bottom: 8px;">${escapeHtml(app.category)}</div>
      <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4; margin-bottom: 12px;">${escapeHtml(app.description)}</div>
      <div style="font-size: 11px; color: var(--text-dim); font-family: monospace;">
        Avg. Size: ~${app.avgSizeKB}KB | Delay: +${app.avgDelayMs}ms
      </div>
    </div>
  `).join('');
}

// 3. Setup Scan Form
function setupScanForm() {
  const form = document.getElementById('scanForm');
  const input = document.getElementById('storeUrlInput');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    executeScan(url);
  });
}

function setupDemoChips() {
  const chips = document.querySelectorAll('.chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.url;
      const input = document.getElementById('storeUrlInput');
      input.value = url;
      executeScan(url);
    });
  });
}

// 4. Execute Storefront Scan
async function executeScan(storeUrl) {
  const scanningState = document.getElementById('scanningState');
  const reportView = document.getElementById('reportView');
  const submitBtn = document.getElementById('scanSubmitBtn');
  const statusMsg = document.getElementById('scanStatusMsg');

  reportView.style.display = 'none';
  scanningState.style.display = 'block';
  submitBtn.disabled = true;
  submitBtn.style.opacity = '0.6';

  statusMsg.textContent = `Connecting to ${storeUrl}...`;

  // Simulated step messages for high user feedback
  setTimeout(() => { statusMsg.textContent = 'Fetching storefront HTML & scripts...'; }, 600);
  setTimeout(() => { statusMsg.textContent = 'Scanning for 52 known app signatures...'; }, 1200);

  try {
    // Handle mock demo store locally if requested
    let result;
    if (storeUrl === 'demo-bloated-store') {
      result = getMockDemoScanResult();
      await new Promise(r => setTimeout(r, 1400));
    } else {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeUrl, activeApps: Array.from(activeAppOverrides) })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed with status ${res.status}`);
      }
      result = await res.json();
    }

    currentScanData = result;
    activeAppOverrides.clear();
    renderReport(result);
  } catch (err) {
    alert(`Scan error: ${err.message}`);
  } finally {
    scanningState.style.display = 'none';
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
  }
}

// 5. Render Scan Report
function renderReport(data) {
  const reportView = document.getElementById('reportView');
  reportView.style.display = 'block';

  // Recalculate metrics based on current active/orphan overrides
  const suspectedOrphans = data.detectedApps.filter(app => !activeAppOverrides.has(app.appId));
  const activeApps = data.detectedApps.filter(app => activeAppOverrides.has(app.appId));

  // Dynamic KPI updates
  const totalWastedKB = suspectedOrphans.reduce((sum, a) => sum + (a.avgSizeKB || 140), 0);
  const totalDelaySeconds = (suspectedOrphans.reduce((sum, a) => sum + (a.avgDelayMs || 250), 0) / 1000).toFixed(2);
  
  // Calculate dynamic score
  let score = 100 - (suspectedOrphans.length * 12);
  score = Math.max(20, Math.min(100, score));

  // Update gauge
  const gaugeCircle = document.getElementById('gaugeCircle');
  const scoreNum = document.getElementById('scoreNum');
  const scoreGrade = document.getElementById('scoreGrade');
  const headlineText = document.getElementById('headlineText');
  const storeDomainDisplay = document.getElementById('storeDomainDisplay');

  scoreNum.textContent = score;
  storeDomainDisplay.textContent = data.storeUrl;

  if (score < 60) {
    scoreGrade.textContent = 'Grade F';
    gaugeCircle.style.borderColor = 'var(--alert-red)';
    gaugeCircle.style.boxShadow = '0 0 24px var(--alert-red-dim)';
    headlineText.textContent = 'Critical Theme Bloat';
    headlineText.style.color = 'var(--alert-red)';
  } else if (score < 80) {
    scoreGrade.textContent = 'Grade C';
    gaugeCircle.style.borderColor = 'var(--warning-amber)';
    gaugeCircle.style.boxShadow = '0 0 24px var(--warning-amber-dim)';
    headlineText.textContent = 'Moderate Theme Debt';
    headlineText.style.color = 'var(--warning-amber)';
  } else {
    scoreGrade.textContent = 'Grade A';
    gaugeCircle.style.borderColor = 'var(--shopify-green)';
    gaugeCircle.style.boxShadow = '0 0 24px var(--shopify-green-dim)';
    headlineText.textContent = 'Theme is Lean';
    headlineText.style.color = 'var(--shopify-green)';
  }

  // Update KPI cards
  document.getElementById('kpiOrphans').textContent = `${suspectedOrphans.length} Apps`;
  document.getElementById('kpiWastedKB').textContent = `${totalWastedKB} KB`;
  document.getElementById('kpiDelay').textContent = `+${totalDelaySeconds}s`;
  document.getElementById('findingsBadge').textContent = `${suspectedOrphans.length} Uninstalled Scripts`;

  // Render Findings List
  const container = document.getElementById('findingsContainer');
  if (!data.detectedApps || data.detectedApps.length === 0) {
    container.innerHTML = `
      <div style="padding: 32px; text-align: center; color: var(--shopify-green);">
        🎉 <strong>No third-party app scripts detected!</strong> Your storefront code is exceptionally clean.
      </div>
    `;
    return;
  }

  container.innerHTML = data.detectedApps.map(app => {
    const isOrphan = !activeAppOverrides.has(app.appId);
    const evidence = app.matchReasons?.[0]?.evidence || 'External script call found in page DOM';

    return `
      <div class="finding-item" id="finding-${app.appId}">
        <div class="finding-left">
          <div class="finding-icon">${getCategoryIcon(app.category)}</div>
          <div class="finding-info">
            <div class="finding-name">
              ${escapeHtml(app.name)}
              <span class="tag-severity severity-${app.speedPenalty.toLowerCase()}">${app.speedPenalty} Impact</span>
              <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; ${isOrphan ? 'background: var(--alert-red-dim); color: var(--alert-red);' : 'background: var(--shopify-green-dim); color: var(--shopify-green);'}">
                ${isOrphan ? 'Leftover Orphan' : 'Active App'}
              </span>
            </div>
            <div class="finding-evidence" title="${escapeHtml(evidence)}">
              Detected: ${escapeHtml(evidence)}
            </div>
          </div>
        </div>

        <div class="finding-actions">
          <button class="btn-toggle ${!isOrphan ? 'active' : ''}" onclick="toggleAppStatus('${app.appId}')">
            ${!isOrphan ? '✓ Still In Use' : 'Mark as Active'}
          </button>
          <button class="btn-clean-guide" onclick="showExcisionModal('${app.appId}')">
            Clean Guide
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Render Unknown Scripts if any
  const unknownSection = document.getElementById('unknownSection');
  const unknownContainer = document.getElementById('unknownContainer');
  const unknownCountBadge = document.getElementById('unknownCountBadge');

  if (data.unknownExternalScripts && data.unknownExternalScripts.length > 0) {
    unknownSection.style.display = 'block';
    unknownCountBadge.textContent = `${data.unknownExternalScripts.length} Scripts`;
    unknownContainer.innerHTML = data.unknownExternalScripts.map(s => `
      <div style="font-family: monospace; font-size: 11px; color: var(--text-muted); background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 4px; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(s.url)}
      </div>
    `).join('');
  } else {
    unknownSection.style.display = 'none';
  }

  // Smooth scroll to results
  reportView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 6. Interactive App Status Toggle
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

// 7. Show Safe Excision Modal
window.showExcisionModal = function(appId) {
  const app = currentScanData?.detectedApps?.find(a => a.appId === appId);
  if (!app) return;

  const modal = document.getElementById('excisionModal');
  document.getElementById('modalAppTitle').textContent = `Safe Removal Guide: ${app.name}`;
  
  const evidence = app.matchReasons?.[0]?.evidence || `<script src="...${appId}..."></script>`;
  document.getElementById('modalOriginalCode').textContent = evidence;
  document.getElementById('modalReplacementCode').textContent = 
    `{%- comment -%} [BloatBuster Safe Clean] Removed ${app.name}: ${evidence} {%- endcomment -%}`;

  const stepsList = document.getElementById('modalStepsList');
  stepsList.innerHTML = `
    <li>Open your Shopify Admin &rarr; <strong>Online Store</strong> &rarr; <strong>Themes</strong>.</li>
    <li>Click the <strong>&hellip; (Three Dots)</strong> menu next to your active theme &rarr; <strong>Edit Code</strong>.</li>
    <li>Search for <code>layout/theme.liquid</code> or snippets matching <code>${app.snippetPatterns?.[0] || appId}</code>.</li>
    <li>Delete the script tag or replace with the safe comment above.</li>
    <li>Click <strong>Save</strong>.</li>
  `;

  const cleanShop = (currentScanData?.storeUrl || 'store.myshopify.com').replace('.myshopify.com', '').replace(/^https?:\/\//, '');
  const editorUrl = `https://admin.shopify.com/store/${cleanShop}/themes/current/editor?key=layout/theme.liquid`;
  document.getElementById('modalEditorLink').href = editorUrl;

  modal.style.display = 'flex';
};

// 8. Liquid Code Inspector
function setupLiquidInspector() {
  const scanBtn = document.getElementById('scanLiquidBtn');
  const input = document.getElementById('liquidCodeInput');
  const resultsCard = document.getElementById('liquidResultsCard');
  const badge = document.getElementById('liquidFindingsBadge');
  const container = document.getElementById('liquidFindingsContainer');

  scanBtn.addEventListener('click', async () => {
    const liquidCode = input.value.trim();
    if (!liquidCode) {
      alert('Please paste liquid code first.');
      return;
    }

    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';

    try {
      const res = await fetch('/api/scan-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liquidCode })
      });
      const data = await res.json();

      resultsCard.style.display = 'block';
      badge.textContent = `${data.findingsCount} Findings`;

      if (data.findingsCount === 0) {
        container.innerHTML = `<div style="padding: 24px; color: var(--shopify-green); text-align: center;">✓ No dead app tags found in this code snippet!</div>`;
      } else {
        container.innerHTML = data.findings.map(f => `
          <div class="finding-item">
            <div class="finding-left">
              <div class="finding-icon">📄</div>
              <div class="finding-info">
                <div class="finding-name">
                  Line ${f.line}: ${escapeHtml(f.appName)}
                  <span class="tag-severity severity-${f.speedPenalty.toLowerCase()}">${f.speedPenalty}</span>
                </div>
                <div class="finding-evidence">
                  Code: <code>${escapeHtml(f.codeSnippet)}</code>
                </div>
              </div>
            </div>
            <div class="finding-actions">
              <button class="btn-clean-guide" onclick="alert('Delete or comment out Line ${f.line}: ${escapeHtml(f.codeSnippet)}')">
                View Excision
              </button>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      alert(`Error scanning code: ${err.message}`);
    } finally {
      scanBtn.disabled = false;
      scanBtn.innerHTML = '<span>🔍</span><span>Analyze Liquid Code</span>';
    }
  });
}

// 9. Modals Setup
function setupModals() {
  const excisionModal = document.getElementById('excisionModal');
  const closeExcisionModal = document.getElementById('closeExcisionModal');
  closeExcisionModal.addEventListener('click', () => excisionModal.style.display = 'none');

  const proModal = document.getElementById('proModal');
  const openProModal = document.getElementById('openProModal');
  const closeProModal = document.getElementById('closeProModal');

  openProModal.addEventListener('click', () => proModal.style.display = 'flex');
  closeProModal.addEventListener('click', () => proModal.style.display = 'none');

  window.addEventListener('click', (e) => {
    if (e.target === excisionModal) excisionModal.style.display = 'none';
    if (e.target === proModal) proModal.style.display = 'none';
  });
}

function getCategoryIcon(cat) {
  if (cat.includes('Reviews')) return '⭐';
  if (cat.includes('Email') || cat.includes('SMS')) return '✉️';
  if (cat.includes('Analytics') || cat.includes('Heatmaps')) return '📊';
  if (cat.includes('Support') || cat.includes('Chat')) return '💬';
  if (cat.includes('Upsells') || cat.includes('Bundles')) return '🛍️';
  if (cat.includes('Subscription')) return '🔄';
  return '📦';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// Sample Mock Bloated Store Data for Instant Testing
function getMockDemoScanResult() {
  return {
    storeUrl: 'sample-bloated-store.myshopify.com',
    finalUrl: 'https://sample-bloated-store.myshopify.com',
    scanDurationMs: 840,
    score: 52,
    grade: 'F',
    badgeColor: '#DE3618',
    headline: 'Critical Theme Bloat Detected',
    recommendation: 'You have 4 dead scripts dragging down your mobile speed score.',
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
      totalScriptsFound: 18,
      externalScriptsCount: 11,
      inlineScriptsCount: 7,
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
        description: 'Klaviyo loads heavy customer identity trackers and popups.',
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
        description: 'Loox review widgets inject heavy JavaScript and CSS.',
        snippetPatterns: ['loox-rating.liquid'],
        status: 'suspected_orphan',
        matchReasons: [{ type: 'external_script', evidence: 'https://loox.io/widget/loox.js?shop=demo.myshopify.com' }]
      },
      {
        appId: 'hotjar',
        name: 'Hotjar: Heatmaps & Screen Recording',
        category: 'Analytics & Heatmaps',
        speedPenalty: 'High',
        avgSizeKB: 190,
        avgDelayMs: 450,
        description: 'Hotjar maintains continuous DOM mutation observers to record user sessions.',
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
        description: 'ReConvert injects upsell widget triggers on product and thank you pages.',
        snippetPatterns: ['reconvert.liquid'],
        status: 'suspected_orphan',
        matchReasons: [{ type: 'external_script', evidence: 'https://cdn.reconvert.io/assets/stik-reconvert.js' }]
      }
    ],
    unknownExternalScripts: [
      { url: 'https://tracking-unidentified-analytics.org/tag.js', snippet: 'src="https://tracking-unidentified-analytics.org/tag.js"' }
    ]
  };
}
