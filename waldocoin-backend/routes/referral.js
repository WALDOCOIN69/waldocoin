import express from 'express';
import { createClient } from 'redis';

const router = express.Router();

// Redis client
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redis.on('error', (err) => console.log('Redis Client Error', err));

// Connect to Redis
if (!redis.isOpen) {
  await redis.connect();
}

// ✅ POST /api/referral/register - Register a new referral relationship
router.post('/register', async (req, res) => {
  try {
    const { wallet, referrer } = req.body;

    // Validate input
    if (!wallet || !referrer) {
      return res.status(400).json({
        success: false,
        error: 'Missing wallet or referrer address'
      });
    }

    // Validate wallet addresses (basic XRPL format check)
    if (!wallet.startsWith('r') || wallet.length < 25 || wallet.length > 35) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address format'
      });
    }

    if (!referrer.startsWith('r') || referrer.length < 25 || referrer.length > 35) {
      return res.status(400).json({
        success: false,
        error: 'Invalid referrer address format'
      });
    }

    // Prevent self-referral
    if (wallet === referrer) {
      return res.status(400).json({
        success: false,
        error: 'Cannot refer yourself'
      });
    }

    // Check if user already has a referrer
    const existingReferrer = await redis.get(`user:${wallet}:referrer`);
    if (existingReferrer) {
      return res.status(400).json({
        success: false,
        error: 'User already has a referrer',
        existingReferrer
      });
    }

    // Check if referrer exists (has some activity)
    const referrerExists = await redis.exists(`user:${referrer}:stats`);
    if (!referrerExists) {
      // Create basic stats for referrer if they don't exist
      await redis.set(`user:${referrer}:stats`, JSON.stringify({
        wallet: referrer,
        xp: 0,
        level: 1,
        likes: 0,
        retweets: 0,
        memes: 0,
        battles: 0,
        referrals: []
      }));
    }

    // Register the referral relationship
    await redis.set(`user:${wallet}:referrer`, referrer);
    
    // Add to referrer's referral list
    const referrerStats = await redis.get(`user:${referrer}:stats`);
    let stats = referrerStats ? JSON.parse(referrerStats) : {
      wallet: referrer,
      xp: 0,
      level: 1,
      likes: 0,
      retweets: 0,
      memes: 0,
      battles: 0,
      referrals: []
    };

    // Add new referral to list
    if (!stats.referrals) stats.referrals = [];
    stats.referrals.push({
      wallet: wallet,
      timestamp: new Date().toISOString(),
      status: 'registered'
    });

    // Update referrer stats
    await redis.set(`user:${referrer}:stats`, JSON.stringify(stats));

    // Log referral event
    const referralEvent = {
      type: 'referral_registered',
      referrer: referrer,
      referred: wallet,
      timestamp: new Date().toISOString(),
      reward_pending: true
    };

    await redis.lPush('referral_events', JSON.stringify(referralEvent));

    // Award immediate referral bonus (5000 WALDO)
    try {
      await awardReferralBonus(referrer, wallet);
    } catch (e) {
      console.warn('Failed to award referral bonus:', e);
      // Don't fail the registration if bonus fails
    }

    console.log(`✅ Referral registered: ${wallet} referred by ${referrer}`);

    res.json({
      success: true,
      message: 'Referral registered successfully',
      referrer: referrer,
      referred: wallet,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error registering referral:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register referral'
    });
  }
});

// ✅ GET /api/referral/stats/:wallet - Get referral statistics for a wallet
router.get('/stats/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || !wallet.startsWith('r')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address'
      });
    }

    // Get user's referrer
    const referrer = await redis.get(`user:${wallet}:referrer`);

    // Get user's referrals
    const userStats = await redis.get(`user:${wallet}:stats`);
    const stats = userStats ? JSON.parse(userStats) : { referrals: [] };
    const referrals = stats.referrals || [];

    // Get referral events for this user
    const referralEvents = await redis.lRange('referral_events', 0, -1);
    const userEvents = referralEvents
      .map(event => {
        try {
          return JSON.parse(event);
        } catch {
          return null;
        }
      })
      .filter(event => event && (event.referrer === wallet || event.referred === wallet));

    res.json({
      success: true,
      stats: {
        wallet: wallet,
        referrer: referrer,
        referralCount: referrals.length,
        referrals: referrals,
        events: userEvents,
        totalRewards: userEvents
          .filter(e => e.referrer === wallet && e.reward_amount)
          .reduce((sum, e) => sum + (e.reward_amount || 0), 0)
      }
    });

  } catch (error) {
    console.error('❌ Error getting referral stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get referral statistics'
    });
  }
});

// Helper function to award referral bonus
async function awardReferralBonus(referrerWallet, referredWallet) {
  try {
    // Award 5000 WALDO to referrer
    const bonusAmount = 5000;
    
    // This would integrate with your WALDO distribution system
    // For now, just log the event and store it for manual processing
    const bonusEvent = {
      type: 'referral_bonus',
      referrer: referrerWallet,
      referred: referredWallet,
      amount: bonusAmount,
      currency: 'WALDO',
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    await redis.lPush('referral_bonuses', JSON.stringify(bonusEvent));
    
    console.log(`💰 Referral bonus queued: ${bonusAmount} WALDO for ${referrerWallet}`);
    
    // TODO: Integrate with actual WALDO distribution system
    // This could call your existing WALDO distribution functions
    
  } catch (error) {
    console.error('❌ Error awarding referral bonus:', error);
    throw error;
  }
}

// ✅ GET /api/referral/leaderboard - Get referral leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Get all user stats to find top referrers
    const keys = await redis.keys('user:*:stats');
    const leaderboard = [];

    for (const key of keys) {
      const statsData = await redis.get(key);
      if (statsData) {
        try {
          const stats = JSON.parse(statsData);
          if (stats.referrals && stats.referrals.length > 0) {
            leaderboard.push({
              wallet: stats.wallet,
              referralCount: stats.referrals.length,
              level: stats.level || 1,
              xp: stats.xp || 0
            });
          }
        } catch (e) {
          // Skip invalid entries
        }
      }
    }

    // Sort by referral count, then by XP
    leaderboard.sort((a, b) => {
      if (b.referralCount !== a.referralCount) {
        return b.referralCount - a.referralCount;
      }
      return b.xp - a.xp;
    });

    res.json({
      success: true,
      leaderboard: leaderboard.slice(0, limit),
      total: leaderboard.length
    });

  } catch (error) {
    console.error('❌ Error getting referral leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get referral leaderboard'
    });
  }
});

export default router;
