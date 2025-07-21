import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("⚙️ Loaded: routes/system.js");

// GET /api/system/waldo-requirements - Get current WALDO requirements
router.get('/waldo-requirements', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get current requirements from Redis with defaults
    const memeRewards = await redis.get("requirements:meme_rewards") || 6000; // 6 XRP worth
    const battles = await redis.get("requirements:battles") || 6000; // 6 XRP worth
    const daoVoting = await redis.get("requirements:dao_voting") || 100; // 0.1 XRP worth
    const waldoPerXrp = await redis.get("conversion:waldo_per_xrp") || 1000; // 1000 WALDO per XRP

    return res.json({
      success: true,
      requirements: {
        memeRewards: parseInt(memeRewards),
        battles: parseInt(battles),
        daoVoting: parseInt(daoVoting),
        waldoPerXrp: parseInt(waldoPerXrp)
      }
    });

  } catch (error) {
    console.error('❌ Error getting WALDO requirements:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get WALDO requirements"
    });
  }
});

// POST /api/system/update-waldo-requirements - Update WALDO requirements
router.post('/update-waldo-requirements', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { memeRewards, battles, daoVoting, waldoPerXrp, reason } = req.body;
    const changes = [];

    // Update meme rewards requirement if provided
    if (memeRewards !== undefined) {
      await redis.set("requirements:meme_rewards", memeRewards);
      changes.push(`Meme rewards: ${memeRewards.toLocaleString()} WALDO`);
    }

    // Update battles requirement if provided
    if (battles !== undefined) {
      await redis.set("requirements:battles", battles);
      changes.push(`Battles: ${battles.toLocaleString()} WALDO`);
    }

    // Update DAO voting requirement if provided
    if (daoVoting !== undefined) {
      await redis.set("requirements:dao_voting", daoVoting);
      changes.push(`DAO voting: ${daoVoting.toLocaleString()} WALDO`);
    }

    // Update WALDO/XRP rate if provided
    if (waldoPerXrp !== undefined) {
      await redis.set("conversion:waldo_per_xrp", waldoPerXrp);
      changes.push(`Rate: ${waldoPerXrp.toLocaleString()} WALDO/XRP`);
    }

    // Log the requirement change
    const requirementChange = {
      timestamp: new Date().toISOString(),
      reason: reason || 'Requirement update',
      changes: changes,
      adminKey: adminKey.slice(-4) // Only store last 4 chars for security
    };

    await redis.lPush("requirements:history", JSON.stringify(requirementChange));
    await redis.lTrim("requirements:history", 0, 49); // Keep last 50 changes

    console.log(`💰 WALDO requirements updated: ${changes.join(', ')} - Reason: ${reason}`);

    return res.json({
      success: true,
      changes: changes,
      message: `Requirements updated: ${changes.join(', ')}`
    });

  } catch (error) {
    console.error('❌ Error updating WALDO requirements:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to update WALDO requirements"
    });
  }
});

// POST /api/system/reset-waldo-requirements - Reset to default requirements
router.post('/reset-waldo-requirements', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { reason } = req.body;

    // Reset to defaults
    await redis.set("requirements:meme_rewards", 6000); // 6 XRP worth
    await redis.set("requirements:battles", 6000); // 6 XRP worth
    await redis.set("requirements:dao_voting", 100); // 0.1 XRP worth
    await redis.set("conversion:waldo_per_xrp", 1000); // 1000 WALDO per XRP

    // Log the reset
    const requirementChange = {
      timestamp: new Date().toISOString(),
      reason: reason || 'Reset to default requirements',
      changes: ['Meme rewards: 6,000 WALDO', 'Battles: 6,000 WALDO', 'DAO voting: 100 WALDO', 'Rate: 1,000 WALDO/XRP'],
      adminKey: adminKey.slice(-4)
    };

    await redis.lPush("requirements:history", JSON.stringify(requirementChange));

    console.log(`🔄 WALDO requirements reset to defaults - Reason: ${reason}`);

    return res.json({
      success: true,
      message: "Requirements reset to defaults"
    });

  } catch (error) {
    console.error('❌ Error resetting WALDO requirements:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to reset WALDO requirements"
    });
  }
});

// GET /api/system/requirement-history - Get requirement change history
router.get('/requirement-history', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get requirement history
    const historyData = await redis.lRange("requirements:history", 0, 19); // Last 20 changes
    const history = historyData.map(item => JSON.parse(item));

    return res.json({
      success: true,
      history: history,
      count: history.length
    });

  } catch (error) {
    console.error('❌ Error getting requirement history:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get requirement history"
    });
  }
});

// POST /api/system/clear-cache - Clear Redis cache
router.post('/clear-cache', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Clear specific cache keys (be careful not to clear user data)
    const cacheKeys = [
      'stats:*',
      'cache:*',
      'temp:*'
    ];

    let clearedCount = 0;
    for (const pattern of cacheKeys) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        clearedCount += keys.length;
      }
    }

    console.log(`🗑️ Admin cleared ${clearedCount} cache keys`);

    return res.json({
      success: true,
      clearedCount: clearedCount,
      message: `Cleared ${clearedCount} cache entries`
    });

  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to clear cache"
    });
  }
});

// POST /api/system/emergency-stop - Emergency system stop
router.post('/emergency-stop', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Set emergency stop flag
    await redis.set("system:emergency_stop", "true", { EX: 60 * 60 * 24 }); // 24 hour expiry
    await redis.set("system:emergency_stop_reason", "Admin emergency stop", { EX: 60 * 60 * 24 });
    await redis.set("system:emergency_stop_timestamp", new Date().toISOString(), { EX: 60 * 60 * 24 });

    console.log(`🛑 EMERGENCY STOP ACTIVATED by admin`);

    return res.json({
      success: true,
      message: "Emergency stop activated - all user functions disabled"
    });

  } catch (error) {
    console.error('❌ Error activating emergency stop:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to activate emergency stop"
    });
  }
});

// GET /api/system/meme-limits - Get current meme limits
router.get('/meme-limits', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get current meme limits from Redis with defaults
    const daily = await redis.get("limits:meme_daily") || 10; // 10 memes per day
    const premium = await redis.get("limits:meme_premium") || 25; // 25 for 10K+ WALDO holders
    const vip = await redis.get("limits:meme_vip") || 50; // 50 for 50K+ WALDO holders
    const resetHour = await redis.get("limits:meme_reset_hour") || 0; // Midnight UTC

    return res.json({
      success: true,
      limits: {
        daily: parseInt(daily),
        premium: parseInt(premium),
        vip: parseInt(vip),
        resetHour: parseInt(resetHour)
      }
    });

  } catch (error) {
    console.error('❌ Error getting meme limits:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get meme limits"
    });
  }
});

// POST /api/system/update-meme-limits - Update meme limits
router.post('/update-meme-limits', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { daily, premium, vip, resetHour, reason } = req.body;
    const changes = [];

    // Update daily limit if provided
    if (daily !== undefined) {
      await redis.set("limits:meme_daily", daily);
      changes.push(`Daily: ${daily} memes`);
    }

    // Update premium limit if provided
    if (premium !== undefined) {
      await redis.set("limits:meme_premium", premium);
      changes.push(`Premium: ${premium} memes`);
    }

    // Update VIP limit if provided
    if (vip !== undefined) {
      await redis.set("limits:meme_vip", vip);
      changes.push(`VIP: ${vip} memes`);
    }

    // Update reset hour if provided
    if (resetHour !== undefined) {
      await redis.set("limits:meme_reset_hour", resetHour);
      changes.push(`Reset: ${resetHour}:00 UTC`);
    }

    // Log the limit change
    const limitChange = {
      timestamp: new Date().toISOString(),
      reason: reason || 'Meme limit update',
      changes: changes,
      adminKey: adminKey.slice(-4) // Only store last 4 chars for security
    };

    await redis.lPush("limits:meme_history", JSON.stringify(limitChange));
    await redis.lTrim("limits:meme_history", 0, 49); // Keep last 50 changes

    console.log(`🎭 Meme limits updated: ${changes.join(', ')} - Reason: ${reason}`);

    return res.json({
      success: true,
      changes: changes,
      message: `Meme limits updated: ${changes.join(', ')}`
    });

  } catch (error) {
    console.error('❌ Error updating meme limits:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to update meme limits"
    });
  }
});

// POST /api/system/reset-meme-limits - Reset to default meme limits
router.post('/reset-meme-limits', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { reason } = req.body;

    // Reset to defaults
    await redis.set("limits:meme_daily", 10); // 10 memes per day
    await redis.set("limits:meme_premium", 25); // 25 for premium users
    await redis.set("limits:meme_vip", 50); // 50 for VIP users
    await redis.set("limits:meme_reset_hour", 0); // Midnight UTC

    // Log the reset
    const limitChange = {
      timestamp: new Date().toISOString(),
      reason: reason || 'Reset to default meme limits',
      changes: ['Daily: 10 memes', 'Premium: 25 memes', 'VIP: 50 memes', 'Reset: 0:00 UTC'],
      adminKey: adminKey.slice(-4)
    };

    await redis.lPush("limits:meme_history", JSON.stringify(limitChange));

    console.log(`🔄 Meme limits reset to defaults - Reason: ${reason}`);

    return res.json({
      success: true,
      message: "Meme limits reset to defaults"
    });

  } catch (error) {
    console.error('❌ Error resetting meme limits:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to reset meme limits"
    });
  }
});

// GET /api/system/meme-limit-history - Get meme limit change history
router.get('/meme-limit-history', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get meme limit history
    const historyData = await redis.lRange("limits:meme_history", 0, 19); // Last 20 changes
    const history = historyData.map(item => JSON.parse(item));

    return res.json({
      success: true,
      history: history,
      count: history.length
    });

  } catch (error) {
    console.error('❌ Error getting meme limit history:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get meme limit history"
    });
  }
});

// GET /api/system/user-meme-usage/:wallet - Get user's meme usage
router.get('/user-meme-usage/:wallet', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { wallet } = req.params;

    // Get user's WALDO balance to determine tier
    const userData = await redis.hGetAll(`user:${wallet}`);
    const waldoBalance = parseInt(userData.waldoBalance) || 0;

    // Determine daily limit based on WALDO holdings
    let dailyLimit, tier;
    if (waldoBalance >= 50000) {
      dailyLimit = parseInt(await redis.get("limits:meme_vip")) || 50;
      tier = "VIP";
    } else if (waldoBalance >= 10000) {
      dailyLimit = parseInt(await redis.get("limits:meme_premium")) || 25;
      tier = "Premium";
    } else {
      dailyLimit = parseInt(await redis.get("limits:meme_daily")) || 10;
      tier = "Standard";
    }

    // Get today's usage
    const today = new Date().toISOString().split('T')[0];
    const twitterHandle = userData.twitterHandle || 'unknown';
    const dailyKey = `meme_count:${twitterHandle}:${today}`;
    const todayCount = parseInt(await redis.get(dailyKey)) || 0;

    // Calculate reset times
    const resetHour = parseInt(await redis.get("limits:meme_reset_hour")) || 0;
    const now = new Date();
    const lastReset = new Date(now);
    lastReset.setUTCHours(resetHour, 0, 0, 0);
    if (lastReset > now) {
      lastReset.setUTCDate(lastReset.getUTCDate() - 1);
    }

    const nextReset = new Date(lastReset);
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);

    return res.json({
      success: true,
      usage: {
        wallet,
        twitterHandle,
        tier,
        waldoBalance,
        dailyLimit,
        todayCount,
        remaining: Math.max(0, dailyLimit - todayCount),
        lastReset: lastReset.toISOString(),
        nextReset: nextReset.toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error getting user meme usage:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user meme usage"
    });
  }
});

// GET /api/system/meme-usage-stats - Get overall meme usage statistics
router.get('/meme-usage-stats', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const today = new Date().toISOString().split('T')[0];

    // Get all daily meme count keys for today
    const dailyKeys = await redis.keys(`meme_count:*:${today}`);

    let totalUsers = 0;
    let totalMemes = 0;
    let usersAtLimit = 0;

    // Get limits
    const dailyLimit = parseInt(await redis.get("limits:meme_daily")) || 10;
    const premiumLimit = parseInt(await redis.get("limits:meme_premium")) || 25;
    const vipLimit = parseInt(await redis.get("limits:meme_vip")) || 50;

    for (const key of dailyKeys) {
      const count = parseInt(await redis.get(key)) || 0;
      if (count > 0) {
        totalUsers++;
        totalMemes += count;

        // Extract handle from key to check their limit
        const handle = key.split(':')[1];
        const wallet = await redis.get(`twitter:${handle.toLowerCase()}`);

        if (wallet) {
          const userData = await redis.hGetAll(`user:${wallet}`);
          const waldoBalance = parseInt(userData.waldoBalance) || 0;

          let userLimit = dailyLimit;
          if (waldoBalance >= 50000) userLimit = vipLimit;
          else if (waldoBalance >= 10000) userLimit = premiumLimit;

          if (count >= userLimit) usersAtLimit++;
        }
      }
    }

    const avgMemesPerUser = totalUsers > 0 ? (totalMemes / totalUsers).toFixed(1) : 0;

    return res.json({
      success: true,
      stats: {
        totalUsers,
        totalMemes,
        usersAtLimit,
        avgMemesPerUser: parseFloat(avgMemesPerUser),
        date: today
      }
    });

  } catch (error) {
    console.error('❌ Error getting meme usage stats:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get meme usage stats"
    });
  }
});

export default router;
