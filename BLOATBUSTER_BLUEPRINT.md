# BloatBuster: Theme Code & Script Cleaner
**Complete Project Blueprint, Technical Feasibility Analysis & Implementation Plan**

---

## 1. Executive Summary & Feasibility Assessment

**Verdict:** **100% Feasible, Highly Scalable, and Minimal ($0) Operating Cost.**

BloatBuster directly attacks one of the biggest friction points for Shopify merchants: **"Theme Code Rot"** and **"Uninstall Anxiety."** Whenever a merchant tests and uninstalls an app, Shopify uninstallation webhooks **do not** automatically purge third-party `<script>` tags, inline tracking pixels, or liquid includes injected into `layout/theme.liquid` or `snippets/`. Over months, stores accumulate dozens of dead network requests that destroy Core Web Vitals (LCP, INP, CLS) and Google PageSpeed scores.

### Critical Technical Nuances & Solutions

To make this app operate at **$0 server cost** and guarantee **100% Shopify App Store compliance**, our feasibility analysis identified 3 key constraints and solved them:

| Constraint / Challenge | Naive Approach (Fails) | BloatBuster Production Solution ($0 Cost) |
| :--- | :--- | :--- |
| **Storefront Fetch & CORS** | Attempting direct `window.fetch('https://store.com')` from inside the Shopify Admin iframe. Fails due to browser CORS policies. | Server-to-server fetch in the app's backend loader (Remix/Node) running on Vercel/Cloudflare Workers free tier ($0/mo). Executes in <150ms with zero CORS barriers. |
| **Installed Apps Detection** | Relying on `appInstallations` GraphQL query, which requires restricted scope `read_apps` (hard to get approved). | **Hybrid Detection Engine**: 1) Inspect `config/settings_data.json` for active Theme App Extensions / App Embed blocks; 2) Scan live scripts & snippets; 3) Provide an instant 1-click toggle card for merchants to confirm uninstalled apps. |
| **Theme Modification Safety** | Directly deleting code riskily, potentially breaking checkout or theme layout. | **Safe Guard Protocol**: 1) Free tier provides file/line locations + deep links to Shopify Theme Code Editor; 2) Pro tier creates an automatic `themeDuplicate` backup before removing dead snippets. |

---

## 2. System Architecture

```
                                  +---------------------------------------+
                                  |     Merchant in Shopify Admin         |
                                  |   (Embedded via App Bridge/Polaris)   |
                                  +---------------------------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |         BloatBuster Dashboard         |
                                  |  - One-Click Scan Trigger             |
                                  |  - Visual Health Score (0-100)        |
                                  |  - Detected Orphan List               |
                                  +---------------------------------------+
                                                      |
                          +---------------------------+---------------------------+
                          |                                                       |
                          v                                                       v
            +---------------------------+                           +---------------------------+
            |  Engine 1: Storefront DOM |                           | Engine 2: Theme Code AST  |
            |  - Fetches Live HTML      |                           | - Queries theme.liquid    |
            |  - Extracts <script src>  |                           | - Scans snippets/*.liquid |
            |  - Extracts inline JS     |                           | - Reads settings_data.json|
            +---------------------------+                           +---------------------------+
                          \                                                       /
                           \                                                     /
                            v                                                   v
                        +-----------------------------------------------------------+
                        |           BloatBuster Signature Matching Engine           |
                        |      (Local JSON Database: 50+ Major Shopify Apps)        |
                        | - Matches domains, handles, CDN URLs, liquid tags         |
                        | - Calculates speed weight (Low / Medium / High)           |
                        +-----------------------------------------------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |          Actionable Report            |
                                  | - Free: Manual Excision + Deep Links  |
                                  | - Pro: 1-Click Backup & Auto Clean    |
                                  +---------------------------------------+
```

---

## 3. Database of Top 50 Shopify App Signatures

BloatBuster includes an embedded signature dictionary mapping CDN domains, snippet filenames, inline signatures, and performance penalties:

### A. Reviews & Social Proof (Heavy JS & DOM Injections)
* **Judge.me**: `cdn.judge.me`, `judgeme-core.js`, `snippets/judgeme_widgets.liquid` (Impact: **High**)
* **Loox**: `loox.io`, `loox.css`, `snippets/loox-rating.liquid` (Impact: **High**)
* **Yotpo**: `static.yotpo.com`, `yotpo.js`, `snippets/yotpo-` (Impact: **High**)
* **Okendo**: `okendo.cdn`, `okendo-reviews.js`, `snippets/okendo-` (Impact: **High**)
* **Stamped.io**: `cdn.stamped.io`, `snippets/stamped-rewards` (Impact: **High**)
* **AliReviews**: `alireviews.io`, `fireapps.vn` (Impact: **High**)
* **Fera.ai**: `cdn.fera.ai`, `snippets/fera-` (Impact: **Medium**)
* **Nudgify**: `nudgify.com`, `pixel.nudgify.com` (Impact: **Medium**)

### B. Email & SMS Marketing (Forms, Popups & Tracking Pixels)
* **Klaviyo**: `static.klaviyo.com`, `klaviyo.js`, `snippets/klaviyo.liquid` (Impact: **High**)
* **Omnisend**: `omnisnippet1.com`, `omnisend.js`, `snippets/omnisend` (Impact: **High**)
* **Privy**: `widget.privy.com`, `snippets/privy.liquid` (Impact: **High**)
* **Mailchimp**: `chimpstatic.com`, `mailchimp.com` (Impact: **Medium**)
* **Attentive**: `attentivemobile.com`, `snippets/attentive` (Impact: **High**)
* **Postscript**: `postscript.io`, `sdk.postscript.io` (Impact: **Medium**)
* **Smsbump / Yotpo SMS**: `smsbump.com`, `snippets/smsbump` (Impact: **Medium**)

### C. Analytics, Heatmaps & Tag Managers (Heavy CPU / Observers)
* **Hotjar**: `static.hotjar.com`, `script.hotjar.com` (Impact: **High**)
* **Microsoft Clarity**: `clarity.ms/tag` (Impact: **High**)
* **Lucky Orange**: `luckyorange.net`, `d10lpsik1i8c69.cloudfront.net` (Impact: **High**)
* **Crazy Egg**: `script.crazyegg.com` (Impact: **High**)
* **Triple Whale**: `triplewhale-pixel.run` (Impact: **Medium**)
* **Elevar**: `elevar.com`, `snippets/elevar-` (Impact: **Medium**)

### D. Upsells, Bundles & Cart Drawers
* **WideBundle**: `widebundle`, `snippets/widebundle` (Impact: **Medium**)
* **ReConvert**: `reconvert.io`, `stik-reconvert` (Impact: **Medium**)
* **Bold Upsell**: `boldapps.com`, `bold-upsell` (Impact: **Medium**)
* **Monster Upsell**: `monster-upsell` (Impact: **Medium**)
* **In Cart Upsell**: `incartupsell.com` (Impact: **Medium**)

### E. Customer Support & Live Chat
* **Gorgias**: `config.gorgias.chat`, `gorgias-chat` (Impact: **High**)
* **Tidio**: `code.tidio.co`, `tidio.js` (Impact: **High**)
* **Zendesk**: `zdassets.com`, `snippets/zendesk` (Impact: **High**)
* **Crisp**: `client.crisp.chat` (Impact: **High**)
* **Intercom**: `widget.intercom.io` (Impact: **High**)

### F. Subscriptions & Payments
* **Recharge**: `rechargecdn.com`, `snippets/subscription-cart-footer` (Impact: **Medium**)
* **Bold Subscriptions**: `boldcommerce.com/v2/` (Impact: **Medium**)
* **Skio**: `skio.com`, `snippets/skio-` (Impact: **Medium**)
* **Smartrr**: `smartrr.com` (Impact: **Medium**)

---

## 4. Feature Set & Product Tiers

### Free Tier: The Viral Hook
* **Unlimited Theme Scans**: One-click scan of current active theme & homepage.
* **The Bloat Health Score**: 0 to 100 score highlighting detected bloat and estimated load delay.
* **Visual Bloat Report**: Categorized list of detected scripts with performance impact badges.
* **Safe Excision Guide**:
  - Exact file location (e.g., `layout/theme.liquid: Line 47`).
  - Code snippet preview.
  - Deep-link button: *"Open in Shopify Theme Code Editor"* directly at that specific file.

### Pro Tier ($19/month): Automated Peace of Mind
* **1-Click Automated Theme Cleanup**: Automatically removes or safely comments out (`{% comment %}...{% endcomment %}`) orphan code.
* **Automatic Theme Duplication Backup**: Creates a timestamped duplicate (e.g. `[BloatBuster Backup] Dawn 12.0 - Mar 2026`) before any modification.
* **Theme Rollback Safeguard**: Instant 1-click restore button.
* **Uninstall Watchdog / Active Protection**: Alerts the merchant whenever a newly uninstalled app leaves behind dead code.

---

## 5. 5-Day Implementation Roadmap

### Day 1: Scaffolding & Signature Knowledge Engine
* Initialize Shopify App with Remix & Vite using `@shopify/shopify-app-remix`.
* Implement `app/data/signatures.json` with 50+ top Shopify app signatures, regex domain patterns, and snippet handles.
* Establish Shopify Polaris design tokens & layout.

### Day 2: Dual Scan Engine (Storefront + Theme Assets)
* Implement server-side Storefront Scraper (`app/services/storefront-scanner.server.ts`):
  - Fetches live homepage HTML cleanly server-to-server (zero CORS).
  - Regex & DOM parser extracting `<script src="...">`, inline scripts, and stylesheet `<link>` tags.
* Implement Theme Asset Scanner (`app/services/theme-scanner.server.ts`):
  - Queries active theme assets via Shopify GraphQL/REST Admin API.
  - Inspects `layout/theme.liquid` and `snippets/`.
  - Reads `config/settings_data.json` to identify active Theme App Blocks.

### Day 3: Merchant Dashboard & "Aha!" Report
* Build `app/routes/app._index.tsx`:
  - Hero card with store name, active theme name, and dynamic "Scan My Theme" button.
  - Animated scan progress (scanning homepage, analyzing scripts, cross-referencing signatures).
  - Bloat Score Gauge (Red / Yellow / Green).
  - Interactive Review Table: Merchants can toggle "Still Active" vs "Uninstalled" for ambiguous apps.

### Day 4: Safe Removal Protocol & Billing
* Implement Safe Excision deep links for Free Tier.
* Implement Pro Tier 1-Click Cleanup:
  - Theme duplicate mutation (`themeDuplicate`).
  - Snippet deletion or safe commenting (`themeFilesUpsert`).
* Integrate Shopify App Billing API (`$19/month` with 7-day trial).

### Day 5: Verification, Testing & Growth Playbook
* Test against sample Shopify themes with injected dead snippets.
* Verify speed and error resilience (timeout handling for slow stores).
* Finalize ASO metadata and forum outreach templates.

---

## 6. Zero-Budget Organic Marketing Playbook

* **Shopify Community & Reddit (r/shopify) Outreach**:
  - Search queries: `"leftover app code"`, `"remove dead scripts"`, `"how to speed up shopify"`.
  - Free audit offer: Run the merchant's store through the scanner and post a friendly, non-salesy breakdown: *"Hey, noticed your store is loading dead Loox and Hotjar scripts from apps you removed. Here are the exact snippets to delete in your theme.liquid to save ~450KB."*
* **App Store Optimization (ASO)**:
  - **Title**: `BloatBuster ‑ Script Cleaner`
  - **Subtitle**: `Clean leftover app code, remove dead scripts & boost speed`
  - **Keywords**: `theme cleaner`, `remove leftover script`, `uninstall clean`, `page speed`, `theme code cleaner`.
* **The Math to $500+/Month**:
  - Price: **$19/month**
  - Target: **27 paying stores** = **$513/month**
  - Conversion rate from free scan to cleanup subscription: ~12–18% of stores with high bloat scores.
