// routes/security.js - Security monitoring and fraud prevention API
import express from "express";
import { redis } from "../redisClient.js";
import { logViolation, isAutoBlocked } from "../utils/security.js";

const router = express.Router();

console.log("🧩 Loaded: routes/security.js");

// Admin authentication middleware
const adminAuth = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized access' 
    });
  }
  next();
};

// GET /api/security/violations - Get security violations
router.get("/violations", adminAuth, async (req, res) => {
  try {
    const { wallet, limit = 50 } = req.query;
    
    if (wallet) {
      // Get violations for specific wallet
      const logKey = `security:wallet:${wallet}:log`;
      const violations = await redis.lRange(logKey, 0, limit - 1);
      
      return res.json({
        success: true,
        wallet,
        violations: violations.map(v => JSON.parse(v)),
        isBlocked: await isAutoBlocked(wallet)
      });
    } else {
      // Get all violation keys
      const keys = await redis.keys('security:wallet:*:log');
      const allViolations = [];
      
      for (const key of keys.slice(0, 20)) { // Limit to 20 wallets
        const wallet = key.split(':')[2];
        const violations = await redis.lRange(key, 0, 4); // Last 5 violations
        
        if (violations.length > 0) {
          allViolations.push({
            wallet,
            violations: violations.map(v => JSON.parse(v)),
            isBlocked: await isAutoBlocked(wallet)
          });
        }
      }
      
      return res.json({
        success: true,
        violations: allViolations
      });
    }
  } catch (error) {
    console.error("❌ Error getting violations:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to get violations" 
    });
  }
});

// GET /api/security/blocked - Get blocked wallets
router.get("/blocked", adminAuth, async (req, res) => {
  try {
    const keys = await redis.keys('security:wallet:*:blocked');
    const blockedWallets = [];
    
    for (const key of keys) {
      const wallet = key.split(':')[2];
      const ttl = await redis.ttl(key);
      
      blockedWallets.push({
        wallet,
        expiresIn: ttl > 0 ? ttl : 'permanent',
        expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null
      });
    }
    
    return res.json({
      success: true,
      blockedWallets,
      count: blockedWallets.length
    });
  } catch (error) {
    console.error("❌ Error getting blocked wallets:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to get blocked wallets" 
    });
  }
});

// POST /api/security/block - Manually block a wallet
router.post("/block", adminAuth, async (req, res) => {
  try {
    const { wallet, reason, duration = 604800 } = req.body; // Default 7 days
    
    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required"
      });
    }
    
    const blockKey = `security:wallet:${wallet}:blocked`;
    await redis.set(blockKey, '1', { EX: duration });
    
    await logViolation(wallet, 'MANUAL_BLOCK', { 
      reason: reason || 'Manual admin block',
      duration,
      admin: true 
    });
    
    return res.json({
      success: true,
      message: `Wallet ${wallet} blocked for ${duration} seconds`,
      wallet,
      duration
    });
  } catch (error) {
    console.error("❌ Error blocking wallet:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to block wallet" 
    });
  }
});

// POST /api/security/unblock - Unblock a wallet
router.post("/unblock", adminAuth, async (req, res) => {
  try {
    const { wallet } = req.body;
    
    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required"
      });
    }
    
    const blockKey = `security:wallet:${wallet}:blocked`;
    const logKey = `security:wallet:${wallet}:log`;
    
    await redis.del(blockKey);
    await redis.del(logKey); // Clear violation history
    
    return res.json({
      success: true,
      message: `Wallet ${wallet} unblocked and violation history cleared`,
      wallet
    });
  } catch (error) {
    console.error("❌ Error unblocking wallet:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to unblock wallet" 
    });
  }
});

// GET /api/security/stats - Security statistics
router.get("/stats", adminAuth, async (req, res) => {
  try {
    const violationKeys = await redis.keys('security:wallet:*:log');
    const blockedKeys = await redis.keys('security:wallet:*:blocked');
    const rateLimitKeys = await redis.keys('rateLimit:*');
    
    // Count violations by type
    const violationTypes = {};
    let totalViolations = 0;
    
    for (const key of violationKeys.slice(0, 100)) { // Limit processing
      const violations = await redis.lRange(key, 0, -1);
      for (const violation of violations) {
        try {
          const parsed = JSON.parse(violation);
          violationTypes[parsed.reason] = (violationTypes[parsed.reason] || 0) + 1;
          totalViolations++;
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return res.json({
      success: true,
      stats: {
        totalViolations,
        violationTypes,
        blockedWallets: blockedKeys.length,
        activeRateLimits: rateLimitKeys.length,
        walletsWithViolations: violationKeys.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error getting security stats:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to get security statistics" 
    });
  }
});

// GET /api/security/check/:wallet - Check wallet security status
router.get("/check/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet || !wallet.startsWith('r')) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet address"
      });
    }
    
    const isBlocked = await isAutoBlocked(wallet);
    const logKey = `security:wallet:${wallet}:log`;
    const violations = await redis.lRange(logKey, 0, 9); // Last 10 violations
    
    // Check current rate limits
    const rateLimitKeys = await redis.keys(`rateLimit:${wallet}:*`);
    const rateLimits = {};
    
    for (const key of rateLimitKeys) {
      const action = key.split(':')[2];
      const count = await redis.get(key);
      const ttl = await redis.ttl(key);
      rateLimits[action] = { count: parseInt(count), expiresIn: ttl };
    }
    
    return res.json({
      success: true,
      wallet,
      isBlocked,
      violationCount: violations.length,
      recentViolations: violations.slice(0, 5).map(v => JSON.parse(v)),
      rateLimits,
      status: isBlocked ? 'BLOCKED' : violations.length > 0 ? 'FLAGGED' : 'CLEAN'
    });
  } catch (error) {
    console.error("❌ Error checking wallet security:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to check wallet security" 
    });
  }
});

export default router;
