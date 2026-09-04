# BloatBuster: VPS & Docker Production Deployment Guide

## Architecture Overview
* **Server:** Your VPS with Docker
* **Domain / Subdomain:** `bloatbuster.relayworks.com` (or your chosen subdomain)
* **SSL / HTTPS:** Free via Let's Encrypt (Caddy / Nginx / Certbot)
* **Shopify Integration:** Native embedded iframe inside `admin.shopify.com`

---

## Step 1: Point Your Subdomain (DNS Record)
In your domain registrar / DNS manager (Cloudflare, Namecheap, GoDaddy, etc.):
* **Type:** `A`
* **Name / Host:** `bloatbuster` (or whatever subdomain you prefer)
* **Value / Target:** `YOUR_VPS_PUBLIC_IP`
* **TTL:** Auto or 300 seconds

---

## Step 2: Deploy on Your VPS with Docker

### Option A: Using Git
On your VPS terminal:
```bash
git clone <YOUR_REPO_URL> bloatbuster
cd bloatbuster
docker compose up -d --build
```

### Option B: Copy Files Directly via SCP / SFTP
Upload the `BloatBuster` folder to your VPS, then run:
```bash
docker compose up -d --build
```

Verify it is running:
```bash
docker ps
```
Your app will be actively listening on `localhost:3000`.

---

## Step 3: Configure Reverse Proxy & SSL (HTTPS)

Shopify **requires** all apps to run on HTTPS. Here are the 2 easiest ways:

### Method 1: Using Caddy (Easiest - Automatic Free SSL)
If using Caddy on your VPS, add this to `/etc/caddy/Caddyfile`:
```caddyfile
bloatbuster.relayworks.com {
    reverse_proxy localhost:3000
}
```
Reload Caddy:
```bash
caddy reload
```
*(Caddy automatically provisions a Let's Encrypt SSL certificate within 5 seconds!)*

### Method 2: Using Nginx + Certbot
Add to your Nginx sites configuration:
```nginx
server {
    server_name bloatbuster.relayworks.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Issue SSL:
```bash
sudo certbot --nginx -d bloatbuster.relayworks.com
```

---

## Step 4: Update Your Shopify Partner Dashboard

Once `https://bloatbuster.relayworks.com` responds in your browser:

1. Open your **[Shopify Partner Dashboard](https://dev.shopify.com)**.
2. Go to **Apps &rarr; BloatBuster: Clean Theme Code &rarr; Configuration**.
3. Update the URLs:
   * **App URL:** `https://bloatbuster.relayworks.com`
   * **Allowed redirection URLs:**
     `https://bloatbuster.relayworks.com/auth/callback`
4. Click **Save**.

---

## Step 5: Test on Live Development Store
Open `https://admin.shopify.com/store/relayworks/apps/468869026551455874d932a9608b7494`.
Your production app running on your own VPS will load directly inside the Shopify Admin!
