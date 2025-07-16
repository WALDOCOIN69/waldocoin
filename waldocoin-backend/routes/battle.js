import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("⚔️ Loaded: routes/battle.js");

// GET /api/battle/current - Get current active battle
router.get('/current', async (req, res) => {
  try {
    // Get current battle ID
    const currentBattleId = await redis.get("battle:current");
    
    if (!currentBattleId) {
      return res.json({
        success: true,
        active: false,
        message: "No active battle currently"
      });
    }

    // Get battle details
    const battleData = await redis.hGetAll(`battle:${currentBattleId}`);
    
    if (!battleData || Object.keys(battleData).length === 0) {
      return res.json({
        success: true,
        active: false,
        message: "Battle data not found"
      });
    }

    // Get vote counts
    const meme1Votes = await redis.get(`battle:${currentBattleId}:meme1:votes`) || 0;
    const meme2Votes = await redis.get(`battle:${currentBattleId}:meme2:votes`) || 0;

    const battle = {
      id: currentBattleId,
      active: true,
      startTime: battleData.startTime,
      endTime: battleData.endTime,
      status: battleData.status || 'active',
      meme1: {
        id: battleData.meme1Id,
        title: battleData.meme1Title || 'Meme 1',
        votes: parseInt(meme1Votes),
        imageUrl: battleData.meme1Image || '/placeholder-meme.jpg'
      },
      meme2: {
        id: battleData.meme2Id,
        title: battleData.meme2Title || 'Meme 2',
        votes: parseInt(meme2Votes),
        imageUrl: battleData.meme2Image || '/placeholder-meme.jpg'
      },
      totalVotes: parseInt(meme1Votes) + parseInt(meme2Votes),
      timeRemaining: battleData.endTime ? Math.max(0, new Date(battleData.endTime) - new Date()) : 0
    };

    console.log(`⚔️ Current battle requested: ${currentBattleId} (${battle.totalVotes} votes)`);

    return res.json({
      success: true,
      active: true,
      battle: battle
    });

  } catch (error) {
    console.error('❌ Error getting current battle:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get current battle"
    });
  }
});

// GET /api/battle/leaderboard - Get battle leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    // Get user battle stats
    const userKeys = await redis.keys("user:*:battles");
    const leaderboard = [];

    for (const key of userKeys.slice(0, limit)) {
      const walletAddress = key.split(':')[1];
      const battleStats = await redis.hGetAll(key);
      
      if (battleStats && Object.keys(battleStats).length > 0) {
        const userData = await redis.hGetAll(`user:${walletAddress}`);
        
        leaderboard.push({
          walletAddress: walletAddress,
          username: userData.username || `User_${walletAddress.slice(-6)}`,
          battlesWon: parseInt(battleStats.won) || 0,
          battlesLost: parseInt(battleStats.lost) || 0,
          totalBattles: parseInt(battleStats.total) || 0,
          winRate: battleStats.total > 0 ? ((battleStats.won / battleStats.total) * 100).toFixed(1) : 0,
          totalVotes: parseInt(battleStats.votes) || 0,
          xpEarned: parseInt(battleStats.xp) || 0,
          lastActive: userData.lastActive || new Date().toISOString()
        });
      }
    }

    // Sort by battles won, then by win rate
    leaderboard.sort((a, b) => {
      if (b.battlesWon !== a.battlesWon) return b.battlesWon - a.battlesWon;
      return parseFloat(b.winRate) - parseFloat(a.winRate);
    });

    console.log(`⚔️ Battle leaderboard requested: ${leaderboard.length} users`);

    return res.json({
      success: true,
      leaderboard: leaderboard.slice(0, limit),
      totalUsers: leaderboard.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting battle leaderboard:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get battle leaderboard"
    });
  }
});

// GET /api/battle/history - Get recent battle history
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    // Get completed battles
    const battleKeys = await redis.keys("battle:*");
    const completedBattles = [];

    for (const key of battleKeys) {
      if (key.includes(':') && !key.includes('current')) {
        const battleId = key.split(':')[1];
        const battleData = await redis.hGetAll(key);
        
        if (battleData && battleData.status === 'completed') {
          const meme1Votes = await redis.get(`battle:${battleId}:meme1:votes`) || 0;
          const meme2Votes = await redis.get(`battle:${battleId}:meme2:votes`) || 0;
          
          completedBattles.push({
            id: battleId,
            startTime: battleData.startTime,
            endTime: battleData.endTime,
            winner: battleData.winner || 'tie',
            meme1: {
              title: battleData.meme1Title || 'Meme 1',
              votes: parseInt(meme1Votes)
            },
            meme2: {
              title: battleData.meme2Title || 'Meme 2',
              votes: parseInt(meme2Votes)
            },
            totalVotes: parseInt(meme1Votes) + parseInt(meme2Votes),
            duration: battleData.endTime && battleData.startTime ? 
              new Date(battleData.endTime) - new Date(battleData.startTime) : 0
          });
        }
      }
    }

    // Sort by end time (most recent first)
    completedBattles.sort((a, b) => new Date(b.endTime) - new Date(a.endTime));

    console.log(`⚔️ Battle history requested: ${completedBattles.length} battles`);

    return res.json({
      success: true,
      battles: completedBattles.slice(0, limit),
      totalBattles: completedBattles.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting battle history:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get battle history"
    });
  }
});

// POST /api/battle/force-end - Force end current battle (admin only)
router.post('/force-end', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const currentBattleId = await redis.get("battle:current");
    
    if (!currentBattleId) {
      return res.json({
        success: false,
        error: "No active battle to end"
      });
    }

    // Mark battle as completed
    await redis.hSet(`battle:${currentBattleId}`, {
      status: 'force_ended',
      endTime: new Date().toISOString(),
      endedBy: 'admin'
    });

    // Clear current battle
    await redis.del("battle:current");

    // Update battle counts
    const totalBattles = await redis.get("battles:total_count") || 0;
    await redis.set("battles:total_count", parseInt(totalBattles) + 1);
    await redis.set("battles:active_count", 0);

    console.log(`⚔️ Battle ${currentBattleId} force ended by admin`);

    return res.json({
      success: true,
      message: `Battle ${currentBattleId} has been force ended`,
      battleId: currentBattleId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error force ending battle:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to force end battle"
    });
  }
});

// POST /api/battle/cancel - Cancel current battle (admin only)
router.post('/cancel', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const currentBattleId = await redis.get("battle:current");
    
    if (!currentBattleId) {
      return res.json({
        success: false,
        error: "No active battle to cancel"
      });
    }

    // Mark battle as cancelled
    await redis.hSet(`battle:${currentBattleId}`, {
      status: 'cancelled',
      endTime: new Date().toISOString(),
      cancelledBy: 'admin'
    });

    // Clear current battle
    await redis.del("battle:current");
    await redis.set("battles:active_count", 0);

    console.log(`⚔️ Battle ${currentBattleId} cancelled by admin`);

    return res.json({
      success: true,
      message: `Battle ${currentBattleId} has been cancelled`,
      battleId: currentBattleId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error cancelling battle:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to cancel battle"
    });
  }
});

export default router;
