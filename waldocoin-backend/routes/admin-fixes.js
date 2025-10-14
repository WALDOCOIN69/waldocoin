import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("🔧 Loaded: routes/admin-fixes.js - Missing admin endpoints");

// Middleware to validate admin access
const validateAdmin = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.X_ADMIN_KEY) {
    return res.status(403).json({ success: false, error: "Unauthorized access" });
  }
  next();
};

// GET /api/admin-fixes/test - Test endpoint
router.get('/test', validateAdmin, async (req, res) => {
  res.json({ 
    success: true, 
    message: "Admin fixes endpoint working",
    timestamp: new Date().toISOString()
  });
});

// GET /api/admin-fixes/users/list - Fixed user list endpoint
router.get('/users/list', validateAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    // Get airdrop claimed wallets as a base user list
    const claimedWallets = await redis.sMembers("airdrop:wallets");
    
    // Get user data for each wallet
    const users = [];
    for (let i = 0; i < Math.min(claimedWallets.length, limit); i++) {
      const wallet = claimedWallets[i];
      const userData = await redis.hGetAll(`user:${wallet}`);
      
      users.push({
        walletAddress: wallet,
        username: userData.username || `User_${wallet.slice(-6)}`,
        twitterHandle: userData.twitterHandle || null,
        xp: parseInt(userData.xp) || 0,
        level: parseInt(userData.level) || 1,
        joinDate: userData.joinDate || new Date().toISOString(),
        lastActive: userData.lastActive || new Date().toISOString(),
        isBlocked: false,
        isSuspicious: false,
        totalClaims: 1, // They claimed airdrop
        totalStaked: 0
      });
    }
    
    res.json({
      success: true,
      users: users,
      totalUsers: users.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting user list:', error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to get user list",
      details: error.message 
    });
  }
});

// GET /api/admin-fixes/security/recent-violations - Mock security violations
router.get('/security/recent-violations', validateAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      violations: [],
      totalViolations: 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get violations" });
  }
});

// GET /api/admin-fixes/security/suspicious-activity - Mock suspicious activity
router.get('/security/suspicious-activity', validateAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      activities: [],
      totalActivities: 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get suspicious activity" });
  }
});

// POST /api/admin-fixes/security/export-violations - Mock export
router.post('/security/export-violations', validateAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      message: "No violations to export",
      exportUrl: null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to export violations" });
  }
});

// POST /api/admin-fixes/security/clear-old-violations - Mock clear
router.post('/security/clear-old-violations', validateAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      message: "No old violations to clear",
      cleared: 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to clear violations" });
  }
});

// GET /api/admin-fixes/airdrop/claimed-list - Get claimed wallets list
router.get('/airdrop/claimed-list', validateAdmin, async (req, res) => {
  try {
    const claimedWallets = await redis.sMembers("airdrop:wallets");
    const totalClaimed = await redis.get("airdrop:count") || 0;
    
    res.json({
      success: true,
      claimedWallets: claimedWallets,
      totalClaimed: parseInt(totalClaimed),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get claimed list" });
  }
});

// GET /api/admin-fixes/airdrop/export-claimed - Export claimed wallets
router.get('/airdrop/export-claimed', validateAdmin, async (req, res) => {
  try {
    const claimedWallets = await redis.sMembers("airdrop:wallets");
    const csvData = claimedWallets.map(wallet => `${wallet},50000,${new Date().toISOString()}`).join('\n');
    const csvContent = 'Wallet,Amount,Date\n' + csvData;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="claimed-wallets.csv"');
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to export claimed wallets" });
  }
});

// POST /api/admin-fixes/airdrop/add-missing-wallet - Add wallet to tracking
router.post('/airdrop/add-missing-wallet', validateAdmin, async (req, res) => {
  try {
    const { wallet, reason } = req.body;
    
    if (!wallet) {
      return res.status(400).json({ success: false, error: "Wallet address required" });
    }
    
    // Add to claimed set
    await redis.sAdd("airdrop:wallets", wallet);
    
    res.json({
      success: true,
      message: `Wallet ${wallet} added to tracking`,
      wallet: wallet,
      reason: reason || "Manual addition",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to add wallet" });
  }
});

// GET /api/admin-fixes/airdrop/failed-transactions - Mock failed transactions
router.get('/airdrop/failed-transactions', validateAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      failedTransactions: [],
      totalFailed: 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get failed transactions" });
  }
});

// POST /api/admin-fixes/airdrop/retry-transaction - Mock retry
router.post('/airdrop/retry-transaction', validateAdmin, async (req, res) => {
  try {
    const { transactionId } = req.body;
    
    res.json({
      success: true,
      message: "No failed transactions to retry",
      transactionId: transactionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to retry transaction" });
  }
});

export default router;
