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

// POST /api/battle/start - Start a new battle
router.post('/start', async (req, res) => {
  try {
    const { wallet, tweetId } = req.body;

    if (!wallet || !tweetId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, tweetId"
      });
    }

    // Check minimum WALDO balance requirement (6 XRP worth)
    const userData = await redis.hGetAll(`user:${wallet}`);
    const waldoBalance = parseInt(userData.waldoBalance) || 0;

    const waldoPerXrp = await redis.get("conversion:waldo_per_xrp") || 1000;
    const minimumWaldo = 6 * waldoPerXrp; // 6 XRP worth

    if (waldoBalance < minimumWaldo) {
      return res.status(400).json({
        success: false,
        error: `Minimum ${minimumWaldo.toLocaleString()} WALDO (6 XRP worth) required to start battles`,
        minimumRequired: minimumWaldo,
        currentBalance: waldoBalance
      });
    }

    // Check if there's already an active battle
    const currentBattleId = await redis.get("battle:current");
    if (currentBattleId) {
      return res.status(400).json({
        success: false,
        error: "A battle is already active. Wait for it to complete."
      });
    }

    // Create new battle
    const battleId = `battle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + (24 * 60 * 60 * 1000)); // 24 hours

    const battleData = {
      battleId,
      challenger: wallet,
      challengerTweetId: tweetId,
      opponent: null,
      opponentTweetId: null,
      status: 'waiting_opponent',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      votes: {},
      totalVotes: 0,
      winner: null
    };

    // Store battle
    await redis.hSet(`battle:${battleId}`, battleData);
    await redis.set("battle:current", battleId, { EX: 24 * 60 * 60 }); // 24 hour expiry

    console.log(`⚔️ Battle started: ${battleId} by ${wallet}`);

    return res.json({
      success: true,
      message: "Battle started! Waiting for opponent.",
      battleId,
      endTime: endTime.toISOString()
    });

  } catch (error) {
    console.error('❌ Start battle error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to start battle"
    });
  }
});

// POST /api/battle/accept - Accept a battle challenge
router.post('/accept', async (req, res) => {
  try {
    const { wallet, tweetId } = req.body;

    if (!wallet || !tweetId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, tweetId"
      });
    }

    // Get current battle
    const currentBattleId = await redis.get("battle:current");
    if (!currentBattleId) {
      return res.status(400).json({
        success: false,
        error: "No active battle to accept"
      });
    }

    const battleData = await redis.hGetAll(`battle:${currentBattleId}`);

    if (battleData.status !== 'waiting_opponent') {
      return res.status(400).json({
        success: false,
        error: "Battle is not accepting opponents"
      });
    }

    if (battleData.challenger === wallet) {
      return res.status(400).json({
        success: false,
        error: "Cannot accept your own battle"
      });
    }

    // Update battle with opponent
    await redis.hSet(`battle:${currentBattleId}`, {
      opponent: wallet,
      opponentTweetId: tweetId,
      status: 'active',
      acceptedAt: new Date().toISOString()
    });

    console.log(`⚔️ Battle accepted: ${currentBattleId} by ${wallet}`);

    return res.json({
      success: true,
      message: "Battle accepted! Voting is now open.",
      battleId: currentBattleId
    });

  } catch (error) {
    console.error('❌ Accept battle error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to accept battle"
    });
  }
});

// POST /api/battle/vote - Vote in a battle
router.post('/vote', async (req, res) => {
  try {
    const { wallet, meme } = req.body; // meme: 'challenger' or 'opponent'

    if (!wallet || !meme) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, meme"
      });
    }

    if (!['challenger', 'opponent'].includes(meme)) {
      return res.status(400).json({
        success: false,
        error: "Invalid meme choice. Must be 'challenger' or 'opponent'"
      });
    }

    // Get current battle
    const currentBattleId = await redis.get("battle:current");
    if (!currentBattleId) {
      return res.status(400).json({
        success: false,
        error: "No active battle to vote in"
      });
    }

    const battleData = await redis.hGetAll(`battle:${currentBattleId}`);

    if (battleData.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: "Battle is not accepting votes"
      });
    }

    // Check if user already voted
    const voteKey = `vote:${currentBattleId}:${wallet}`;
    const existingVote = await redis.get(voteKey);

    if (existingVote) {
      return res.status(400).json({
        success: false,
        error: "You have already voted in this battle"
      });
    }

    // Record vote
    await redis.set(voteKey, meme, { EX: 24 * 60 * 60 }); // 24 hour expiry
    await redis.hIncrBy(`battle:${currentBattleId}`, `votes_${meme}`, 1);
    await redis.hIncrBy(`battle:${currentBattleId}`, 'totalVotes', 1);

    console.log(`🗳️ Vote recorded: ${wallet} voted for ${meme} in ${currentBattleId}`);

    return res.json({
      success: true,
      message: `Vote recorded for ${meme}!`,
      vote: meme
    });

  } catch (error) {
    console.error('❌ Vote battle error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to record vote"
    });
  }
});

// GET /api/battle/history - Get battle history
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Get completed battles
    const battleKeys = await redis.keys('battle:battle_*');
    const battles = [];

    for (const key of battleKeys.slice(0, limit)) {
      const battleData = await redis.hGetAll(key);
      if (battleData && battleData.status === 'completed') {
        battles.push({
          battleId: battleData.battleId,
          challenger: battleData.challenger,
          opponent: battleData.opponent,
          winner: battleData.winner,
          totalVotes: parseInt(battleData.totalVotes) || 0,
          challengerVotes: parseInt(battleData.votes_challenger) || 0,
          opponentVotes: parseInt(battleData.votes_opponent) || 0,
          startTime: battleData.startTime,
          endTime: battleData.endTime,
          completedAt: battleData.completedAt
        });
      }
    }

    // Sort by completion date (newest first)
    battles.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    return res.json({
      success: true,
      battles: battles.slice(0, limit),
      totalBattles: battles.length
    });

  } catch (error) {
    console.error('❌ Battle history error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get battle history"
    });
  }
});

// GET /api/battle/leaderboard - Get battle leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Get all user battle stats
    const userKeys = await redis.keys('user:*');
    const leaderboard = [];

    for (const userKey of userKeys) {
      const userData = await redis.hGetAll(userKey);
      if (userData && userData.battleWins) {
        const wallet = userKey.replace('user:', '');
        leaderboard.push({
          wallet,
          wins: parseInt(userData.battleWins) || 0,
          losses: parseInt(userData.battleLosses) || 0,
          totalBattles: (parseInt(userData.battleWins) || 0) + (parseInt(userData.battleLosses) || 0),
          winRate: userData.battleWins ? ((parseInt(userData.battleWins) / ((parseInt(userData.battleWins) || 0) + (parseInt(userData.battleLosses) || 0))) * 100).toFixed(1) : '0.0',
          totalVotes: parseInt(userData.totalVotesReceived) || 0,
          reputation: parseInt(userData.battleReputation) || 0
        });
      }
    }

    // Sort by wins, then by win rate
    leaderboard.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return parseFloat(b.winRate) - parseFloat(a.winRate);
    });

    return res.json({
      success: true,
      leaderboard: leaderboard.slice(0, limit),
      totalPlayers: leaderboard.length
    });

  } catch (error) {
    console.error('❌ Battle leaderboard error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get battle leaderboard"
    });
  }
});

export default router;
