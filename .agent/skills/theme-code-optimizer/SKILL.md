---
name: theme-code-optimizer
description: Technical architecture, signature detection algorithms, safe excision protocols, and killer feature roadmaps for Shopify theme cleaner and speed optimization apps.
---

# Theme Code Optimizer: Architecture & Feature Roadmap

## 1. The Theme Debt Anatomy
When Shopify merchants uninstall apps from their admin, Shopify revokes the app's API keys but **never touches theme files**. Over 6–12 months, themes accumulate:
1. **Residual `<script>` Tags in `layout/theme.liquid`:**
   - Dead tracking scripts (pixels, heatmaps, analytics) continue firing on every page load.
   - Causes browser console 404 errors, network timeouts, and thread blocking.
2. **Orphan Liquid Tags (`{% render %}`, `{% include %}`):**
   - Leftover server-side calls trying to evaluate missing snippets.
   - Adds server rendering overhead to Time to First Byte (TTFB).
3. **Dead Snippet Files in `snippets/`:**
   - Orphaned `.liquid` files (e.g. `snippets/loox-rating.liquid`, `snippets/klaviyo.liquid`) that take up asset storage and clutter developer workflows.
4. **Ghost App Embeds in `config/settings_data.json`:**
   - App embed blocks left toggled on in the Theme Customizer settings after the parent app was uninstalled.

## 2. Signature Detection Database & Matching Algorithm
* **Multilayer Inspection:**
  - **Layer 1: Live Storefront HTML Scan:** Extract all `<script src="...">` and inline script blocks from the live homepage and match against verified domains (e.g., `a.klaviyo.com`, `static.hotjar.com`, `loox.io`).
  - **Layer 2: Liquid Theme AST / Line Inspection:** Read `layout/theme.liquid` and scan for uninstalled snippet renders matching known app patterns.
  - **Layer 3: Settings Data Resolution:** Parse `config/settings_data.json` &rarr; `current.blocks` to cross-reference active vs orphan app embeds.
* **Impact Scoring Formula:**
  - Weight each detected orphan by its payload penalty:
    - High Impact (~180KB–220KB): Email/SMS (Klaviyo), Reviews (Loox, Judge.me), Heatmaps (Hotjar).
    - Medium Impact (~100KB–150KB): Loyalty (Smile.io), Social Proof, Currency Converters.
    - Low Impact (~20KB–50KB): Simple badges, trust icons.
  - Compute overall Storefront Health Grade:
    - `Score = 100 - (HighCount * 15) - (MediumCount * 8) - (LowCount * 4)`.

## 3. Safe Excision & Reversibility Protocol
Merchants are terrified of breaking their live store. To guarantee 100% theme safety:
1. **Pre-modification Theme Duplication:**
   - Execute GraphQL `themeDuplicate` mutation prior to any file edit.
   - Store backup metadata: `{ id, name: "BloatBuster Backup - [Date]", createdAt }`.
2. **Safe Comment Deactivation (Non-Destructive):**
   - Never delete lines outright. Wrap identified code in BloatBuster comment tags:
     ```liquid
     {%- comment -%} [BloatBuster Safe Clean] Removed Klaviyo: {% render 'klaviyo' %} {%- endcomment -%}
     ```
   - This eliminates browser execution and server-side processing while preserving theme structure and making rollback instant.
3. **1-Click Theme Restoration:**
   - Provide a 1-click restore mechanism to switch the live role back to the backup theme if desired.

## 4. Top 3 Killer Features to Dominate Competitors (GhostCode & Residue)
Competitors like GhostCode ($29/mo) and Residue ($49/yr) suffer from high churn because merchants run a one-time scan and cancel. BloatBuster wins by providing continuous recurring value:

### Feature 1: Automated 24/7 Uninstall Watchdog (High Retention)
* **Problem:** Merchants forget to run manual scans every time they test and remove an app.
* **Implementation:**
  - Subscribe to Shopify's `app/uninstalled` webhook.
  - When triggered, automatically scan `layout/theme.liquid` and `snippets/` for newly orphaned scripts.
  - Dispatch a proactive email or Shopify Admin notification:
    *"You uninstalled Loox, but 2 scripts are still slowing down your theme. 1-Click Clean Now."*

### Feature 2: Core Web Vitals Before-and-After Telemetry
* **Problem:** Merchants want tangible proof of speed improvement to justify paying.
* **Implementation:**
  - Integrate Google PageSpeed Insights API (mobile & desktop).
  - Capture baseline LCP (Largest Contentful Paint), Total Blocking Time (TBT), and Speed Index prior to cleanup.
  - Re-run PageSpeed audit immediately after deactivating dead scripts.
  - Generate a downloadable "Store Speed Health Certificate": *"BloatBuster eliminated 420KB of dead code, improving mobile PageSpeed by +12 points."*

### Feature 3: Unreferenced Asset Cleaner (`assets/` Sweeper)
* **Problem:** Old CSS and JS bundles sit abandoned in the `assets/` folder, inflating theme bundle size.
* **Implementation:**
  - Index all filenames in `assets/`.
  - Regex-search all `templates/`, `sections/`, and `snippets/` for mentions of each asset name.
  - Flag any asset file with 0 references as an obsolete candidate and offer 1-click backup and archive.
