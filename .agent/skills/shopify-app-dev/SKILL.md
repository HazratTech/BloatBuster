---
name: shopify-app-dev
description: Comprehensive standards and patterns for building, securing, and maintaining production-grade Shopify apps according to official Shopify AI Toolkit and Built for Shopify (BFS) criteria.
---

# Shopify App Development Specification & Best Practices

## 1. Authentication & Session Architecture
* **Modern App Bridge (v4+) & Session Tokens:**
  - Modern Shopify apps operate strictly inside an iframe inside `admin.shopify.com`.
  - Never rely on third-party cookies (browsers block cross-site cookies by default).
  - Every frontend request must include an App Bridge `idToken` sent in the `Authorization: Bearer <sessionToken>` header.
  - The backend server must verify the JWT using `jsonwebtoken` against `SHOPIFY_API_SECRET`, confirming `dest`, `iss`, `aud`, and `exp`.
* **Offline Access Tokens:**
  - Offline tokens do not expire when the user closes the browser. They are required for background tasks, webhooks, and recurring billing syncs.
  - Persist tokens safely in durable disk storage (e.g. SQLite / encrypted JSON volume) so container restarts do not force merchant re-authentication.

## 2. Shopify Admin GraphQL API Conventions
* **API Versioning:**
  - Always pin requests to supported API versions (e.g. `2025-01` or `2026-xx`). Never use deprecated or unversioned endpoints.
* **Theme Assets & Modification Rules:**
  - When accessing themes, query `themes(first: 10, roles: [MAIN])` to identify the live storefront theme.
  - Never overwrite entire theme files destructively. Read the asset content, perform atomic modifications, and write back.
  - Liquid files (`layout/theme.liquid`, `snippets/*.liquid`, `templates/*.liquid`) must be parsed safely.
* **Atomic Theme Backups:**
  - Before modifying any live merchant theme file, execute the GraphQL `themeDuplicate` mutation.
  - Record the `backupTheme.id` and timestamp so the merchant can restore their original theme with 1 click.

## 3. Mandatory Webhook Compliance (GDPR & Lifecycle)
Every public Shopify app must register and respond to compliance endpoints:
1. `customers/data_request`: Handles merchant/customer GDPR data export requests.
2. `customers/redact`: Deletes customer records upon merchant request.
3. `shop/redact`: Triggered 48 hours after app uninstallation to wipe shop data from the database.
4. `app/uninstalled`:
   - Fired immediately when the merchant removes the app.
   - App must invalidate active billing records, mark session inactive, and trigger cleanup hooks.

* **Webhook HMAC Verification:**
  - Every webhook must verify `x-shopify-hmac-sha256` header against `crypto.createHmac('sha256', secret).update(rawBody).digest('base64')`.
  - Use `express.raw({ type: 'application/json' })` or buffer capture so JSON parsing does not alter whitespace.

## 4. Built for Shopify (BFS) Standards
To qualify for the elite "Built for Shopify" badge:
1. **Performance:** App Bridge loading must achieve LCP < 2.5s over a 28-day rolling window.
2. **Native Polaris UX:** Use Shopify Polaris components, typography, and spacing tokens.
3. **Save Bar API:** Any configuration forms must hook into the native App Bridge Save Bar.
4. **Zero Residue on Uninstall:** Theme App Extensions (App Blocks / App Embeds) must be utilized so uninstallation leaves zero residual orphan code.

## 5. Billing Engine (`appSubscriptionCreate`)
* **GraphQL Mutation:** Use `appSubscriptionCreate` for recurring monthly or annual billing.
* **Dev Store Whitelist:** When testing in development or test stores, set `test: true` to avoid real credit card charges.
* **Production Merchant Safety:** For real production merchants on paid plans, ensure `test: false` so real revenue is captured.
* **Trial Period Management:** Set `trialDays: 7` for new installs. Enforce anti-abuse logic so uninstalled/reinstalled merchants do not receive infinite free trials.
