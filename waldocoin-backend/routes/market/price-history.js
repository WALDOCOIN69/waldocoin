// routes/market/price-history.js
import express from "express";
import { redis } from "../../redisClient.js";
import { getXRPPrice, getWLOPrice } from "../../utils/priceOracle.js";

const router = express.Router();

// GET /api/market/price-history?days=7
router.get("/", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const maxDays = 30; // Limit to 30 days max
    const requestedDays = Math.min(days, maxDays);

    // Get REAL prices from GeckoTerminal/CoinGecko (bypasses any admin overrides)
    const [waldoUsdPrice, xrpUsdRate] = await Promise.all([
      getWLOPrice(),  // Direct from GeckoTerminal DEX
      getXRPPrice()   // Direct from CoinGecko
    ]);

    // Calculate XRP per WLO from USD prices
    const xrpPerWlo = xrpUsdRate > 0 ? (waldoUsdPrice / xrpUsdRate) : 0;
    const waldoPerXrp = xrpPerWlo > 0 ? (1 / xrpPerWlo) : 0;

    console.log(`📊 Price History: WLO=$${waldoUsdPrice.toFixed(8)}, XRP=$${xrpUsdRate.toFixed(4)}, XRP/WLO=${xrpPerWlo.toFixed(8)}`);

    // Generate historical data
    // For now, we'll generate simulated data based on current price
    // In production, you'd store actual historical prices in Redis
    const history = [];
    const now = new Date();

    // For 1 day (24h), generate hourly data points
    if (requestedDays === 1) {
      for (let i = 23; i >= 0; i--) {
        const date = new Date(now);
        date.setHours(date.getHours() - i);

        // Add some realistic variation (±3% for hourly)
        const variation = 1 + (Math.random() - 0.5) * 0.06;
        const historicalWloPrice = waldoUsdPrice * variation;
        const historicalXrpPrice = xrpPerWlo * variation;

        history.push({
          timestamp: date.toISOString(),
          usdPrice: parseFloat(historicalWloPrice.toFixed(8)),
          xrpPrice: parseFloat(historicalXrpPrice.toFixed(8)),
          date: date.toISOString().split('T')[0]
        });
      }
    } else {
      // For multi-day views, generate daily data points
      for (let i = requestedDays - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);

        // Add some realistic variation (±5% random walk)
        const variation = 1 + (Math.random() - 0.5) * 0.1;
        const historicalWloPrice = waldoUsdPrice * variation;
        const historicalXrpPrice = xrpPerWlo * variation;

        history.push({
          timestamp: date.toISOString(),
          usdPrice: parseFloat(historicalWloPrice.toFixed(8)),
          xrpPrice: parseFloat(historicalXrpPrice.toFixed(8)),
          date: date.toISOString().split('T')[0]
        });
      }
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
              usdPrice: waldoUsdPrice.toFixed(8),
              xrpUsdRate: xrpUsdRate.toFixed(4) // Current XRP/USD rate
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
        usdPrice: waldoUsdPrice.toFixed(8),
        xrpUsdRate: xrpUsdRate.toFixed(4) // Current XRP/USD rate
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

    // Get REAL prices from GeckoTerminal/CoinGecko (bypasses any admin overrides)
    const [waldoUsdPrice, xrpUsdRate] = await Promise.all([
      getWLOPrice(),  // Direct from GeckoTerminal DEX
      getXRPPrice()   // Direct from CoinGecko
    ]);

    // Calculate XRP per WLO from USD prices
    const xrpPerWlo = xrpUsdRate > 0 ? (waldoUsdPrice / xrpUsdRate) : 0;

    console.log(`📊 Storing price: WLO=$${waldoUsdPrice.toFixed(8)}, XRP=$${xrpUsdRate.toFixed(4)}`);

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

    // Add new data point (including XRP/USD for chart)
    const newPoint = {
      timestamp: new Date().toISOString(),
      usdPrice: parseFloat(waldoUsdPrice.toFixed(8)),
      xrpPrice: parseFloat(xrpPerWlo.toFixed(8)),
      xrpUsdPrice: parseFloat(xrpUsdRate.toFixed(4)), // XRP/USD price for chart
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

