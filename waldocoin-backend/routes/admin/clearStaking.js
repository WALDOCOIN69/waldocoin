// Admin endpoint to clear all staking data
import express from 'express';
import { connectRedis } from '../../redisClient.js';
import { validateAdminKey, getAdminKey } from '../../utils/adminAuth.js';

const router = express.Router();

// POST /api/admin/clear-staking - Clear all staking data (admin only)
router.post('/clear-staking', async (req, res) => {
  try {
    // Check admin key using shared utility
    const adminKey = getAdminKey(req);
    const validation = validateAdminKey(adminKey);

    if (!validation.valid) {
      return res.status(401).json({
        success: false,
        error: validation.error
      });
    }

    console.log('🔥 ADMIN: Clearing all staking data...');
    const redis = await connectRedis();
    
    // Get all staking-related keys
    const stakingKeys = await redis.keys('staking:*');
    const userStakeKeys = await redis.keys('user:*:long_term_stakes');
    const userStakeGenericKeys = await redis.keys('staking:user:*');
    const stakingStatsKeys = await redis.keys('staking:total_*');
    const stakingLockKeys = await redis.keys('stake:*');
    
    const allKeys = [
      ...stakingKeys,
      ...userStakeKeys, 
      ...userStakeGenericKeys,
      ...stakingStatsKeys,
      ...stakingLockKeys
    ];
    
    console.log(`Found ${allKeys.length} staking-related keys to delete`);
    
    // Delete all keys
    if (allKeys.length > 0) {
      await redis.del(allKeys);
    }
    
    // Reset counters
    await redis.set('staking:total_staked', '0');
    await redis.set('staking:total_long_term_staked', '0');
    await redis.set('staking:total_penalties', '0');
    await redis.set('staking:total_rewards_paid', '0');
    
    console.log('✅ ADMIN: All staking data cleared successfully');
    
    res.json({
      success: true,
      message: 'All staking data cleared successfully',
      keysDeleted: allKeys.length,
      categories: {
        stakingKeys: stakingKeys.length,
        userStakeKeys: userStakeKeys.length,
        userStakeGenericKeys: userStakeGenericKeys.length,
        stakingStatsKeys: stakingStatsKeys.length,
        stakingLockKeys: stakingLockKeys.length
      }
    });
    
  } catch (error) {
    console.error('❌ ADMIN: Error clearing staking data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear staking data',
      details: error.message
    });
  }
});

export default router;
