import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("📊 Loaded: routes/activity.js");

// GET /api/activity - Get user activity feed
router.get('/', async (req, res) => {
  try {
    const { wallet } = req.query;
    const limit = parseInt(req.query.limit) || 20;

    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: wallet"
      });
    }

    // Get user's activity from Redis
    const activityKey = `activity:${wallet}`;
    const activities = await redis.lRange(activityKey, 0, limit - 1);

    const parsedActivities = activities.map(activity => {
      try {
        return JSON.parse(activity);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // If no activities found, create some sample activities based on user data
    if (parsedActivities.length === 0) {
      const userData = await redis.hGetAll(`user:${wallet}`);
      const sampleActivities = [];

      // Add Twitter linking activity if linked
      if (userData.twitterHandle) {
        sampleActivities.push({
          type: 'twitter_linked',
          message: `Linked Twitter account @${userData.twitterHandle}`,
          timestamp: userData.twitterLinkedAt || new Date().toISOString(),
          icon: '🐦',
          xp: 100
        });
      }

      // Add meme activities based on user stats
      const totalMemes = parseInt(userData.totalMemes) || 0;
      if (totalMemes > 0) {
        sampleActivities.push({
          type: 'meme_posted',
          message: `Posted ${totalMemes} memes with #WaldoMeme`,
          timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
          icon: '🎭',
          xp: totalMemes * 10
        });
      }

      // Add level up activities
      const currentLevel = parseInt(userData.level) || 1;
      if (currentLevel > 1) {
        sampleActivities.push({
          type: 'level_up',
          message: `Reached Level ${currentLevel}!`,
          timestamp: new Date(Date.now() - Math.random() * 14 * 24 * 60 * 60 * 1000).toISOString(),
          icon: '⭐',
          xp: currentLevel * 50
        });
      }

      // Add battle activities
      const battleWins = parseInt(userData.battleWins) || 0;
      if (battleWins > 0) {
        sampleActivities.push({
          type: 'battle_won',
          message: `Won ${battleWins} meme battles`,
          timestamp: new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000).toISOString(),
          icon: '⚔️',
          xp: battleWins * 25
        });
      }

      // Add staking activities
      const totalStaked = parseInt(userData.totalStaked) || 0;
      if (totalStaked > 0) {
        sampleActivities.push({
          type: 'staking_started',
          message: `Started staking ${totalStaked} WALDO`,
          timestamp: new Date(Date.now() - Math.random() * 5 * 24 * 60 * 60 * 1000).toISOString(),
          icon: '🏦',
          xp: Math.floor(totalStaked / 10)
        });
      }

      // Sort by timestamp (newest first)
      sampleActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return res.json({
        success: true,
        activity: sampleActivities.slice(0, limit),
        totalActivities: sampleActivities.length,
        generated: true // Indicates these are generated from user stats
      });
    }

    return res.json({
      success: true,
      activity: parsedActivities,
      totalActivities: parsedActivities.length,
      generated: false
    });

  } catch (error) {
    console.error('❌ Activity feed error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get activity feed"
    });
  }
});

// POST /api/activity - Add activity to user's feed
router.post('/', async (req, res) => {
  try {
    const { wallet, type, message, xp, metadata } = req.body;

    if (!wallet || !type || !message) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, type, message"
      });
    }

    const activity = {
      type,
      message,
      timestamp: new Date().toISOString(),
      xp: xp || 0,
      metadata: metadata || {},
      icon: getActivityIcon(type)
    };

    // Add to user's activity feed (keep last 100 activities)
    const activityKey = `activity:${wallet}`;
    await redis.lPush(activityKey, JSON.stringify(activity));
    await redis.lTrim(activityKey, 0, 99); // Keep only last 100

    console.log(`📊 Activity added: ${wallet} - ${type}: ${message}`);

    return res.json({
      success: true,
      message: "Activity added successfully",
      activity
    });

  } catch (error) {
    console.error('❌ Add activity error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to add activity"
    });
  }
});

// Helper function to get activity icons
function getActivityIcon(type) {
  const icons = {
    'twitter_linked': '🐦',
    'meme_posted': '🎭',
    'meme_claimed': '💰',
    'level_up': '⭐',
    'battle_won': '⚔️',
    'battle_lost': '💔',
    'battle_challenged': '🎯',
    'battle_challenge_sent': '⚔️',
    'battle_started': '🚀',
    'battle_accepted': '🤜',
    'battle_voted': '🗳️',
    'staking_started': '🏦',
    'staking_completed': '💎',
    'dao_voted': '🗳️',
    'nft_minted': '🖼️',
    'referral_earned': '📣',
    'achievement_unlocked': '🏆'
  };

  return icons[type] || '📊';
}

// Helper function to add activity notification
export async function addActivityNotification(wallet, type, message, xp = 0, metadata = {}) {
  try {
    const activity = {
      type,
      message,
      timestamp: new Date().toISOString(),
      xp,
      metadata,
      icon: getActivityIcon(type)
    };

    const activityKey = `activity:${wallet}`;
    await redis.lPush(activityKey, JSON.stringify(activity));
    await redis.lTrim(activityKey, 0, 99); // Keep only last 100

    console.log(`📊 Activity notification: ${wallet} - ${type}: ${message}`);
    return activity;
  } catch (error) {
    console.error('❌ Failed to add activity notification:', error);
    return null;
  }
}

export default router;
