import express from 'express';
import { redis } from '../../redisClient.js';
import { getEscrowBalance, getEscrowAlerts, detectStuckFunds, getEscrowTransactionHistory } from '../../utils/escrowMonitor.js';
import { getRateLimitStats, getRateLimitStatus, clearRateLimit } from '../../utils/rateLimiter.js';
import { getErrorStats } from '../../utils/errorHandler.js';

const router = express.Router();

console.log("🧩 Loaded: routes/admin/systemMonitoring.js");

// Middleware to check admin authentication
router.use(async (req, res, next) => {
  const adminKey = req.headers['x-admin-key'] || req.body.adminKey;
  const expectedKey = process.env.X_ADMIN_KEY;

  if (!adminKey || adminKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Invalid admin key"
    });
  }

  next();
});

// GET /api/admin/system-monitoring/dashboard - Get comprehensive system overview
router.get('/dashboard', async (req, res) => {
  try {
    const [
      escrowBalance,
      escrowAlerts,
      stuckFunds,
      rateLimitStats,
      errorStats,
      systemHealth
    ] = await Promise.all([
      getEscrowBalance().catch(e => ({ error: e.message })),
      getEscrowAlerts(10).catch(e => ({ error: e.message })),
      detectStuckFunds().catch(e => ({ error: e.message })),
      getRateLimitStats(1).catch(e => ({ error: e.message })),
      getErrorStats(24).catch(e => ({ error: e.message })),
      getSystemHealth().catch(e => ({ error: e.message }))
    ]);

    return res.json({
      success: true,
      dashboard: {
        escrow: {
          balance: escrowBalance,
          alerts: escrowAlerts,
          stuckFunds: stuckFunds
        },
        rateLimiting: rateLimitStats,
        errors: errorStats,
        system: systemHealth,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ System monitoring dashboard error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to load system monitoring dashboard"
    });
  }
});

// GET /api/admin/system-monitoring/escrow - Get detailed escrow information
router.get('/escrow', async (req, res) => {
  try {
    const [balance, alerts, stuckFunds, transactions] = await Promise.all([
      getEscrowBalance(),
      getEscrowAlerts(20),
      detectStuckFunds(),
      getEscrowTransactionHistory(100)
    ]);

    return res.json({
      success: true,
      escrow: {
        balance,
        alerts,
        stuckFunds,
        transactions,
        summary: {
          totalTransactions: transactions.length,
          alertCount: alerts.length,
          lastUpdated: balance?.lastUpdated || null
        }
      }
    });
  } catch (error) {
    console.error('❌ Escrow monitoring error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to load escrow monitoring data"
    });
  }
});

// GET /api/admin/system-monitoring/rate-limits - Get rate limiting information
router.get('/rate-limits', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 1;
    const stats = await getRateLimitStats(hours);

    return res.json({
      success: true,
      rateLimits: stats
    });
  } catch (error) {
    console.error('❌ Rate limit monitoring error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to load rate limit monitoring data"
    });
  }
});

// POST /api/admin/system-monitoring/rate-limits/clear - Clear rate limit for identifier
router.post('/rate-limits/clear', async (req, res) => {
  try {
    const { action, identifier } = req.body;

    if (!action || !identifier) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: action, identifier"
      });
    }

    const cleared = await clearRateLimit(action, identifier);

    return res.json({
      success: cleared,
      message: cleared 
        ? `Rate limit cleared for ${action}:${identifier}`
        : `Failed to clear rate limit for ${action}:${identifier}`
    });
  } catch (error) {
    console.error('❌ Rate limit clear error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to clear rate limit"
    });
  }
});

// GET /api/admin/system-monitoring/errors - Get error statistics
router.get('/errors', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const stats = await getErrorStats(hours);

    return res.json({
      success: true,
      errors: stats
    });
  } catch (error) {
    console.error('❌ Error monitoring error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to load error monitoring data"
    });
  }
});

// GET /api/admin/system-monitoring/battles - Get battle system health
router.get('/battles', async (req, res) => {
  try {
    const battleHealth = await getBattleSystemHealth();

    return res.json({
      success: true,
      battles: battleHealth
    });
  } catch (error) {
    console.error('❌ Battle monitoring error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to load battle monitoring data"
    });
  }
});

// Helper function to get system health
async function getSystemHealth() {
  try {
    const [redisInfo, memoryUsage, activeConnections] = await Promise.all([
      redis.info('memory').catch(() => 'unavailable'),
      getMemoryUsage().catch(() => ({ error: 'unavailable' })),
      getActiveConnections().catch(() => 0)
    ]);

    return {
      redis: {
        status: redisInfo !== 'unavailable' ? 'healthy' : 'error',
        info: redisInfo
      },
      memory: memoryUsage,
      connections: activeConnections,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Helper function to get memory usage
async function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024), // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
    external: Math.round(usage.external / 1024 / 1024), // MB
    arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024) // MB
  };
}

// Helper function to get active connections (simplified)
async function getActiveConnections() {
  try {
    // This is a simplified version - in production you might want more detailed metrics
    const keys = await redis.keys('*');
    return keys.length;
  } catch (error) {
    return 0;
  }
}

// Helper function to get battle system health
async function getBattleSystemHealth() {
  try {
    const [activeBattles, pendingBattles, expiredBattles, totalVotes] = await Promise.all([
      redis.keys('battle:*:data').then(keys => keys.length),
      redis.get('battle:current').then(id => id ? 1 : 0),
      getExpiredBattles(),
      getTotalVotes()
    ]);

    return {
      activeBattles,
      pendingBattles,
      expiredBattles,
      totalVotes,
      health: activeBattles < 100 ? 'healthy' : 'warning', // Arbitrary threshold
      lastCheck: new Date().toISOString()
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Helper function to get expired battles
async function getExpiredBattles() {
  try {
    const battleKeys = await redis.keys('battle:*:data');
    let expiredCount = 0;
    const now = Date.now();

    for (const key of battleKeys) {
      const battle = await redis.hgetall(key);
      if (battle.expiresAt && parseInt(battle.expiresAt) < now) {
        expiredCount++;
      }
    }

    return expiredCount;
  } catch (error) {
    return 0;
  }
}

// Helper function to get total votes
async function getTotalVotes() {
  try {
    const voteKeys = await redis.keys('battle:*:vote:*');
    return voteKeys.length;
  } catch (error) {
    return 0;
  }
}

export default router;
