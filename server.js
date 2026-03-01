require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Strip quotes Railway raw editor may add around values
const env = (key) => (process.env[key] || '').replace(/^["']|["']$/g, '').trim();

const SHOPIFY_API_KEY    = env('SHOPIFY_API_KEY');
const SHOPIFY_API_SECRET = env('SHOPIFY_API_SECRET');
const SHOPIFY_APP_URL    = env('SHOPIFY_APP_URL') || 'http://localhost:3000';
const SHOPIFY_SCOPES     = env('SHOPIFY_SCOPES') || 'read_shopify_payments_dispute_evidences,write_shopify_payments_dispute_evidences';
const INTERNAL_SECRET    = env('INTERNAL_API_SECRET');
const PORT               = parseInt(env('PORT') || '3000', 10);

const SETUP_MODE = !SHOPIFY_API_KEY || SHOPIFY_API_KEY === 'PLACEHOLDER';

// ── HEALTH CHECK (always up) ─────────────────────────────
app.get('/', (req, res) => res.json({
  status: SETUP_MODE ? 'setup' : 'ok',
  app: 'Dispute Shield',
  mode: SETUP_MODE ? 'setup' : 'active',
}));

if (SETUP_MODE) {
  console.log('⚠️  Dispute Shield running in setup mode — set SHOPIFY_API_KEY to activate');
  app.use((req, res) => res.json({ status: 'setup', message: 'Set SHOPIFY_API_KEY to activate.' }));
  app.listen(PORT, () => console.log(`🛡️ Dispute Shield (setup) on port ${PORT}`));
} else {
  // Lazy-load shopify to avoid crash at startup
  let shopify;
  try {
    const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
    const db = require('./db');

    shopify = shopifyApi({
      apiKey: SHOPIFY_API_KEY,
      apiSecretKey: SHOPIFY_API_SECRET,
      scopes: SHOPIFY_SCOPES.split(',').map(s => s.trim()),
      hostName: SHOPIFY_APP_URL.replace(/https?:\/\//, ''),
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
    console.log(`✅ Shopify API initialized | key: ${SHOPIFY_API_KEY.slice(0,8)}...`);

    // ── OAUTH: BEGIN ────────────────────────────────────────
    app.get('/auth', async (req, res) => {
      const shop = req.query.shop;
      if (!shop) return res.status(400).send('Missing shop parameter');
      try {
        await shopify.auth.begin({ shop, callbackPath: '/auth/callback', isOnline: false, rawRequest: req, rawResponse: res });
      } catch (e) {
        console.error('Auth begin error:', e);
        res.status(500).send('OAuth error: ' + e.message);
      }
    });

    // ── OAUTH: CALLBACK ─────────────────────────────────────
    app.get('/auth/callback', async (req, res) => {
      try {
        const callback = await shopify.auth.callback({ rawRequest: req, rawResponse: res });
        const session = callback.session;
        await shopify.sessionStorage.storeSession(session);
        console.log(`✅ Installed on ${session.shop}`);
        res.redirect(`/dashboard?shop=${session.shop}`);
      } catch (e) {
        console.error('Auth callback error:', e);
        res.status(500).send('OAuth callback error: ' + e.message);
      }
    });

    // ── DASHBOARD ───────────────────────────────────────────
    app.get('/dashboard', async (req, res) => {
      const shop = req.query.shop;
      if (!shop) return res.status(400).send('Missing shop parameter');
      const session = db.findSessionByShop(shop);
      if (!session || !session.accessToken) {
        return res.redirect(`/auth?shop=${shop}`);
      }
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px">
        <h1>🛡️ Dispute Shield</h1>
        <p>✅ Connected to <strong>${shop}</strong></p>
        <p>Scope: <code>${session.scope || 'N/A'}</code></p>
        <hr/>
        <h3>API Endpoint</h3>
        <p><code>POST /api/submit-dispute-evidence</code></p>
        <p>Header: <code>X-Internal-Secret: [your secret]</code></p>
        </body></html>
      `);
    });

    // ── SUBMIT DISPUTE EVIDENCE ────────────────────────────
    app.post('/api/submit-dispute-evidence', async (req, res) => {
      const secret = req.headers['x-internal-secret'];
      if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { shop, disputeId, evidence } = req.body;
      if (!shop || !disputeId) {
        return res.status(400).json({ error: 'Missing shop or disputeId' });
      }

      const session = db.findSessionByShop(shop);
      if (!session || !session.accessToken) {
        return res.status(403).json({ error: `No session for ${shop}. Install the app first.` });
      }

      const mutation = `
        mutation disputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceInput!) {
          disputeEvidenceUpdate(id: $id, input: $input) {
            disputeEvidence { submittedByMerchant }
            userErrors { field message }
          }
        }
      `;

      try {
        const client = new shopify.clients.Graphql({ session: new (require('@shopify/shopify-api').Session)(session) });
        const response = await client.query({
          data: {
            query: mutation,
            variables: {
              id: `gid://shopify/ShopifyPaymentsDispute/${disputeId}`,
              input: { ...evidence, submitForReview: true },
            },
          },
        });

        const result = response.body?.data?.disputeEvidenceUpdate;
        if (result?.userErrors?.length) {
          return res.status(422).json({ error: 'Shopify errors', details: result.userErrors });
        }
        return res.json({ ok: true, submitted: result?.disputeEvidence?.submittedByMerchant });
      } catch (e) {
        console.error('Evidence submit error:', e);
        return res.status(500).json({ error: e.message });
      }
    });

  } catch (initError) {
    console.error('❌ Shopify init failed:', initError.message);
    app.use((req, res) => res.status(500).json({ status: 'error', message: initError.message }));
  }

  app.listen(PORT, () => console.log(`🛡️ Dispute Shield on port ${PORT} | shop key: ${SHOPIFY_API_KEY.slice(0,8)}...`));
}
// v1741880000
