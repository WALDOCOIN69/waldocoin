// routes/auth/xumm.js
// XUMM Authentication for Memeology
import express from 'express';
import { XummSdk } from 'xumm-sdk';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Initialize XUMM SDK
const xummClient = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

// Store for active login sessions (in production, use Redis)
const loginSessions = new Map();

// POST /api/auth/xumm/login - Create XUMM login payload
router.post('/login', async (req, res) => {
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

    console.log('✅ XUMM login payload created:', {
      uuid: created.uuid,
      qr_png: created.refs.qr_png,
      qr_uri: created.refs.qr_uri
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
      qr_url: created.refs.qr_png,
      qr_uri: created.refs.qr_uri,
      websocket: created.refs.websocket_status
    });

  } catch (error) {
    console.error('❌ Error creating XUMM login payload:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/auth/xumm/status - Check login status
router.get('/status', async (req, res) => {
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

export default router;

