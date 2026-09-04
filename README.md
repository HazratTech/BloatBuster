# BloatBuster

**Theme Code & Leftover Script Cleaner for Shopify**

BloatBuster scans Shopify storefronts and Liquid theme files for orphaned scripts, broken tracking pixels, and dead app assets left behind by uninstalled Shopify apps.

---

## ⚡ Features
* **Dual Scanning Engine:** Inspects live storefront HTML and theme liquid code (`layout/theme.liquid`, snippets, `settings_data.json`).
* **52+ Built-in App Signatures:** Cross-references with top Shopify apps across Reviews, Marketing, Analytics, and Subscriptions.
* **Bloat Score & Speed Drag:** Computes an intuitive 0–100 health score, wasted payload (KB), and execution delay.
* **Safe Removal Protocol:** Step-by-step excision instructions with deep links to Shopify's Theme Code Editor.
* **Shopify Embedded App:** Built with App Bridge and Polaris aesthetics to run natively inside Shopify Admin.
* **Shopify Native Billing API:** Seamless $19/mo recurring subscription with a 7-day trial.

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Run test suite
npm test

# 3. Start local development server
npm start
```

---

## 🐳 Docker & Production Deployment

```bash
docker compose up -d --build
```

Automated CI/CD pipeline configured in `.github/workflows/workflow.yml` for self-hosted VPS deployment.
