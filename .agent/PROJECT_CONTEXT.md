# BloatBuster Context & Architectural Directives

## Quick Reference
* **App Name:** BloatBuster (Theme Code & Script Cleaner)
* **Target Audience:** Shopify Merchants experiencing page speed drops from leftover app scripts and uninstalled app debris.
* **Monetization:** Freemium ($0 Free unlimited scans & manual excision guide; $19/mo for automated 1-click cleanup, theme backup, and active protection).
* **Target Goal:** $500+/month with $0 server cost (27 merchants @ $19/mo).

## Technical Feasibility & Strategy
1. **Zero Server Cost:** 
   - Uses standard Shopify Remix/Node template on Vercel or Cloudflare Workers free tiers ($0/month).
   - Server-side loaders perform storefront HTML fetching, bypassing all browser CORS issues without needing third-party proxy services.
2. **Hybrid App Detection:**
   - Detects active Theme App Blocks via `config/settings_data.json` (`current.blocks`).
   - Parses `<script>`, `<link>`, and inline JS matching 50+ app signatures.
   - Interactive merchant confirmation card allows 1-click toggling between "Active" and "Uninstalled".
3. **Safe Removal Protocol:**
   - Free Tier: Provides exact line numbers, file paths, and deep links to Shopify Theme Code Editor.
   - Pro Tier: Automatically duplicates the active theme (`themeDuplicate` GraphQL mutation) as a safety backup before removing or commenting out dead snippets.

## Signatures Database
Contains signatures for top apps across:
- Reviews (Loox, Judge.me, Yotpo, Okendo, Stamped, AliReviews)
- Email/SMS (Klaviyo, Omnisend, Privy, Mailchimp, Attentive, Postscript)
- Analytics (Hotjar, Clarity, Lucky Orange, Triple Whale)
- Upsells & Bundles (WideBundle, ReConvert, Bold Upsell)
- Support (Gorgias, Tidio, Zendesk, Crisp)
- Subscriptions (Recharge, Bold Subscriptions, Skio)

See [BLOATBUSTER_BLUEPRINT.md](file:///Volumes/SSD/Coding/website/Shopify%20App/BloatBuster/BLOATBUSTER_BLUEPRINT.md) for the complete blueprint.
