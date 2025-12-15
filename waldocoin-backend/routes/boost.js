import express from 'express';
import { redis } from '../redisClient.js';
import { xummClient } from '../utils/xummClient.js';
import { WALDO_ISSUER, TREASURY_WALLET } from '../constants.js';

const router = express.Router();

const BOOST_DESTINATION = TREASURY_WALLET || process.env.DISTRIBUTOR_WALLET;
const CURRENCY = 'WLO';

// Boost pricing: WALDO per month
const BOOST_PRICES = {
  1: 250000,   // 1 month
  2: 450000,   // 2 months (10% off)
  3: 600000    // 3 months (20% off)
};

// GET /api/boost/status/:wallet - Get current boost status
router.get('/status/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: 'Invalid wallet' });
    }

    const boostData = await redis.hGetAll(`boost:${wallet}`);
    
    if (!boostData || !boostData.endDate) {
      return res.json({ 
        success: true, 
        boost: { active: false } 
      });
    }

    const endDate = new Date(boostData.endDate);
    const active = endDate > new Date();

    res.json({
      success: true,
      boost: {
        active,
        endDate: boostData.endDate,
        months: parseInt(boostData.months || 0),
        purchasedAt: boostData.purchasedAt
      }
    });

  } catch (error) {
    console.error('❌ Error getting boost status:', error);
    res.status(500).json({ success: false, error: 'Failed to get boost status' });
  }
});

// POST /api/boost/purchase - Initiate XP boost purchase
router.post('/purchase', async (req, res) => {
  try {
    const { wallet, months, amount } = req.body;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: 'Invalid wallet' });
    }

    if (!months || !BOOST_PRICES[months]) {
      return res.status(400).json({ success: false, error: 'Invalid boost duration' });
    }

    const expectedAmount = BOOST_PRICES[months];
    if (amount !== expectedAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid amount. Expected ${expectedAmount} for ${months} month(s)` 
      });
    }

    console.log(`⚡ Creating boost purchase: ${wallet} - ${months} months for ${amount} WALDO`);

    // Create XUMM payment payload
    const payload = {
      txjson: {
        TransactionType: 'Payment',
        Destination: BOOST_DESTINATION,
        Amount: {
          currency: CURRENCY,
          issuer: WALDO_ISSUER,
          value: String(amount)
        },
        Memos: [{
          Memo: {
            MemoType: Buffer.from('XP_BOOST').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`${months}M:${wallet.slice(-8)}`).toString('hex').toUpperCase()
          }
        }]
      },
      options: {
        submit: true,
        expire: 600, // 10 minutes
        return_url: {
          app: 'xumm://xumm.app/done',
          web: null
        }
      },
      custom_meta: {
        identifier: `BOOST:${wallet.slice(-8)}:${months}M`,
        instruction: `Pay ${amount.toLocaleString()} WALDO for ${months} month XP boost`
      }
    };

    const created = await xummClient.payload.create(payload);

    // Store pending boost purchase
    await redis.hSet(`boost:pending:${created.uuid}`, {
      wallet,
      months: String(months),
      amount: String(amount),
      createdAt: new Date().toISOString()
    });
    await redis.expire(`boost:pending:${created.uuid}`, 900); // 15 minute expiry

    console.log(`✅ Boost payment created: ${created.uuid}`);

    res.json({
      success: true,
      uuid: created.uuid,
      qr: created.refs.qr_png,
      deepLink: created.next.always
    });

  } catch (error) {
    console.error('❌ Error creating boost purchase:', error);
    res.status(500).json({ success: false, error: 'Failed to create boost payment' });
  }
});

// GET /api/boost/confirm/:uuid - Confirm boost payment
router.get('/confirm/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;

    // Get pending purchase
    const pending = await redis.hGetAll(`boost:pending:${uuid}`);
    if (!pending || !pending.wallet) {
      return res.json({ success: false, error: 'Payment not found or expired' });
    }

    // Check XUMM payload status
    const payload = await xummClient.payload.get(uuid);

    if (!payload) {
      return res.json({ success: false, confirmed: false, status: 'not_found' });
    }

    if (payload.meta.signed === false) {
      return res.json({ success: false, confirmed: false, status: 'rejected' });
    }

    if (payload.meta.signed === true && payload.meta.resolved) {
      // Payment confirmed! Activate boost
      const wallet = pending.wallet;
      const months = parseInt(pending.months);

      // Calculate end date
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + months);

      // Store active boost
      await redis.hSet(`boost:${wallet}`, {
        active: 'true',
        months: String(months),
        endDate: endDate.toISOString(),
        purchasedAt: new Date().toISOString(),
        txHash: payload.response?.txid || uuid
      });

      // Clean up pending
      await redis.del(`boost:pending:${uuid}`);

      console.log(`🚀 Boost activated: ${wallet} - ${months} months until ${endDate.toISOString()}`);

      return res.json({ 
        success: true, 
        confirmed: true, 
        wallet,
        months,
        endDate: endDate.toISOString()
      });
    }

    // Still pending
    res.json({ success: true, confirmed: false, status: 'pending' });

  } catch (error) {
    console.error('❌ Error confirming boost:', error);
    res.status(500).json({ success: false, error: 'Failed to confirm boost' });
  }
});

export default router;

