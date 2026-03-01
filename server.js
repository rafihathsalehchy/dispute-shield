require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
const { restResources } = require('@shopify/shopify-api/rest/admin/2024-01');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── SHOPIFY API SETUP ─────────────────────────────────────
const SETUP_MODE = !process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_API_KEY === 'PLACEHOLDER';
const shopify = SETUP_MODE ? null : shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SHOPIFY_SCOPES || '').split(','),
  hostName: (process.env.SHOPIFY_APP_URL || 'localhost').replace(/https?:\/\//, ''),
  apiVersion: ApiVersion.January24,
  isEmbeddedApp: false,
  sessionStorage: {
    storeSession: async (session) => { db.saveSession(session); return true; },
    loadSession: async (id) => {
      const row = db.loadSession(id);
      if (!row) return undefined;
      const s = new Session({ id: row.id, shop: row.shop, state: row.state, isOnline: !!row.isOnline });
      s.scope = row.scope;
      s.accessToken = row.accessToken;
      s.expires = row.expires ? new Date(row.expires) : undefined;
      return s;
    },
    deleteSession: async (id) => { db.deleteSession(id); return true; },
  },
});

// ── SETUP MODE ───────────────────────────────────────────
if (SETUP_MODE) {
  app.get('*', (req, res) => res.json({ status: 'setup', message: 'Dispute Shield is running. Set SHOPIFY_API_KEY to activate.' }));
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🛡️ Dispute Shield (setup mode) on port ${PORT}`));
  return;
}

// ── OAUTH: BEGIN ──────────────────────────────────────────
app.get('/auth', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');
  await shopify.auth.begin({ shop, callbackPath: '/auth/callback', isOnline: false, rawRequest: req, rawResponse: res });
});

// ── OAUTH: CALLBACK ───────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({ rawRequest: req, rawResponse: res });
    const session = callback.session;
    await shopify.sessionStorage.storeSession(session);
    console.log(`✅ Installed on ${session.shop} | scope: ${session.scope}`);
    res.redirect(`/dashboard?shop=${session.shop}`);
  } catch (e) {
    console.error('Auth callback error:', e);
    res.status(500).send(`Auth failed: ${e.message}`);
  }
});

// ── DASHBOARD ─────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  const shop = req.query.shop || 'unknown';
  const session = db.findSessionByShop(shop);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Dispute Shield</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
        .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; margin: 24px 0; }
        .badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
        h1 { font-size: 28px; margin-bottom: 4px; }
        .sub { color: #6b7280; margin-bottom: 32px; }
        code { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; display: block; font-size: 13px; line-height: 1.6; white-space: pre; overflow-x: auto; }
      </style>
    </head>
    <body>
      <h1>🛡️ Dispute Shield</h1>
      <p class="sub">Automated dispute evidence submission for Shopify Payments</p>
      <div class="card">
        <span class="badge">✅ Connected</span>
        <p style="margin-top:16px"><strong>Shop:</strong> ${shop}</p>
        <p><strong>Scope:</strong> ${session?.scope || 'checking...'}</p>
        <p><strong>Status:</strong> Active and ready to receive dispute evidence</p>
      </div>
      <div class="card">
        <h3>API Endpoint</h3>
        <p>Your Chargeback Defender calls this endpoint to submit evidence:</p>
        <code>POST /api/submit-dispute-evidence
Content-Type: application/json
X-Internal-Secret: &lt;your secret&gt;

{
  "shop": "yourstore.myshopify.com",
  "disputeId": "gid://shopify/ShopifyPaymentsDispute/123",
  "evidence": {
    "customerEmailAddress": "customer@email.com",
    "customerFirstName": "Jane",
    "customerLastName": "Doe",
    "shippingAddress": { ... },
    "fulfillmentDocumentation": "tracking info...",
    "refundPolicyDisclosure": "All sales final per TOS",
    "cancellationPolicyDisclosure": "No cancellations after shipping"
  }
}</code>
      </div>
    </body>
    </html>
  `);
});

// ── INTERNAL API: SUBMIT DISPUTE EVIDENCE ─────────────────
app.post('/api/submit-dispute-evidence', async (req, res) => {
  // Verify internal secret
  const secret = req.headers['x-internal-secret'];
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { shop, disputeId, evidence } = req.body;
  if (!shop || !disputeId || !evidence) {
    return res.status(400).json({ error: 'Missing shop, disputeId, or evidence' });
  }

  try {
    // Load session for this shop
    const sessionRow = db.findSessionByShop(shop);
    if (!sessionRow || !sessionRow.accessToken) {
      return res.status(404).json({ error: `No session found for ${shop}. Install the app first.` });
    }

    // Build GraphQL mutation
    const mutation = `
      mutation disputeEvidenceUpdate($id: ID!, $disputeEvidence: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
        disputeEvidenceUpdate(id: $id, disputeEvidence: $disputeEvidence) {
          disputeEvidence {
            id
            submittedByMerchant
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: disputeId,
      disputeEvidence: {
        customerEmailAddress: evidence.customerEmailAddress,
        customerFirstName: evidence.customerFirstName,
        customerLastName: evidence.customerLastName,
        uncategorizedText: evidence.uncategorizedText || '',
        fulfillmentDocumentation: evidence.fulfillmentDocumentation || '',
        refundPolicyDisclosure: evidence.refundPolicyDisclosure || '',
        cancellationPolicyDisclosure: evidence.cancellationPolicyDisclosure || '',
        additionalDocumentation: evidence.additionalDocumentation || '',
        submitForReview: true,
      }
    };

    if (evidence.shippingAddress) {
      variables.disputeEvidence.shippingAddress = evidence.shippingAddress;
    }

    const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': sessionRow.accessToken,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const result = await response.json();
    const errors = result.data?.disputeEvidenceUpdate?.userErrors;

    if (errors && errors.length > 0) {
      return res.status(422).json({ error: 'Shopify errors', details: errors });
    }

    console.log(`✅ Evidence submitted for dispute ${disputeId} on ${shop}`);
    res.json({ success: true, data: result.data?.disputeEvidenceUpdate?.disputeEvidence });

  } catch (e) {
    console.error('Evidence submission error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Dispute Shield', version: '1.0.0' });
});

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🛡️ Dispute Shield running on port ${PORT}`));
// deploy Sun Mar  1 23:44:27 +06 2026
