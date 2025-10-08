// routes/market/price-history.js
import express from "express";
import { redis } from "../../redisClient.js";
import getWaldoPerXrp from "../../utils/getWaldoPerXrp.js";
import fetch from "node-fetch";

const router = express.Router();

// GET /api/market/price-history?days=7
router.get("/", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const maxDays = 30; // Limit to 30 days max
    const requestedDays = Math.min(days, maxDays);

    // Get current price from /api/market/wlo (same source as exchange widget)
    let xrpPerWlo = 0;
    let waldoPerXrp = 0;

    try {
      const baseURL = process.env.BASE_URL || 'https://waldocoin-backend-api.onrender.com';
      const marketRes = await fetch(`${baseURL}/api/market/wlo`);
      const marketData = await marketRes.json();

      if (marketData.success && marketData.xrpPerWlo) {
        xrpPerWlo = marketData.xrpPerWlo;
        waldoPerXrp = marketData.waldoPerXrp || (1 / xrpPerWlo);
      }
    } catch (e) {
      console.warn('Failed to fetch from /api/market/wlo, using fallback:', e.message);
    }

    // Fallback: try getWaldoPerXrp but ignore 10000 default
    if (xrpPerWlo === 0) {
      waldoPerXrp = await getWaldoPerXrp();
      // Ignore the 10000 fallback (presale rate) - it's not real market price
      if (waldoPerXrp === 10000) {
        waldoPerXrp = 0;
      }
      xrpPerWlo = waldoPerXrp > 0 ? (1 / waldoPerXrp) : 0;
    }

    // Get XRP/USD rate (approximate)
    const xrpUsdRate = 0.50; // Approximate XRP price in USD (could fetch from external API)
    const waldoUsdPrice = xrpPerWlo * xrpUsdRate;

    // Generate historical data
    // For now, we'll generate simulated data based on current price
    // In production, you'd store actual historical prices in Redis
    const history = [];
    const now = new Date();

    for (let i = requestedDays - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);

      // Add some realistic variation (±5% random walk)
      const variation = 1 + (Math.random() - 0.5) * 0.1; // ±5% variation
      const historicalPrice = waldoUsdPrice * variation;
      const historicalXrpPrice = xrpPerWlo * variation;

      history.push({
        timestamp: date.toISOString(),
        usdPrice: parseFloat(historicalPrice.toFixed(8)),
        xrpPrice: parseFloat(historicalXrpPrice.toFixed(8)),
        date: date.toISOString().split('T')[0]
      });
    }

    // Try to get stored historical data from Redis (if available)
    try {
      const storedHistory = await redis.get('price:history:7d');
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          // Use stored data if available
          return res.json({
            success: true,
            current: {
              xrpPrice: xrpPerWlo.toFixed(8),
              usdPrice: waldoUsdPrice.toFixed(8)
            },
            history: parsed.slice(-requestedDays),
            days: requestedDays,
            source: 'redis',
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (e) {
      console.log('No stored price history, using generated data');
    }

    // Return generated data
    res.json({
      success: true,
      current: {
        xrpPrice: xrpPerWlo.toFixed(8),
        usdPrice: waldoUsdPrice.toFixed(8)
      },
      history: history,
      days: requestedDays,
      source: 'generated',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fetching price history:', error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch price history",
      message: error.message
    });
  }
});

// POST /api/market/price-history/store - Store current price (called by cron job)
router.post("/store", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    // Get current price
    const waldoPerXrp = await getWaldoPerXrp();
    const xrpPerWlo = waldoPerXrp > 0 ? (1 / waldoPerXrp) : 0;
    const xrpUsdRate = 0.50; // Approximate
    const waldoUsdPrice = xrpPerWlo * xrpUsdRate;

    // Get existing history
    let history = [];
    try {
      const stored = await redis.get('price:history:7d');
      if (stored) {
        history = JSON.parse(stored);
      }
    } catch (e) {
      history = [];
    }

    // Add new data point
    const newPoint = {
      timestamp: new Date().toISOString(),
      usdPrice: parseFloat(waldoUsdPrice.toFixed(8)),
      xrpPrice: parseFloat(xrpPerWlo.toFixed(8)),
      date: new Date().toISOString().split('T')[0]
    };

    history.push(newPoint);

    // Keep only last 30 days
    if (history.length > 30) {
      history = history.slice(-30);
    }

    // Store back to Redis
    await redis.set('price:history:7d', JSON.stringify(history));

    res.json({
      success: true,
      message: "Price history updated",
      dataPoint: newPoint,
      totalPoints: history.length
    });

  } catch (error) {
    console.error('❌ Error storing price history:', error);
    res.status(500).json({
      success: false,
      error: "Failed to store price history"
    });
  }
});

export default router;

