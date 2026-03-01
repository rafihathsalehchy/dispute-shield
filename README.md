# 🛡️ Dispute Shield

Shopify public app for programmatic dispute evidence submission.
Built for Balmbare / EPETAH LLC.

## Setup

### 1. Create app in Shopify Partner Dashboard
- Go to partners.shopify.com → Apps → Create app → Public app
- App name: **Dispute Shield**
- App URL: `https://dispute-shield.railway.app`
- Redirect URL: `https://dispute-shield.railway.app/auth/callback`
- Copy your API Key and API Secret

### 2. Deploy to Railway
- Push this repo to GitHub
- Connect to Railway → New Project → Deploy from GitHub
- Add environment variables (see `.env.example`)

### 3. Set environment variables on Railway
```
SHOPIFY_API_KEY=xxx
SHOPIFY_API_SECRET=xxx
SHOPIFY_APP_URL=https://dispute-shield.railway.app
SHOPIFY_SCOPES=read_shopify_payments_dispute_evidences,write_shopify_payments_dispute_evidences
INTERNAL_API_SECRET=generate_a_random_32_char_string
PORT=3000
```

### 4. Install on your store
Visit: `https://dispute-shield.railway.app/auth?shop=pxm6gc-t7.myshopify.com`

### 5. Update Chargeback Defender
Add to credentials.json:
```json
"disputeShield": {
  "url": "https://dispute-shield.railway.app",
  "secret": "your_internal_api_secret"
}
```

## API

### Submit Dispute Evidence
```
POST /api/submit-dispute-evidence
X-Internal-Secret: <INTERNAL_API_SECRET>

{
  "shop": "pxm6gc-t7.myshopify.com",
  "disputeId": "gid://shopify/ShopifyPaymentsDispute/123456",
  "evidence": {
    "customerEmailAddress": "customer@example.com",
    "customerFirstName": "Jane",
    "customerLastName": "Doe",
    "fulfillmentDocumentation": "Order shipped via USPS tracking #...",
    "uncategorizedText": "Customer placed order, confirmed delivery...",
    "refundPolicyDisclosure": "Satisfaction guarantee per our TOS",
    "cancellationPolicyDisclosure": "No cancellations after shipment"
  }
}
```
