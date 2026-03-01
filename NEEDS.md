# NEEDS.md — Missing Credentials for Dispute Shield Deployment

The app is built and ready. Deployment is blocked on 3 missing credentials:

---

## 1. GitHub Personal Access Token
**Purpose:** Create the `dispute-shield` repo and push the code.

**How to get one:**
1. Go to https://github.com/settings/tokens/new
2. Select scopes: `repo` (full control of private repositories)
3. Click "Generate token" and copy it
4. Add to `credentials.json` under:
   ```json
   "github": {
     "token": "ghp_xxxxxxxxxxxxxxxxxxxx",
     "username": "your-github-username"
   }
   ```

---

## 2. Railway API Token
**Purpose:** Deploy the app to Railway and get a public URL.

**How to get one:**
1. Go to https://railway.app → Log in
2. Click your avatar → Account Settings → Tokens
3. Create a new token and copy it
4. Add to `credentials.json` under:
   ```json
   "railway": {
     "token": "your-railway-token"
   }
   ```

**Alternative:** Run `railway login` in terminal (opens browser) and then re-run this task.

---

## 3. Shopify Partner API Token
**Purpose:** Create the "Dispute Shield" public app in the Shopify Partner Dashboard.

**How to get one:**
1. Go to https://partners.shopify.com
2. Log in to the EPETAH LLC / Balmbare partner account
3. Go to Settings → Partner API clients → Create API client
4. Copy the access token
5. Add to `credentials.json` under:
   ```json
   "shopify_partner": {
     "api_token": "prtapi_xxxxxxxxxxxx",
     "organization_id": "your-org-id"
   }
   ```
   (Organization ID is in the URL: `partners.shopify.com/XXXXX/...`)

**Alternative:** Manually create the app in the Partner Dashboard:
- App name: **Dispute Shield**
- App URL: (from Railway, e.g. `https://dispute-shield.up.railway.app`)
- Redirect URL: `https://dispute-shield.up.railway.app/auth/callback`
- Scopes: `read_shopify_payments_dispute_evidences,write_shopify_payments_dispute_evidences`

---

## What's Already Done ✅
- App code is complete (`server.js`, `db.js`, `package.json`, `railway.json`)
- Internal API secret generated: `ab29609c0389582706bd87c24deb99b452de64a93ea0cc8a427b5ac027cc9227`
  (saved to `credentials.json` under `disputeShield.secret`)
- `node_modules` present and dependencies installed

## Next Steps After Credentials Are Provided
Once the above 3 tokens are in `credentials.json`, run this task again and the agent will:
1. Create & push GitHub repo
2. Deploy to Railway
3. Create Shopify Partner app with correct URLs
4. Install on `pxm6gc-t7.myshopify.com`
