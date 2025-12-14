// routes/auth/xumm.js
// XUMM Authentication for Memeology + SSO bridge from WALDO stats dashboard
import express from 'express';
import { XummSdk } from 'xumm-sdk';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { redis } from '../../redisClient.js';

dotenv.config();

const router = express.Router();

// Initialize XUMM SDK (only if valid keys are available)
let xummClient = null;
const hasValidKeys = process.env.XUMM_API_KEY &&
                     process.env.XUMM_API_SECRET &&
                     !process.env.XUMM_API_KEY.startsWith('00000000');

if (hasValidKeys) {
  try {
    xummClient = new XummSdk(
      process.env.XUMM_API_KEY,
      process.env.XUMM_API_SECRET
    );
    console.log('✅ XUMM auth client initialized');
  } catch (error) {
    console.warn('⚠️  XUMM auth client initialization failed:', error.message);
  }
} else {
  console.warn('⚠️  XUMM auth disabled (missing or dummy API keys)');
}

// Store for active login sessions (in production, use Redis)
const loginSessions = new Map();

// TTL for SSO tokens (seconds). Short-lived, single-use tokens used when
// a user clicks "Open Memeology" from the WALDO stats dashboard.
const SSO_TOKEN_TTL_SECONDS = 10 * 60; // 10 minutes

// POST /api/auth/xumm/login - Create XUMM login payload
router.post('/login', async (req, res) => {
  if (!xummClient) {
    return res.status(503).json({
      success: false,
      error: 'XUMM authentication is not available (API keys not configured)'
    });
  }

  try {
    console.log('🔐 Creating XUMM login payload for Memeology...');

    const payload = {
      txjson: {
        TransactionType: 'SignIn'
      },
      options: {
        submit: false,
        expire: 300, // 5 minutes
        return_url: {
          web: 'https://memeology.fun',
          app: 'xaman://xaman.app/done'
        }
      },
      custom_meta: {
        identifier: 'MEMEOLOGY_LOGIN',
        instruction: 'Sign in to Memeology.fun'
      }
    };

    const created = await xummClient.payload.create(payload);

    // Build the deep link URI - XUMM SDK may return it in different places
    // or we can construct it from the UUID
    const deepLink = created.refs?.qr_uri ||
                     created.next?.always ||
                     `https://xumm.app/sign/${created.uuid}`;

    console.log('✅ XUMM login payload created:', {
      uuid: created.uuid,
      qr_png: created.refs?.qr_png,
      qr_uri: deepLink,
      refs: JSON.stringify(created.refs),
      next: JSON.stringify(created.next)
    });

    // Store session
    loginSessions.set(created.uuid, {
      created: Date.now(),
      signed: false,
      account: null
    });

    res.json({
      success: true,
      uuid: created.uuid,
      qr_url: created.refs?.qr_png,
      qr_uri: deepLink,
      websocket: created.refs?.websocket_status
    });

  } catch (error) {
    console.error('❌ Error creating XUMM login payload:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/auth/xumm/sso - Create a short-lived SSO token that lets an
// already-authenticated WALDO stats user hop into Memeology without scanning
// another QR. The stats dashboard calls this with the connected wallet and
// then redirects to memeology.fun/?sso=<token>.
router.post('/sso', async (req, res) => {
  try {
    const { wallet } = req.body || {};

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ success: false, error: 'wallet required' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    // Store token -> wallet mapping in Redis with a short TTL. We only need
    // the wallet here; Memeology will call its own tier endpoints.
    await redis.setEx(`sso:${token}`, SSO_TOKEN_TTL_SECONDS, JSON.stringify({ wallet }));

    res.json({ success: true, token });
  } catch (error) {
    console.error('❌ Error creating SSO token:', error);
    res.status(500).json({ success: false, error: 'Failed to create SSO token' });
  }
});

// GET /api/auth/xumm/sso/verify?token=... - Consume an SSO token and return
// the associated wallet to Memeology. Tokens are single-use for safety.
router.get('/sso/verify', async (req, res) => {
  try {
    const { token } = req.query || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'token required' });
    }

    const key = `sso:${token}`;
    const stored = await redis.get(key);

    if (!stored) {
      return res.json({ success: false, error: 'Invalid or expired token' });
    }

    // Single-use: delete immediately after reading.
    await redis.del(key);

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch (e) {
      console.error('❌ Failed to parse SSO token payload:', e);
      return res.status(500).json({ success: false, error: 'Corrupted SSO token payload' });
    }

    const wallet = parsed.wallet;
    if (!wallet || typeof wallet !== 'string') {
      return res.status(500).json({ success: false, error: 'SSO token missing wallet' });
    }

    res.json({ success: true, wallet });
  } catch (error) {
    console.error('❌ Error verifying SSO token:', error);
    res.status(500).json({ success: false, error: 'Failed to verify SSO token' });
  }
});

// GET /api/auth/xumm/status - Check login status
router.get('/status', async (req, res) => {
  if (!xummClient) {
    return res.status(503).json({
      success: false,
      error: 'XUMM authentication is not available'
    });
  }

  try {
    const { uuid } = req.query;

    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: 'UUID required'
      });
    }

    // Check if session exists
    const session = loginSessions.get(uuid);
    if (!session) {
      return res.json({
        success: false,
        error: 'Session not found or expired'
      });
    }

    // If already signed, return cached result
    if (session.signed) {
      return res.json({
        success: true,
        signed: true,
        account: session.account
      });
    }

    // Check XUMM payload status
    const payload = await xummClient.payload.get(uuid);

    if (payload.meta.signed) {
      // Update session
      session.signed = true;
      session.account = payload.response.account;
      loginSessions.set(uuid, session);

      console.log('✅ User signed in:', payload.response.account);

      return res.json({
        success: true,
        signed: true,
        account: payload.response.account
      });
    }

    if (payload.meta.expired) {
      loginSessions.delete(uuid);
      return res.json({
        success: false,
        expired: true
      });
    }

    if (payload.meta.cancelled || payload.meta.rejected) {
      loginSessions.delete(uuid);
      return res.json({
        success: false,
        rejected: true
      });
    }

    // Still pending
    res.json({
      success: true,
      signed: false,
      pending: true
    });

  } catch (error) {
    console.error('❌ Error checking XUMM status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/auth/xumm/create-payload - Create generic XUMM payment payload
// Used by PremiumModal for subscription payments
router.post('/create-payload', async (req, res) => {
  if (!xummClient) {
    return res.status(503).json({
      success: false,
      error: 'XUMM is not available (API keys not configured)'
    });
  }

  try {
    const { txjson, options, custom_meta } = req.body;

    if (!txjson) {
      return res.status(400).json({
        success: false,
        error: 'txjson is required'
      });
    }

    console.log('💳 Creating XUMM payment payload:', txjson.TransactionType);

    const payload = {
      txjson,
      options: {
        submit: true,
        expire: 300, // 5 minutes
        return_url: {
          app: 'xumm://xumm.app/done',
          web: options?.return_url?.web || null
        },
        ...options
      },
      custom_meta
    };

    const created = await xummClient.payload.create(payload);

    // Build the deep link URI
    const deepLink = created.refs?.qr_uri ||
                     created.next?.always ||
                     `https://xumm.app/sign/${created.uuid}`;

    console.log('✅ XUMM payment payload created:', {
      uuid: created.uuid,
      deepLink
    });

    res.json({
      success: true,
      uuid: created.uuid,
      refs: {
        qr_png: created.refs?.qr_png,
        qr_uri: deepLink,
        websocket_status: created.refs?.websocket_status
      },
      next: created.next
    });

  } catch (error) {
    console.error('❌ Error creating XUMM payload:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/auth/xumm/payload/:uuid - Get payload status
// Used by PremiumModal to check payment status
router.get('/payload/:uuid', async (req, res) => {
  if (!xummClient) {
    return res.status(503).json({
      success: false,
      error: 'XUMM is not available'
    });
  }

  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: 'UUID is required'
      });
    }

    const payload = await xummClient.payload.get(uuid);

    res.json({
      success: true,
      meta: payload.meta,
      response: payload.response
    });

  } catch (error) {
    console.error('❌ Error getting XUMM payload:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

