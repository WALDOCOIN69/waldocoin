// routes/presaleLookup.js (ESM Version)
import express from 'express';
import { redis } from '../redisClient.js'; 
const router = express.Router();

router.get('/lookup', async (req, res) => {
  const wallet = req.query.wallet;

  if (!wallet || !wallet.startsWith('r')) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }

  try {
    const data = await redis.hgetall(`presale:${wallet}`);
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: 'No presale record found.' });
    }

    res.json({
      wallet,
      amount: parseInt(data.amount) || 0,
      tokens: parseInt(data.tokens) || 0,
      timestamp: data.timestamp || null,
      email: data.email || null,
      bonusTier: data.bonusTier || null
    });
  } catch (err) {
    console.error("Redis lookup error:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

