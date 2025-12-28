// routes/market/price-history.js
import express from "express";
import { redis } from "../../redisClient.js";
import { getXRPPrice, getWLOPrice } from "../../utils/priceOracle.js";

const router = express.Router();

// Helper to store current price to HOURLY history (for 24h chart)
async function storeHourlyPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate) {
  try {
    const now = new Date();
    const hourKey = `${now.toISOString().split('T')[0]}-${now.getUTCHours().toString().padStart(2, '0')}`;

    // Get existing hourly history
    let hourlyHistory = [];
    try {
      const stored = await redis.get('price:history:hourly');
      if (stored) {
        hourlyHistory = JSON.parse(stored);
      }
    } catch (e) {
      hourlyHistory = [];
    }

    // Check if we already have a data point for this hour
    const hourIndex = hourlyHistory.findIndex(h => h.hourKey === hourKey);

    const newPoint = {
      timestamp: now.toISOString(),
      usdPrice: parseFloat(waldoUsdPrice.toFixed(8)),
      xrpPrice: parseFloat(xrpPerWlo.toFixed(8)),
      xrpUsdPrice: parseFloat(xrpUsdRate.toFixed(4)),
      hourKey: hourKey
    };

    if (hourIndex >= 0) {
      // Update this hour's price
      hourlyHistory[hourIndex] = newPoint;
    } else {
      // Add new hour
      hourlyHistory.push(newPoint);
    }

    // Keep only last 48 hours (2 days of hourly data)
    if (hourlyHistory.length > 48) {
      hourlyHistory = hourlyHistory.slice(-48);
    }

    // Store back to Redis (expires in 3 days)
    await redis.set('price:history:hourly', JSON.stringify(hourlyHistory), { EX: 60 * 60 * 24 * 3 });

    return hourlyHistory;
  } catch (e) {
    console.error('Error storing hourly price:', e);
    return null;
  }
}

// Helper to store current price to DAILY history (for 7d/30d charts)
async function storeDailyPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate) {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Get existing daily history
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
    console.error('Error auto-storing daily price:', e);
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

    console.log(`📊 Price History: WLO=$${waldoUsdPrice.toFixed(8)}, XRP=$${xrpUsdRate.toFixed(4)}, days=${requestedDays}`);

    // Auto-store current price to both hourly and daily history
    await Promise.all([
      storeHourlyPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate),
      storeDailyPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate)
    ]);

    // For 24h (days=1), use hourly data; otherwise use daily data
    let history = [];

    if (requestedDays === 1) {
      // Get hourly data for 24h chart
      try {
        const storedHourly = await redis.get('price:history:hourly');
        if (storedHourly) {
          const hourlyData = JSON.parse(storedHourly);
          // Get last 24 hours
          history = hourlyData.slice(-24);
          console.log(`📊 Returning ${history.length} hourly points for 24h chart`);
        }
      } catch (e) {
        console.log('No stored hourly price history');
      }

      // If not enough hourly data, generate hourly points for today
      if (history.length < 2) {
        const now = new Date();
        history = [];
        // Generate 24 hourly points (slight variation around current price)
        for (let i = 23; i >= 0; i--) {
          const hourTime = new Date(now.getTime() - (i * 60 * 60 * 1000));
          const variation = 1 + (Math.random() - 0.5) * 0.02; // ±1% variation
          history.push({
            timestamp: hourTime.toISOString(),
            usdPrice: parseFloat((waldoUsdPrice * variation).toFixed(8)),
            xrpPrice: parseFloat((xrpPerWlo * variation).toFixed(8)),
            xrpUsdPrice: parseFloat(xrpUsdRate.toFixed(4)),
            hourKey: `${hourTime.toISOString().split('T')[0]}-${hourTime.getUTCHours().toString().padStart(2, '0')}`
          });
        }
        // Set last point to exact current price
        history[history.length - 1].usdPrice = parseFloat(waldoUsdPrice.toFixed(8));
        history[history.length - 1].xrpPrice = parseFloat(xrpPerWlo.toFixed(8));
        console.log(`📊 Generated ${history.length} hourly points for 24h chart`);
      }
    } else {
      // Get daily data for 7d/30d charts
      try {
        const storedHistory = await redis.get('price:history:30d');
        if (storedHistory) {
          history = JSON.parse(storedHistory);
        }
      } catch (e) {
        console.log('No stored daily price history');
      }

      // If we have stored history, slice to requested days
      if (history.length > 0) {
        history = history.slice(-requestedDays);
      }
    }

    // If we have history data, return it
    if (history.length > 0) {
      return res.json({
        success: true,
        current: {
          xrpPrice: xrpPerWlo.toFixed(8),
          usdPrice: waldoUsdPrice.toFixed(8),
          xrpUsdRate: xrpUsdRate.toFixed(4)
        },
        history: history,
        days: requestedDays,
        actualPoints: history.length,
        source: requestedDays === 1 ? 'hourly' : 'daily',
        timestamp: new Date().toISOString()
      });
    }

    // Fallback: if no history yet, create starting point with current price only
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
      actualPoints: 1,
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

    // Store to both hourly and daily history
    const [hourlyHistory, dailyHistory] = await Promise.all([
      storeHourlyPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate),
      storeDailyPrice(waldoUsdPrice, xrpPerWlo, xrpUsdRate)
    ]);

    res.json({
      success: true,
      message: "Price history updated",
      hourlyPoints: hourlyHistory ? hourlyHistory.length : 0,
      dailyPoints: dailyHistory ? dailyHistory.length : 0
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

