import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("🏦 Loaded: routes/staking.js");

// GET /api/staking/positions - Get all staking positions (admin only)
router.get('/positions', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status || 'all'; // all, active, completed, unstaked

    // Get all staking position keys
    const stakingKeys = await redis.keys("staking:*");
    const positions = [];

    for (const key of stakingKeys) {
      if (key.includes(':position:')) {
        const positionData = await redis.hGetAll(key);
        
        if (positionData && Object.keys(positionData).length > 0) {
          const walletAddress = key.split(':')[1];
          const positionId = key.split(':')[3];
          
          // Calculate current value and time remaining
          const startTime = new Date(positionData.startTime);
          const endTime = new Date(positionData.endTime);
          const now = new Date();
          
          const timeRemaining = Math.max(0, endTime - now);
          const totalDuration = endTime - startTime;
          const elapsed = now - startTime;
          const progress = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;
          
          // Calculate current rewards
          const baseAmount = parseFloat(positionData.amount) || 0;
          const apy = parseFloat(positionData.apy) || 0;
          const currentRewards = (baseAmount * (apy / 100) * (elapsed / (365 * 24 * 60 * 60 * 1000)));
          
          const position = {
            id: positionId,
            walletAddress: walletAddress,
            amount: baseAmount,
            tier: positionData.tier || 'unknown',
            apy: apy,
            startTime: positionData.startTime,
            endTime: positionData.endTime,
            status: positionData.status || 'active',
            progress: progress.toFixed(1),
            timeRemaining: timeRemaining,
            currentRewards: currentRewards.toFixed(2),
            totalValue: (baseAmount + currentRewards).toFixed(2),
            canUnstake: positionData.status === 'active' && timeRemaining <= 0,
            earlyUnstakePenalty: timeRemaining > 0 ? '15%' : '0%'
          };

          // Filter by status if specified
          if (status === 'all' || position.status === status) {
            positions.push(position);
          }
        }
      }
    }

    // Sort by start time (newest first)
    positions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Calculate summary stats
    const totalStaked = positions.reduce((sum, pos) => sum + pos.amount, 0);
    const totalRewards = positions.reduce((sum, pos) => sum + parseFloat(pos.currentRewards), 0);
    const activePositions = positions.filter(pos => pos.status === 'active').length;

    console.log(`🏦 Staking positions requested: ${positions.length} positions, ${totalStaked} WALDO staked`);

    return res.json({
      success: true,
      positions: positions.slice(0, limit),
      summary: {
        totalPositions: positions.length,
        activePositions: activePositions,
        totalStaked: totalStaked.toFixed(2),
        totalRewards: totalRewards.toFixed(2),
        averageAPY: positions.length > 0 ? (positions.reduce((sum, pos) => sum + pos.apy, 0) / positions.length).toFixed(2) : 0
      },
      filter: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting staking positions:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking positions"
    });
  }
});

// GET /api/staking/user/:wallet - Get user's staking positions
router.get('/user/:wallet', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { wallet } = req.params;
    
    if (!wallet || wallet.length < 25) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet address"
      });
    }

    // Get user's staking positions
    const userStakingKeys = await redis.keys(`staking:${wallet}:position:*`);
    const positions = [];

    for (const key of userStakingKeys) {
      const positionData = await redis.hGetAll(key);
      
      if (positionData && Object.keys(positionData).length > 0) {
        const positionId = key.split(':')[3];
        
        // Calculate current status
        const startTime = new Date(positionData.startTime);
        const endTime = new Date(positionData.endTime);
        const now = new Date();
        
        const timeRemaining = Math.max(0, endTime - now);
        const totalDuration = endTime - startTime;
        const elapsed = now - startTime;
        const progress = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;
        
        // Calculate rewards
        const baseAmount = parseFloat(positionData.amount) || 0;
        const apy = parseFloat(positionData.apy) || 0;
        const currentRewards = (baseAmount * (apy / 100) * (elapsed / (365 * 24 * 60 * 60 * 1000)));
        
        positions.push({
          id: positionId,
          amount: baseAmount,
          tier: positionData.tier || 'unknown',
          apy: apy,
          startTime: positionData.startTime,
          endTime: positionData.endTime,
          status: positionData.status || 'active',
          progress: progress.toFixed(1),
          timeRemaining: timeRemaining,
          currentRewards: currentRewards.toFixed(2),
          totalValue: (baseAmount + currentRewards).toFixed(2),
          canUnstake: positionData.status === 'active' && timeRemaining <= 0,
          earlyUnstakePenalty: timeRemaining > 0 ? '15%' : '0%',
          daysRemaining: Math.ceil(timeRemaining / (24 * 60 * 60 * 1000))
        });
      }
    }

    // Sort by start time (newest first)
    positions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const summary = {
      totalPositions: positions.length,
      activePositions: positions.filter(pos => pos.status === 'active').length,
      totalStaked: positions.reduce((sum, pos) => sum + pos.amount, 0).toFixed(2),
      totalRewards: positions.reduce((sum, pos) => sum + parseFloat(pos.currentRewards), 0).toFixed(2),
      canUnstakeCount: positions.filter(pos => pos.canUnstake).length
    };

    console.log(`🏦 User staking positions requested: ${wallet} - ${positions.length} positions`);

    return res.json({
      success: true,
      wallet: wallet,
      positions: positions,
      summary: summary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting user staking positions:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user staking positions"
    });
  }
});

// POST /api/staking/manual-unstake - Manually unstake a position (admin only)
router.post('/manual-unstake', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { wallet, positionId, force } = req.body;
    
    if (!wallet || !positionId) {
      return res.status(400).json({
        success: false,
        error: "Wallet address and position ID required"
      });
    }

    // Check if position exists
    const positionKey = `staking:${wallet}:position:${positionId}`;
    const positionExists = await redis.exists(positionKey);
    
    if (!positionExists) {
      return res.status(404).json({
        success: false,
        error: "Staking position not found"
      });
    }

    // Get position data
    const positionData = await redis.hGetAll(positionKey);
    const baseAmount = parseFloat(positionData.amount) || 0;
    const endTime = new Date(positionData.endTime);
    const now = new Date();
    const isEarly = now < endTime;

    // Calculate final amount (with penalty if early)
    let finalAmount = baseAmount;
    let penalty = 0;
    
    if (isEarly && !force) {
      return res.status(400).json({
        success: false,
        error: "Position not yet matured. Use force=true to apply 15% early unstaking penalty",
        timeRemaining: Math.max(0, endTime - now),
        earlyUnstakePenalty: "15%"
      });
    }
    
    if (isEarly && force) {
      penalty = baseAmount * 0.15; // 15% penalty
      finalAmount = baseAmount - penalty;
    }

    // Calculate rewards
    const startTime = new Date(positionData.startTime);
    const elapsed = now - startTime;
    const apy = parseFloat(positionData.apy) || 0;
    const rewards = (baseAmount * (apy / 100) * (elapsed / (365 * 24 * 60 * 60 * 1000)));

    // Update position status
    await redis.hSet(positionKey, {
      status: 'unstaked',
      unstakedAt: now.toISOString(),
      unstakedBy: 'admin',
      finalAmount: finalAmount.toFixed(2),
      penalty: penalty.toFixed(2),
      rewards: rewards.toFixed(2),
      totalReceived: (finalAmount + rewards).toFixed(2)
    });

    // Update global staking counters
    const currentTotalStaked = await redis.get("staking:total_amount") || 0;
    const currentActiveStakers = await redis.get("staking:active_count") || 0;
    
    await redis.set("staking:total_amount", Math.max(0, parseFloat(currentTotalStaked) - baseAmount));
    await redis.set("staking:active_count", Math.max(0, parseInt(currentActiveStakers) - 1));

    console.log(`🏦 Manual unstake by admin: ${wallet} - Position ${positionId} - Amount: ${finalAmount} WALDO`);

    return res.json({
      success: true,
      message: `Position ${positionId} has been unstaked`,
      unstakeDetails: {
        wallet: wallet,
        positionId: positionId,
        originalAmount: baseAmount,
        penalty: penalty,
        finalAmount: finalAmount,
        rewards: rewards.toFixed(2),
        totalReceived: (finalAmount + rewards).toFixed(2),
        wasEarly: isEarly,
        unstakedBy: 'admin'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error manually unstaking position:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to manually unstake position"
    });
  }
});

// GET /api/staking/stats - Get staking system statistics
router.get('/stats', async (req, res) => {
  try {
    // Get basic staking metrics
    const totalStaked = await redis.get("staking:total_amount") || 0;
    const activeStakers = await redis.get("staking:active_count") || 0;
    const totalUsers = await redis.get("users:total_count") || 0;

    // Get all staking positions for detailed stats
    const stakingKeys = await redis.keys("staking:*:position:*");
    const positionsByTier = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
    const positionsByStatus = { active: 0, completed: 0, unstaked: 0 };
    let totalRewards = 0;
    let totalPenalties = 0;

    for (const key of stakingKeys) {
      const positionData = await redis.hGetAll(key);
      
      if (positionData && Object.keys(positionData).length > 0) {
        const tier = positionData.tier || 'tier1';
        const status = positionData.status || 'active';
        
        if (positionsByTier.hasOwnProperty(tier)) {
          positionsByTier[tier]++;
        }
        
        if (positionsByStatus.hasOwnProperty(status)) {
          positionsByStatus[status]++;
        }

        // Add up rewards and penalties
        if (positionData.rewards) {
          totalRewards += parseFloat(positionData.rewards);
        }
        if (positionData.penalty) {
          totalPenalties += parseFloat(positionData.penalty);
        }
      }
    }

    // Calculate participation rate
    const participationRate = totalUsers > 0 ? ((activeStakers / totalUsers) * 100).toFixed(1) : 0;
    const averageStakePerUser = activeStakers > 0 ? (totalStaked / activeStakers).toFixed(2) : 0;

    const stakingStats = {
      overview: {
        totalStaked: parseFloat(totalStaked).toFixed(2),
        activeStakers: parseInt(activeStakers),
        totalPositions: stakingKeys.length,
        participationRate: `${participationRate}%`,
        averageStakePerUser: parseFloat(averageStakePerUser)
      },
      distribution: {
        byTier: positionsByTier,
        byStatus: positionsByStatus
      },
      rewards: {
        totalRewardsPaid: totalRewards.toFixed(2),
        totalPenaltiesCollected: totalPenalties.toFixed(2),
        netRewards: (totalRewards - totalPenalties).toFixed(2)
      },
      tiers: {
        tier1: { name: "30 Days", apy: "12%", minAmount: 100 },
        tier2: { name: "90 Days", apy: "18%", minAmount: 500 },
        tier3: { name: "180 Days", apy: "25%", minAmount: 1000 },
        tier4: { name: "365 Days", apy: "35%", minAmount: 2500 }
      },
      system: {
        earlyUnstakePenalty: "15%",
        autoRenewal: "enabled",
        lastUpdated: new Date().toISOString()
      }
    };

    console.log(`🏦 Staking stats requested: ${totalStaked} WALDO staked by ${activeStakers} users`);

    return res.json({
      success: true,
      stats: stakingStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting staking stats:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking statistics"
    });
  }
});

// POST /api/staking/stake - Create new staking position
router.post('/stake', async (req, res) => {
  try {
    const { wallet, amount, duration, tier } = req.body;

    if (!wallet || !amount || !duration) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, amount, duration"
      });
    }

    // Validate amount and duration
    if (amount < 100) {
      return res.status(400).json({
        success: false,
        error: "Minimum staking amount is 100 WALDO"
      });
    }

    if (![30, 90, 180, 365].includes(duration)) {
      return res.status(400).json({
        success: false,
        error: "Invalid duration. Must be 30, 90, 180, or 365 days"
      });
    }

    // Create staking position
    const stakeId = `stake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + (duration * 24 * 60 * 60 * 1000));

    // Calculate APY based on duration
    const apyRates = {
      30: 12,   // 12% APY for 30 days
      90: 18,   // 18% APY for 90 days
      180: 25,  // 25% APY for 180 days
      365: 35   // 35% APY for 365 days
    };

    const apy = apyRates[duration];
    const expectedReward = Math.floor((amount * apy / 100) * (duration / 365));

    const stakeData = {
      stakeId,
      wallet,
      amount: parseInt(amount),
      duration,
      tier: tier || 1,
      apy,
      expectedReward,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'active',
      createdAt: new Date().toISOString()
    };

    // Store staking position
    await redis.hSet(`staking:${stakeId}`, stakeData);
    await redis.sAdd(`staking:user:${wallet}`, stakeId);
    await redis.sAdd('staking:active', stakeId);

    // Update user stats
    await redis.hIncrBy(`user:${wallet}`, 'totalStaked', amount);
    await redis.hIncrBy(`user:${wallet}`, 'activeStakes', 1);

    // Update global stats
    await redis.incrBy('staking:total_staked', amount);
    await redis.incr('staking:total_positions');

    console.log(`🏦 Staking position created: ${wallet} staked ${amount} WALDO for ${duration} days`);

    return res.json({
      success: true,
      message: `Successfully staked ${amount} WALDO for ${duration} days!`,
      stakeId,
      expectedReward,
      apy,
      endDate: endDate.toISOString()
    });

  } catch (error) {
    console.error('❌ Staking error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to create staking position"
    });
  }
});

// GET /api/staking/positions/:wallet - Get user's staking positions
router.get('/positions/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    // Get user's stake IDs
    const stakeIds = await redis.sMembers(`staking:user:${wallet}`);
    const positions = [];

    for (const stakeId of stakeIds) {
      const stakeData = await redis.hGetAll(`staking:${stakeId}`);
      if (stakeData && Object.keys(stakeData).length > 0) {
        positions.push({
          stakeId: stakeData.stakeId,
          amount: parseInt(stakeData.amount),
          duration: parseInt(stakeData.duration),
          apy: parseFloat(stakeData.apy),
          expectedReward: parseInt(stakeData.expectedReward),
          startDate: stakeData.startDate,
          endDate: stakeData.endDate,
          status: stakeData.status,
          daysRemaining: Math.max(0, Math.ceil((new Date(stakeData.endDate) - new Date()) / (1000 * 60 * 60 * 24)))
        });
      }
    }

    return res.json({
      success: true,
      positions,
      totalPositions: positions.length,
      totalStaked: positions.reduce((sum, pos) => sum + pos.amount, 0)
    });

  } catch (error) {
    console.error('❌ Get positions error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking positions"
    });
  }
});

// POST /api/staking/unstake - Unstake position
router.post('/unstake', async (req, res) => {
  try {
    const { wallet, stakeId } = req.body;

    if (!wallet || !stakeId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, stakeId"
      });
    }

    // Get staking position
    const stakeData = await redis.hGetAll(`staking:${stakeId}`);

    if (!stakeData || Object.keys(stakeData).length === 0) {
      return res.status(404).json({
        success: false,
        error: "Staking position not found"
      });
    }

    if (stakeData.wallet !== wallet) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to unstake this position"
      });
    }

    if (stakeData.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: "Staking position is not active"
      });
    }

    const endDate = new Date(stakeData.endDate);
    const now = new Date();
    const isEarly = now < endDate;

    let returnAmount = parseInt(stakeData.amount);
    let penalty = 0;

    // Apply early unstaking penalty (15%)
    if (isEarly) {
      penalty = Math.floor(returnAmount * 0.15);
      returnAmount -= penalty;
    }

    // Mark as unstaked
    await redis.hSet(`staking:${stakeId}`, {
      status: 'unstaked',
      unstakedAt: now.toISOString(),
      returnAmount,
      penalty,
      earlyUnstake: isEarly
    });

    // Remove from active sets
    await redis.sRem(`staking:user:${wallet}`, stakeId);
    await redis.sRem('staking:active', stakeId);

    // Update stats
    await redis.decrBy('staking:total_staked', parseInt(stakeData.amount));
    await redis.decr('staking:total_positions');

    console.log(`🏦 Unstaking completed: ${wallet} unstaked ${returnAmount} WALDO (${penalty} penalty)`);

    return res.json({
      success: true,
      message: `Successfully unstaked! ${isEarly ? `Early unstaking penalty: ${penalty} WALDO` : ''}`,
      returnAmount,
      penalty,
      earlyUnstake: isEarly
    });

  } catch (error) {
    console.error('❌ Unstaking error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to unstake position"
    });
  }
});

export default router;
