import express from 'express';
import redis from '../redisClient.js';

const router = express.Router();

// 🎁 Bonus Control System for Admin

// POST /api/rewards/set-bonus - Set reward bonus multiplier
router.post('/set-bonus', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { type, multiplier, duration, eventName } = req.body;

    // Validate inputs
    if (!type || !multiplier || !eventName) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    if (multiplier < 1 || multiplier > 100) {
      return res.status(400).json({ success: false, error: "Multiplier must be between 1 and 100" });
    }

    // Create bonus object
    const bonusId = `bonus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const bonus = {
      id: bonusId,
      type: type, // 'all', 'meme', 'battle', 'referral', 'staking'
      multiplier: parseFloat(multiplier),
      eventName: eventName,
      createdAt: new Date().toISOString(),
      createdBy: 'admin',
      permanent: duration === 0,
      expiresAt: duration > 0 ? new Date(Date.now() + (duration * 60 * 60 * 1000)).toISOString() : null
    };

    // Store bonus in Redis
    await redis.hSet(`reward_bonus:${bonusId}`, bonus);
    await redis.sAdd('active_bonuses', bonusId);

    // Set expiration if not permanent
    if (duration > 0) {
      await redis.expire(`reward_bonus:${bonusId}`, duration * 60 * 60); // Convert hours to seconds
    }

    console.log(`🎁 Bonus activated: ${eventName} (${multiplier}x ${type}) by admin`);

    return res.json({
      success: true,
      bonus: bonus,
      message: `Bonus activated: ${eventName} (${multiplier}x ${type} rewards)`
    });

  } catch (error) {
    console.error('❌ Error setting bonus:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to set bonus"
    });
  }
});

// GET /api/rewards/active-bonuses - Get all active bonuses
router.get('/active-bonuses', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get all active bonus IDs
    const bonusIds = await redis.sMembers('active_bonuses');
    const bonuses = [];

    for (const bonusId of bonusIds) {
      const bonusData = await redis.hGetAll(`reward_bonus:${bonusId}`);
      
      if (bonusData && Object.keys(bonusData).length > 0) {
        // Check if bonus has expired
        if (!bonusData.permanent && bonusData.expiresAt) {
          const expiresAt = new Date(bonusData.expiresAt);
          if (expiresAt < new Date()) {
            // Bonus expired, remove it
            await redis.sRem('active_bonuses', bonusId);
            await redis.del(`reward_bonus:${bonusId}`);
            continue;
          }
        }

        bonuses.push({
          id: bonusData.id,
          type: bonusData.type,
          multiplier: parseFloat(bonusData.multiplier),
          eventName: bonusData.eventName,
          createdAt: bonusData.createdAt,
          permanent: bonusData.permanent === 'true',
          expiresAt: bonusData.expiresAt
        });
      }
    }

    return res.json({
      success: true,
      bonuses: bonuses,
      count: bonuses.length
    });

  } catch (error) {
    console.error('❌ Error getting active bonuses:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get active bonuses"
    });
  }
});

// POST /api/rewards/clear-bonuses - Clear all active bonuses
router.post('/clear-bonuses', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get all active bonus IDs
    const bonusIds = await redis.sMembers('active_bonuses');
    let clearedCount = 0;

    // Remove all bonuses
    for (const bonusId of bonusIds) {
      await redis.del(`reward_bonus:${bonusId}`);
      clearedCount++;
    }

    // Clear the active bonuses set
    await redis.del('active_bonuses');

    console.log(`🗑️ Admin cleared ${clearedCount} active bonuses`);

    return res.json({
      success: true,
      clearedCount: clearedCount,
      message: `Cleared ${clearedCount} active bonuses`
    });

  } catch (error) {
    console.error('❌ Error clearing bonuses:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to clear bonuses"
    });
  }
});

// POST /api/rewards/remove-bonus - Remove specific bonus
router.post('/remove-bonus', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { bonusId } = req.body;

    if (!bonusId) {
      return res.status(400).json({ success: false, error: "Bonus ID required" });
    }

    // Remove bonus
    await redis.sRem('active_bonuses', bonusId);
    await redis.del(`reward_bonus:${bonusId}`);

    console.log(`🗑️ Admin removed bonus: ${bonusId}`);

    return res.json({
      success: true,
      message: "Bonus removed successfully"
    });

  } catch (error) {
    console.error('❌ Error removing bonus:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to remove bonus"
    });
  }
});

// GET /api/rewards/calculate - Calculate reward with active bonuses (for other systems to use)
router.get('/calculate', async (req, res) => {
  try {
    const { baseAmount, rewardType } = req.query;

    if (!baseAmount || !rewardType) {
      return res.status(400).json({ success: false, error: "baseAmount and rewardType required" });
    }

    const base = parseFloat(baseAmount);
    let finalAmount = base;
    let appliedBonuses = [];

    // Get active bonuses
    const bonusIds = await redis.sMembers('active_bonuses');

    for (const bonusId of bonusIds) {
      const bonusData = await redis.hGetAll(`reward_bonus:${bonusId}`);
      
      if (bonusData && Object.keys(bonusData).length > 0) {
        // Check if bonus applies to this reward type
        if (bonusData.type === 'all' || bonusData.type === rewardType) {
          // Check if bonus is still valid
          if (bonusData.permanent === 'true' || 
              (bonusData.expiresAt && new Date(bonusData.expiresAt) > new Date())) {
            
            const multiplier = parseFloat(bonusData.multiplier);
            finalAmount *= multiplier;
            
            appliedBonuses.push({
              eventName: bonusData.eventName,
              multiplier: multiplier,
              type: bonusData.type
            });
          }
        }
      }
    }

    return res.json({
      success: true,
      baseAmount: base,
      finalAmount: Math.round(finalAmount),
      totalMultiplier: finalAmount / base,
      appliedBonuses: appliedBonuses,
      rewardType: rewardType
    });

  } catch (error) {
    console.error('❌ Error calculating reward:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to calculate reward"
    });
  }
});

export default router;
