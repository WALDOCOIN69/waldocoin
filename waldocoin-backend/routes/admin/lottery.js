/**
 * 🎰 ADMIN LOTTERY SYSTEM
 *
 * Monthly NFT Holder Lottery - NOT REVENUE SHARING
 * Scans XRPL blockchain directly to find NFT holders
 *
 * Rules (from Whitepaper):
 * - 5 random winners selected from all NFT holders
 * - KING NFT holders: GUARANTEED winners (split 50% of pool)
 * - Lottery winners: Split remaining 50% of pool
 * - Higher tiers = more lottery tickets = better odds
 */

import express from 'express';
import {
  getLotteryStatus,
  runMonthlyLottery,
  addToLotteryPool,
  getLotteryHistory,
  getNFTHolders
} from '../../utils/xrplNFTScanner.js';

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
 * Get current lottery pool status and eligible holders (scans XRPL)
 */
router.get('/status', verifyAdmin, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const status = await getLotteryStatus();

    // Format for admin panel display
    const kingHolders = status.holders.filter(h => h.guaranteed || h.hasKingNFT);
    const regularHolders = status.holders.filter(h => !h.guaranteed && !h.hasKingNFT);

    res.json({
      success: true,
      currentPool: status.pool,
      lastScan: status.lastScan,
      stats: status.stats,
      kingHolders: {
        count: kingHolders.length,
        list: kingHolders.map(h => ({
          wallet: h.wallet.slice(0, 8) + '...' + h.wallet.slice(-4),
          fullWallet: h.wallet,
          tier: h.tier,
          emoji: h.tierEmoji,
          nftCount: h.nftCount
        })),
        poolShare: '50% (guaranteed)'
      },
      regularHolders: {
        count: regularHolders.length,
        totalTickets: status.stats.totalTickets,
        list: regularHolders.map(h => ({
          wallet: h.wallet.slice(0, 8) + '...' + h.wallet.slice(-4),
          fullWallet: h.wallet,
          tier: h.tier,
          emoji: h.tierEmoji,
          nftCount: h.nftCount,
          tickets: h.tickets
        }))
      },
      lotteryRules: {
        winners: 5,
        kingGuaranteed: true,
        ticketDistribution: {
          silver: '1 ticket per NFT (1-2 NFTs)',
          gold: '2 tickets per NFT (3-9 NFTs)',
          platinum: '3 tickets per NFT (10+ NFTs)',
          king: 'AUTO-WINNER (guaranteed)'
        }
      },
      lastResult: status.lastResult
    });
  } catch (error) {
    console.error('❌ Lottery status error:', error);
    res.status(500).json({ success: false, error: error.message });
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

    res.json({
      success: true,
      message: '🎉 Lottery complete!',
      date: result.date,
      totalPool: result.totalPool,
      kingPoolShare: result.kingPoolShare,
      lotteryPoolShare: result.lotteryPoolShare,
      kingWinners: result.kingWinners,
      lotteryWinners: result.lotteryWinners,
      totalHolders: result.totalHolders,
      totalTickets: result.totalTickets
    });
  } catch (error) {
    console.error('❌ Lottery run error:', error);
    res.status(500).json({ success: false, error: error.message });
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
      return res.status(400).json({ success: false, error: 'Valid amount required' });
    }

    const newTotal = await addToLotteryPool(parseFloat(amount));

    console.log(`💰 Admin added ${amount} WALDO to lottery pool. New total: ${newTotal}`);

    res.json({
      success: true,
      added: amount,
      newPoolTotal: newTotal
    });
  } catch (error) {
    console.error('❌ Add to pool error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/lottery/history
 * Get full lottery history
 */
router.get('/history', verifyAdmin, async (req, res) => {
  try {
    const history = await getLotteryHistory(50);

    res.json({
      success: true,
      count: history.length,
      lotteries: history
    });
  } catch (error) {
    console.error('❌ Lottery history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/lottery/refresh
 * Force refresh NFT holder data from XRPL
 */
router.post('/refresh', verifyAdmin, async (req, res) => {
  try {
    console.log('🔄 Force refreshing NFT holder data from XRPL...');
    const holders = await getNFTHolders(true);

    res.json({
      success: true,
      message: 'NFT holder data refreshed from XRPL',
      holdersFound: holders.length,
      totalNFTs: holders.reduce((sum, h) => sum + h.nftCount, 0)
    });
  } catch (error) {
    console.error('❌ Refresh error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
