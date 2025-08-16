// routes/admin/volumeBot.js
import express from "express";
import dotenv from "dotenv";
import Redis from "ioredis";

dotenv.config();

const router = express.Router();
const redis = new Redis(process.env.REDIS_URL);

console.log("🧩 Loaded: routes/admin/volumeBot.js");

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
};

// GET /api/admin/volume-bot/status - Get bot status and metrics
router.get("/status", requireAdmin, async (req, res) => {
  try {
    // Get bot status from Redis
    const botStatus = await redis.get('volume_bot:status') || 'Unknown';
    const lastTrade = await redis.get('volume_bot:last_trade');
    const tradesCount = await redis.get('volume_bot:trades_today') || '0';
    const volume24h = await redis.get('volume_bot:volume_24h') || '0';

    // Get current settings (include active trading mode)
    const settings = {
      frequency: await redis.get('volume_bot:frequency') || '60',
      tradingMode: await redis.get('volume_bot:trading_mode') || 'automated',
      minSize: await redis.get('volume_bot:min_trade_size') || '1',
      maxSize: await redis.get('volume_bot:max_trade_size') || '3',
      spread: await redis.get('volume_bot:price_spread') || '0'
    };

    // Get wallet balance from Redis cache or show loading
    const cachedBalance = await redis.get('volume_bot:wallet_balance');
    const balance = cachedBalance || "Loading wallet balance...";

    res.json({
      success: true,
      status: botStatus,
      balance: balance,
      tradesCount: tradesCount,
      volume24h: `${volume24h} XRP`,
      lastTrade: lastTrade,
      settings: settings
    });
  } catch (error) {
    console.error("❌ Error getting bot status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/volume-bot/settings - Update bot settings
router.post("/settings", requireAdmin, async (req, res) => {
  try {
    const { frequency, tradingMode, minTradeSize, maxTradeSize, priceSpread } = req.body;

    // Validate inputs - support new frequency options
    const validFrequencies = [5, 10, 15, 30, 45, 60, 120, 'random'];
    if (frequency && !validFrequencies.includes(frequency) && !validFrequencies.includes(parseInt(frequency))) {
      return res.status(400).json({
        success: false,
        error: 'Frequency must be one of: 5, 10, 15, 30, 45, 60, 120 minutes, or "random"'
      });
    }

    // Validate trading mode
    const validTradingModes = ['automated', 'buy_only', 'buy_sell', 'sell_only'];
    if (tradingMode && !validTradingModes.includes(tradingMode)) {
      return res.status(400).json({
        success: false,
        error: 'Trading mode must be one of: automated, buy_only, buy_sell, sell_only'
      });
    }

    if (minTradeSize && (minTradeSize < 0.1 || minTradeSize > 10)) {
      return res.status(400).json({ success: false, error: 'Min trade size must be between 0.1 and 10 XRP' });
    }

    if (maxTradeSize && (maxTradeSize < 0.1 || maxTradeSize > 10)) {
      return res.status(400).json({ success: false, error: 'Max trade size must be between 0.1 and 10 XRP' });
    }

    if (priceSpread && (priceSpread < 0 || priceSpread > 5)) {
      return res.status(400).json({ success: false, error: 'Price spread must be between 0 and 5%' });
    }

    // Update settings in Redis
    if (frequency) await redis.set('volume_bot:frequency', frequency.toString());
    if (tradingMode) await redis.set('volume_bot:trading_mode', tradingMode);
    if (minTradeSize) await redis.set('volume_bot:min_trade_size', minTradeSize.toString());
    if (maxTradeSize) await redis.set('volume_bot:max_trade_size', maxTradeSize.toString());
    if (priceSpread !== undefined) await redis.set('volume_bot:price_spread', priceSpread.toString());

    // Log the settings change
    await redis.lpush('volume_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'settings_updated',
      changes: { frequency, minTradeSize, maxTradeSize, priceSpread },
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: 'Bot settings updated successfully',
      settings: { frequency, minTradeSize, maxTradeSize, priceSpread }
    });
  } catch (error) {
    console.error("❌ Error updating bot settings:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/volume-bot/pause - Pause the bot
router.post("/pause", requireAdmin, async (req, res) => {
  try {
    await redis.set('volume_bot:status', 'paused');
    await redis.set('volume_bot:pause_timestamp', new Date().toISOString());

    // Log the pause action
    await redis.lpush('volume_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'paused',
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: 'Volume bot paused successfully'
    });
  } catch (error) {
    console.error("❌ Error pausing bot:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/volume-bot/resume - Resume the bot
router.post("/resume", requireAdmin, async (req, res) => {
  try {
    await redis.set('volume_bot:status', 'running');
    await redis.del('volume_bot:pause_timestamp');

    // Log the resume action
    await redis.lpush('volume_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'resumed',
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: 'Volume bot resumed successfully'
    });
  } catch (error) {
    console.error("❌ Error resuming bot:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/volume-bot/restart - Restart the bot
router.post("/restart", requireAdmin, async (req, res) => {
  try {
    await redis.set('volume_bot:status', 'restarting');
    await redis.set('volume_bot:restart_timestamp', new Date().toISOString());

    // Log the restart action
    await redis.lpush('volume_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'restarted',
      admin: 'admin_panel'
    }));

    // Simulate restart completion after 3 seconds
    setTimeout(async () => {
      await redis.set('volume_bot:status', 'running');
      await redis.del('volume_bot:restart_timestamp');
    }, 3000);

    res.json({
      success: true,
      message: 'Volume bot restart initiated'
    });
  } catch (error) {
    console.error("❌ Error restarting bot:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/volume-bot/trades - Get recent trades
router.get("/trades", requireAdmin, async (req, res) => {
  try {
    const trades = await redis.lrange('volume_bot:recent_trades', 0, 19); // Get last 20 trades

    const parsedTrades = trades.map(trade => {
      try {
        return JSON.parse(trade);
      } catch {
        return null;
      }
    }).filter(Boolean);

    res.json({
      success: true,
      trades: parsedTrades
    });
  } catch (error) {
    console.error("❌ Error getting recent trades:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/volume-bot/emergency-stop - Emergency stop
router.post("/emergency-stop", requireAdmin, async (req, res) => {
  try {
    await redis.set('volume_bot:status', 'emergency_stopped');
    await redis.set('volume_bot:emergency_stop_timestamp', new Date().toISOString());

    // Log the emergency stop
    await redis.lpush('volume_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'emergency_stop',
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: 'Emergency stop activated - all trading halted'
    });
  } catch (error) {
    console.error("❌ Error executing emergency stop:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/volume-bot/withdraw - Withdraw all funds
router.post("/withdraw", requireAdmin, async (req, res) => {
  try {
    // In real implementation, this would execute XRPL transactions
    // For now, we'll simulate the withdrawal

    await redis.set('volume_bot:status', 'withdrawing_funds');

    // Log the withdrawal
    await redis.lpush('volume_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'funds_withdrawn',
      admin: 'admin_panel'
    }));

    // Simulate successful withdrawal
    setTimeout(async () => {
      await redis.set('volume_bot:status', 'funds_withdrawn');
    }, 2000);

    res.json({
      success: true,
      message: 'Fund withdrawal initiated',
      xrpWithdrawn: '65',
      wloWithdrawn: '1076000'
    });
  } catch (error) {
    console.error("❌ Error withdrawing funds:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
