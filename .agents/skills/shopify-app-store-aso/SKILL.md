---
name: shopify-app-store-aso
description: Exact algorithms, metadata constraints, keyword matrices, conversion tactics, and review prompting strategies to rank #1 on the Shopify App Store.
---

# Shopify App Store Optimization (ASO) Mastery

## 1. Shopify App Store Search Algorithm Overview
Shopify ranks apps using a hybrid model of **Semantic Relevance** and **Merchant Behavioral Signals**:

### A. On-Metadata Weighting (Relevance)
1. **App Title (Strict 30 Character Limit):**
   - Carries the highest algorithmic weight.
   - Formula: `[BrandName]: [Primary High-Volume Keyword]`
   - Example: `BloatBuster: Page Speed Boost` (29 characters).
2. **App Subtitle (Strict 62 Character Limit):**
   - Second highest weight. Must capture secondary intent and customer pain.
   - Example: `Clean leftover app code, speed up storefront & boost PageSpeed` (62 characters).
3. **Search Tags (5 Tags Maximum):**
   - Exact-match filters used by merchants and search suggestion dropdowns.
   - Top 5: `speed booster`, `page speed`, `theme cleaner`, `leftover code`, `uninstall cleaner`.
4. **App Categories & Subcategories:**
   - Primary: `Store design` &rarr; `Store speed`
   - Secondary: `Theme customization`

### B. Behavioral & Authority Signals (Rank Boosters)
* **Install Velocity:** Rolling 7-day and 30-day install acceleration is the #1 signal for climbing search results.
* **Conversion Rate (Impressions &rarr; Installs):** A high click-through and install rate from search results signals strong product-market fit.
* **Review Velocity & Recency:** Continuous 5-star reviews (not just total count, but recency within the last 14 days) signal an active, trustworthy app.
* **Uninstall Rate & Retention:** Low uninstalls within 48 hours signal quality. High early uninstall rates trigger algorithmic suppression.

## 2. The "Free Plan Available" Search Badge Tactic
Shopify displays badge tags on search cards that heavily dictate merchant click-through rates:
* **"Free trial available":** Creates hesitation. Merchants assume a paywall will block them.
* **"Free plan available":** Triples organic clicks because merchants know they can use core features with zero financial obligation.

### Implementation:
In Shopify Partner Dashboard &rarr; Apps &rarr; Pricing:
1. **Plan 1 (Free):** Name: `Free Diagnostic Plan` &bull; Price: `$0.00 / month`
   - Includes: Unlimited live storefront script audits, full line disclosure, manual excision guides.
2. **Plan 2 (Pro):** Name: `Automated Protection Pro` &bull; Price: `$2.99 / month` (with 7-Day Free Trial)
   - Includes: 1-Click Automated Theme Backup, 1-Click Safe Comment Deactivation, 24/7 Uninstall Watchdog.

## 3. High-Volume Keyword Strategy Matrix

| Search Query | Monthly Volume | Intent Level | Placement in Listing |
| :--- | :--- | :--- | :--- |
| `speed booster` / `speed optimizer` | Very High (10k+) | Core Problem | Title & Tag |
| `page speed` / `pagespeed` | Very High (8k+) | Core Web Vitals | Subtitle & Tag |
| `leftover code` | Moderate (1k+) | Specific Pain | Subtitle & Tag |
| `theme cleaner` | Low (~200) | Direct Utility | Search Tag |
| `core web vitals` | Moderate (1.5k+) | Performance Metric | Feature Bullet |

## 4. In-App 5-Star Review Prompting Mechanics
* **Direct Deep-Link Format:**
  Append `#modal-show=ReviewListingModal` to your live app listing handle:
  ```text
  https://apps.shopify.com/[app-handle]#modal-show=ReviewListingModal
  ```
  *(Example: `https://apps.shopify.com/bloatbuster-clean-theme-code#modal-show=ReviewListingModal`)*
  When opened by an installed store, Shopify directly launches the review dialogue without requiring navigation.
* **Optimal Prompt Triggers:**
  - **Success Moment 1:** When a storefront audit scores a clean Grade A rating.
  - **Success Moment 2:** Immediately after a merchant executes a 1-click safe code deactivation.
  - **Persistence:** Save `localStorage.setItem('bloatbuster_review_dismissed', '1')` when dismissed so merchants are never annoyed.
