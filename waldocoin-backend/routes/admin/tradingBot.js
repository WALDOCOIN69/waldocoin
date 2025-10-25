// routes/admin/tradingBot.js - Trading Bot Admin Controls
import express from "express";
import dotenv from "dotenv";
import Redis from "ioredis";
import { requireAdmin } from "../../utils/adminAuth.js";

dotenv.config();

const router = express.Router();
const redis = new Redis(process.env.REDIS_URL);

console.log("🤖 Loaded: routes/admin/tradingBot.js");

// GET /api/admin/trading-bot/status - Get trading bot status and metrics
router.get("/status", requireAdmin, async (req, res) => {
  try {
    // Get bot status from Redis
    const botStatus = await redis.get('trading_bot:status') || 'Unknown';
    const lastTrade = await redis.get('trading_bot:last_trade');
    const tradesCount = await redis.get('trading_bot:trades_today') || '0';
    const volume24h = await redis.get('trading_bot:volume_24h') || '0';
    const currentBalance = await redis.get('trading_bot:current_balance') || '0';
    const totalProfit = await redis.get('trading_bot:total_profit') || '0';
    const startingBalance = await redis.get('trading_bot:starting_balance') || '70';

    // Get current settings
    const settings = {
      tradingMode: await redis.get('trading_bot:trading_mode') || 'automated',
      frequency: await redis.get('trading_bot:frequency') || '3',
      minTradeSize: await redis.get('trading_bot:min_trade_size') || '0.5',
      maxTradeSize: await redis.get('trading_bot:max_trade_size') || '2.0',
      priceSpread: await redis.get('trading_bot:price_spread') || '0',
      profitReserveThreshold: await redis.get('trading_bot:profit_reserve_threshold') || '200',
      profitReservePercentage: await redis.get('trading_bot:profit_reserve_percentage') || '50',
      maxDailyVolume: await redis.get('trading_bot:max_daily_volume') || '500'
    };

    // Get wallet balances
    const xrpBalance = await redis.get('trading_bot:xrp_balance') || '0';
    const wloBalance = await redis.get('trading_bot:wlo_balance') || '0';

    // Calculate profit metrics
    const profitXrp = parseFloat(totalProfit);
    const profitPercentage = parseFloat(startingBalance) > 0 ? 
      ((profitXrp / parseFloat(startingBalance)) * 100).toFixed(2) : '0';

    res.json({
      success: true,
      status: botStatus,
      balance: {
        xrp: parseFloat(xrpBalance).toFixed(4),
        wlo: parseFloat(wloBalance).toFixed(0),
        total: parseFloat(currentBalance).toFixed(4)
      },
      profit: {
        xrp: profitXrp.toFixed(4),
        percentage: profitPercentage,
        startingBalance: parseFloat(startingBalance).toFixed(4)
      },
      activity: {
        tradesCount: tradesCount,
        volume24h: `${volume24h} XRP`,
        lastTrade: lastTrade
      },
      settings: settings
    });
  } catch (error) {
    console.error("❌ Error getting trading bot status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/trading-bot/settings - Update trading bot settings
router.post("/settings", requireAdmin, async (req, res) => {
  try {
    const { 
      tradingMode, 
      frequency, 
      minTradeSize, 
      maxTradeSize, 
      priceSpread,
      profitReserveThreshold,
      profitReservePercentage,
      maxDailyVolume
    } = req.body;

    // Validate trading mode
    const validTradingModes = ['automated', 'perpetual', 'buy_only', 'sell_only', 'buy_sell'];
    if (tradingMode && !validTradingModes.includes(tradingMode)) {
      return res.status(400).json({
        success: false,
        error: 'Trading mode must be one of: automated, perpetual, buy_only, sell_only, buy_sell'
      });
    }

    // Validate frequency (minutes)
    if (frequency && (frequency < 1 || frequency > 60)) {
      return res.status(400).json({
        success: false,
        error: 'Frequency must be between 1 and 60 minutes'
      });
    }

    // Validate trade sizes
    if (minTradeSize && (minTradeSize < 0.1 || minTradeSize > 10)) {
      return res.status(400).json({ success: false, error: 'Min trade size must be between 0.1 and 10 XRP' });
    }

    if (maxTradeSize && (maxTradeSize < 0.1 || maxTradeSize > 10)) {
      return res.status(400).json({ success: false, error: 'Max trade size must be between 0.1 and 10 XRP' });
    }

    if (priceSpread !== undefined && (priceSpread < 0 || priceSpread > 5)) {
      return res.status(400).json({ success: false, error: 'Price spread must be between 0 and 5%' });
    }

    // Update settings in Redis
    if (tradingMode) await redis.set('trading_bot:trading_mode', tradingMode);
    if (frequency) await redis.set('trading_bot:frequency', frequency.toString());
    if (minTradeSize) await redis.set('trading_bot:min_trade_size', minTradeSize.toString());
    if (maxTradeSize) await redis.set('trading_bot:max_trade_size', maxTradeSize.toString());
    if (priceSpread !== undefined) await redis.set('trading_bot:price_spread', priceSpread.toString());
    if (profitReserveThreshold) await redis.set('trading_bot:profit_reserve_threshold', profitReserveThreshold.toString());
    if (profitReservePercentage) await redis.set('trading_bot:profit_reserve_percentage', profitReservePercentage.toString());
    if (maxDailyVolume) await redis.set('trading_bot:max_daily_volume', maxDailyVolume.toString());

    // Log the settings change
    await redis.lpush('trading_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'settings_updated',
      changes: { tradingMode, frequency, minTradeSize, maxTradeSize, priceSpread, profitReserveThreshold, profitReservePercentage, maxDailyVolume },
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: 'Trading bot settings updated successfully',
      settings: { tradingMode, frequency, minTradeSize, maxTradeSize, priceSpread }
    });
  } catch (error) {
    console.error("❌ Error updating trading bot settings:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/trading-bot/pause - Pause the trading bot
router.post("/pause", requireAdmin, async (req, res) => {
  try {
    await redis.set('trading_bot:status', 'paused');
    await redis.set('trading_bot:pause_timestamp', new Date().toISOString());

    // Log the pause action
    await redis.lpush('trading_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'paused',
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: 'Trading bot paused successfully'
    });
  } catch (error) {
    console.error("❌ Error pausing trading bot:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/trading-bot/resume - Resume the trading bot
router.post("/resume", requireAdmin, async (req, res) => {
  try {
    await redis.set('trading_bot:status', 'running');
    await redis.del('trading_bot:pause_timestamp');

    // Log the resume action
    await redis.lpush('trading_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'resumed',
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: 'Trading bot resumed successfully'
    });
  } catch (error) {
    console.error("❌ Error resuming trading bot:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/trading-bot/emergency-stop - Emergency stop trading
router.post("/emergency-stop", requireAdmin, async (req, res) => {
  try {
    await redis.set('trading_bot:status', 'emergency_stopped');
    await redis.set('trading_bot:emergency_stop_timestamp', new Date().toISOString());

    // Log the emergency stop
    await redis.lpush('trading_bot:admin_log', JSON.stringify({
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

// GET /api/admin/trading-bot/trades - Get recent trades
router.get("/trades", requireAdmin, async (req, res) => {
  try {
    const trades = await redis.lrange('trading_bot:recent_trades', 0, 19); // Get last 20 trades

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

// POST /api/admin/trading-bot/reset-profit - Reset profit tracking
router.post("/reset-profit", requireAdmin, async (req, res) => {
  try {
    const { newStartingBalance } = req.body;
    
    if (newStartingBalance && (newStartingBalance < 10 || newStartingBalance > 1000)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Starting balance must be between 10 and 1000 XRP' 
      });
    }

    const startingBalance = newStartingBalance || 70;
    
    await redis.set('trading_bot:starting_balance', startingBalance.toString());
    await redis.set('trading_bot:total_profit', '0');
    await redis.set('trading_bot:profit_reset_timestamp', new Date().toISOString());

    // Log the profit reset
    await redis.lpush('trading_bot:admin_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'profit_reset',
      newStartingBalance: startingBalance,
      admin: 'admin_panel'
    }));

    res.json({
      success: true,
      message: `Profit tracking reset with starting balance: ${startingBalance} XRP`
    });
  } catch (error) {
    console.error("❌ Error resetting profit tracking:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
