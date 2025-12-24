/**
 * 🎰 ADMIN LOTTERY SYSTEM
 * 
 * Monthly NFT Holder Lottery - NOT REVENUE SHARING
 * 
 * Rules (from Whitepaper):
 * - 5 random winners selected from all NFT holders
 * - KING NFT holders: GUARANTEED winners (split 50% of pool)
 * - Lottery winners: Split remaining 50% of pool
 * - Higher tiers = more lottery tickets = better odds
 */

import express from 'express';
import redis from '../../utils/redis.js';
import { runMonthlyLottery, getHolderTier } from '../../utils/nftUtilities.js';

const router = express.Router();

// Admin secret key check
const verifyAdmin = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Unauthorized - Invalid admin key' });
  }
  next();
};

/**
 * GET /api/admin/lottery/status
 * Get current lottery pool status and eligible holders
 */
router.get('/status', verifyAdmin, async (req, res) => {
  try {
    const poolKey = 'nft:holder_reward_pool';
    const poolAmount = parseFloat(await redis.get(poolKey)) || 0;

    // Get all NFT holders
    const holderKeys = await redis.keys('wallet:nft_count:*');
    const kingHolders = [];
    const regularHolders = [];
    let totalTickets = 0;

    for (const key of holderKeys) {
      const wallet = key.replace('wallet:nft_count:', '');
      const nftCount = parseInt(await redis.get(key)) || 0;

      if (nftCount >= 1) {
        const tier = await getHolderTier(wallet);
        
        if (tier.isKing || tier.guaranteedWinner) {
          kingHolders.push({ wallet: wallet.slice(0, 8) + '...' + wallet.slice(-4), tier: tier.name, nftCount });
        } else {
          const tickets = tier.lotteryTickets || nftCount;
          regularHolders.push({ wallet: wallet.slice(0, 8) + '...' + wallet.slice(-4), tier: tier.name, nftCount, tickets });
          totalTickets += tickets;
        }
      }
    }

    // Get last lottery results
    const month = new Date().toISOString().slice(0, 7);
    const lastLottery = await redis.get(`nft:lottery:${month}`);
    const lotteryHistory = await redis.lRange('nft:lottery_history', 0, 4);

    res.json({
      success: true,
      currentPool: poolAmount,
      kingHolders: {
        count: kingHolders.length,
        list: kingHolders,
        poolShare: '50% (guaranteed)'
      },
      regularHolders: {
        count: regularHolders.length,
        totalTickets,
        list: regularHolders.slice(0, 20) // Limit to first 20 for display
      },
      lotteryRules: {
        winners: 5,
        kingGuaranteed: true,
        ticketDistribution: {
          silver: '1 ticket per NFT',
          gold: '2 tickets per NFT',
          platinum: '3 tickets per NFT',
          king: 'AUTO-WINNER'
        }
      },
      lastLotteryThisMonth: lastLottery ? JSON.parse(lastLottery) : null,
      recentHistory: lotteryHistory.map(h => JSON.parse(h))
    });
  } catch (error) {
    console.error('❌ Lottery status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/lottery/run
 * Run the monthly lottery drawing
 */
router.post('/run', verifyAdmin, async (req, res) => {
  try {
    console.log('🎰 Admin triggered monthly lottery...');
    
    const result = await runMonthlyLottery();
    
    if (result.success) {
      res.json({
        success: true,
        message: '🎉 Lottery complete!',
        totalDistributed: result.totalDistributed,
        kingWinners: result.kingWinners,
        lotteryWinners: result.lotteryWinners,
        distributions: result.distributions
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Lottery run error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/lottery/add-to-pool
 * Manually add WALDO to the lottery pool
 */
router.post('/add-to-pool', verifyAdmin, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    const poolKey = 'nft:holder_reward_pool';
    const newTotal = await redis.incrByFloat(poolKey, parseFloat(amount));

    console.log(`💰 Admin added ${amount} WALDO to lottery pool. New total: ${newTotal}`);

    res.json({
      success: true,
      added: amount,
      newPoolTotal: newTotal
    });
  } catch (error) {
    console.error('❌ Add to pool error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/lottery/history
 * Get full lottery history
 */
router.get('/history', verifyAdmin, async (req, res) => {
  try {
    const history = await redis.lRange('nft:lottery_history', 0, 49);
    
    res.json({
      success: true,
      count: history.length,
      lotteries: history.map(h => JSON.parse(h))
    });
  } catch (error) {
    console.error('❌ Lottery history error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

