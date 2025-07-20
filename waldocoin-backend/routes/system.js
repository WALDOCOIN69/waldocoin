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

export default router;
