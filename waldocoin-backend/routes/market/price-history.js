// routes/market/price-history.js
import express from "express";
import { redis } from "../../redisClient.js";
import { getXRPPrice, getWLOPrice } from "../../utils/priceOracle.js";

const router = express.Router();

// Helper to store current price to history (called automatically)
async function storeCurrentPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate) {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentHour = now.getUTCHours();

    // Get existing history
    let history = [];
    try {
      const stored = await redis.get('price:history:30d');
      if (stored) {
        history = JSON.parse(stored);
      }
    } catch (e) {
      history = [];
    }

    // Check if we already have a data point for today
    const todayIndex = history.findIndex(h => h.date === today);

    const newPoint = {
      timestamp: now.toISOString(),
      usdPrice: parseFloat(waldoUsdPrice.toFixed(8)),
      xrpPrice: parseFloat(xrpPerWlo.toFixed(8)),
      xrpUsdPrice: parseFloat(xrpUsdRate.toFixed(4)),
      date: today
    };

    if (todayIndex >= 0) {
      // Update today's price (use latest price for the day)
      history[todayIndex] = newPoint;
    } else {
      // Add new day
      history.push(newPoint);
    }

    // Keep only last 30 days
    if (history.length > 30) {
      history = history.slice(-30);
    }

    // Store back to Redis (expires in 35 days)
    await redis.set('price:history:30d', JSON.stringify(history), { EX: 60 * 60 * 24 * 35 });

    console.log(`📊 Price auto-stored: ${history.length} days of history`);
    return history;
  } catch (e) {
    console.error('Error auto-storing price:', e);
    return null;
  }
}

// GET /api/market/price-history?days=7
router.get("/", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const maxDays = 30;
    const requestedDays = Math.min(days, maxDays);

    // Get REAL current prices from GeckoTerminal/CoinGecko
    const [waldoUsdPrice, xrpUsdRate] = await Promise.all([
      getWLOPrice(),
      getXRPPrice()
    ]);

    const xrpPerWlo = xrpUsdRate > 0 ? (waldoUsdPrice / xrpUsdRate) : 0;

    console.log(`📊 Price History: WLO=$${waldoUsdPrice.toFixed(8)}, XRP=$${xrpUsdRate.toFixed(4)}`);

    // Auto-store current price to build history over time
    const updatedHistory = await storeCurrentPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate);

    // Get stored historical data from Redis
    let history = [];
    try {
      const storedHistory = await redis.get('price:history:30d');
      if (storedHistory) {
        history = JSON.parse(storedHistory);
      }
    } catch (e) {
      console.log('No stored price history');
    }

    // If we have stored history, use it
    if (history.length > 0) {
      // Get the last N days requested
      const slicedHistory = history.slice(-requestedDays);

      return res.json({
        success: true,
        current: {
          xrpPrice: xrpPerWlo.toFixed(8),
          usdPrice: waldoUsdPrice.toFixed(8),
          xrpUsdRate: xrpUsdRate.toFixed(4)
        },
        history: slicedHistory,
        days: requestedDays,
        actualDays: slicedHistory.length,
        source: 'redis',
        timestamp: new Date().toISOString()
      });
    }

    // Fallback: if no history yet, create starting point with current price only
    // (no random variation - chart will build up over time)
    const now = new Date();
    const fallbackHistory = [{
      timestamp: now.toISOString(),
      usdPrice: parseFloat(waldoUsdPrice.toFixed(8)),
      xrpPrice: parseFloat(xrpPerWlo.toFixed(8)),
      xrpUsdPrice: parseFloat(xrpUsdRate.toFixed(4)),
      date: now.toISOString().split('T')[0]
    }];

    res.json({
      success: true,
      current: {
        xrpPrice: xrpPerWlo.toFixed(8),
        usdPrice: waldoUsdPrice.toFixed(8),
        xrpUsdRate: xrpUsdRate.toFixed(4)
      },
      history: fallbackHistory,
      days: requestedDays,
      actualDays: 1,
      source: 'current_only',
      message: 'Historical data is being collected. Chart will build up over time.',
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

// POST /api/market/price-history/store - Manual store (for cron job if needed)
router.post("/store", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const [waldoUsdPrice, xrpUsdRate] = await Promise.all([
      getWLOPrice(),
      getXRPPrice()
    ]);

    const xrpPerWlo = xrpUsdRate > 0 ? (waldoUsdPrice / xrpUsdRate) : 0;
    const history = await storeCurrentPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate);

    res.json({
      success: true,
      message: "Price history updated",
      totalPoints: history ? history.length : 0
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

