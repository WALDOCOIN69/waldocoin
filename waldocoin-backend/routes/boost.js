import express from 'express';
import { redis } from '../redisClient.js';
import { xummClient } from '../utils/xummClient.js';
import { WALDO_ISSUER, TREASURY_WALLET } from '../constants.js';
import { getXRPPrice, getWLOPrice } from '../utils/priceOracle.js';

const router = express.Router();

const BOOST_DESTINATION = TREASURY_WALLET || process.env.DISTRIBUTOR_WALLET;

// Boost pricing in USD (fixed USD prices)
const BOOST_PRICES_USD = {
  1: 3.75,    // 1 month
  2: 6.75,    // 2 months (10% off)
  3: 9.00     // 3 months (20% off)
};

// Price tolerance for validation (10% to account for price fluctuations during payment)
const PRICE_TOLERANCE = 0.10;

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

// GET /api/boost/prices - Get current dynamic prices for XP boost
router.get('/prices', async (req, res) => {
  try {
    // Get current prices from oracles
    const [wloPrice, xrpPrice] = await Promise.all([
      getWLOPrice(),
      getXRPPrice()
    ]);

    console.log(`💰 Boost prices: WLO=$${wloPrice}, XRP=$${xrpPrice}`);

    // Calculate token amounts for each tier
    const prices = {};
    for (const [months, usdPrice] of Object.entries(BOOST_PRICES_USD)) {
      const wloAmount = Math.ceil(usdPrice / wloPrice);
      const xrpAmount = Math.ceil((usdPrice / xrpPrice) * 100) / 100; // Round to 2 decimals

      prices[months] = {
        usd: usdPrice,
        wlo: wloAmount,
        xrp: xrpAmount
      };
    }

    res.json({
      success: true,
      prices,
      rates: {
        wloUsd: wloPrice,
        xrpUsd: xrpPrice
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting boost prices:', error);
    res.status(500).json({ success: false, error: 'Failed to get boost prices' });
  }
});

// POST /api/boost/purchase - Initiate XP boost purchase (supports WALDO and XRP)
router.post('/purchase', async (req, res) => {
  try {
    const { wallet, months, amount, currency = 'WLO' } = req.body;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: 'Invalid wallet' });
    }

    if (!months || !BOOST_PRICES_USD[months]) {
      return res.status(400).json({ success: false, error: 'Invalid boost duration' });
    }

    const validCurrencies = ['WLO', 'XRP'];
    if (!validCurrencies.includes(currency.toUpperCase())) {
      return res.status(400).json({ success: false, error: 'Invalid currency. Use WLO or XRP' });
    }

    // Get current prices to validate amount
    const [wloPrice, xrpPrice] = await Promise.all([
      getWLOPrice(),
      getXRPPrice()
    ]);

    const usdPrice = BOOST_PRICES_USD[months];
    let expectedAmount, minAmount, maxAmount;

    if (currency.toUpperCase() === 'XRP') {
      expectedAmount = Math.ceil((usdPrice / xrpPrice) * 100) / 100;
      minAmount = expectedAmount * (1 - PRICE_TOLERANCE);
      maxAmount = expectedAmount * (1 + PRICE_TOLERANCE);
    } else {
      expectedAmount = Math.ceil(usdPrice / wloPrice);
      minAmount = expectedAmount * (1 - PRICE_TOLERANCE);
      maxAmount = expectedAmount * (1 + PRICE_TOLERANCE);
    }

    // Validate amount is within tolerance
    if (amount < minAmount || amount > maxAmount) {
      return res.status(400).json({
        success: false,
        error: `Invalid amount. Expected ~${expectedAmount} ${currency} (±10%)`
      });
    }

    console.log(`⚡ Creating boost purchase: ${wallet} - ${months} months for ${amount} ${currency}`);

    // Build payment Amount based on currency
    let paymentAmount;
    if (currency.toUpperCase() === 'XRP') {
      // XRP amount in drops (1 XRP = 1,000,000 drops)
      paymentAmount = String(Math.round(amount * 1000000));
    } else {
      // WALDO token payment
      paymentAmount = {
        currency: 'WLO',
        issuer: WALDO_ISSUER,
        value: String(amount)
      };
    }

    // Create XUMM payment payload
    const payload = {
      txjson: {
        TransactionType: 'Payment',
        Destination: BOOST_DESTINATION,
        Amount: paymentAmount,
        Memos: [{
          Memo: {
            MemoType: Buffer.from('XP_BOOST').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`${months}M:${currency}:${wallet.slice(-8)}`).toString('hex').toUpperCase()
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
        identifier: `BOOST:${wallet.slice(-8)}:${months}M:${currency}`,
        instruction: `Pay ${currency === 'XRP' ? amount.toFixed(2) : amount.toLocaleString()} ${currency} for ${months} month XP boost`
      }
    };

    const created = await xummClient.payload.create(payload);

    // Store pending boost purchase
    await redis.hSet(`boost:pending:${created.uuid}`, {
      wallet,
      months: String(months),
      amount: String(amount),
      currency: currency.toUpperCase(),
      createdAt: new Date().toISOString()
    });
    await redis.expire(`boost:pending:${created.uuid}`, 900); // 15 minute expiry

    console.log(`✅ Boost payment created: ${created.uuid}`);

    res.json({
      success: true,
      uuid: created.uuid,
      qr: created.refs.qr_png,
      deepLink: created.next.always,
      currency: currency.toUpperCase(),
      amount
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

