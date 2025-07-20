import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("🛡️ Loaded: routes/security.js");

// GET /api/security/overview - Get security overview
router.get('/overview', async (req, res) => {
  try {
    // Get blocked users
    const blockedUsers = await redis.keys("security:blocked:*");
    const suspiciousUsers = await redis.keys("security:suspicious:*");
    const flaggedTransactions = await redis.keys("security:flagged:*");

    // Get recent security events
    const recentEvents = await redis.lRange("security:events", 0, 9); // Last 10 events

    const events = [];
    for (const eventStr of recentEvents) {
      try {
        events.push(JSON.parse(eventStr));
      } catch (e) {
        console.warn('Failed to parse security event:', eventStr);
      }
    }

    // Calculate security metrics
    const totalUsers = await redis.get("users:total_count") || 0;
    const blockedRate = totalUsers > 0 ? ((blockedUsers.length / totalUsers) * 100).toFixed(2) : 0;
    const suspiciousRate = totalUsers > 0 ? ((suspiciousUsers.length / totalUsers) * 100).toFixed(2) : 0;

    const overview = {
      blockedUsers: blockedUsers.length,
      suspiciousUsers: suspiciousUsers.length,
      flaggedTransactions: flaggedTransactions.length,
      blockedRate: `${blockedRate}%`,
      suspiciousRate: `${suspiciousRate}%`,
      recentEvents: events,
      systemStatus: {
        fraudDetection: 'active',
        autoBlocking: 'enabled',
        rateLimit: 'active',
        lastScan: new Date().toISOString()
      },
      alerts: [
        {
          level: 'info',
          message: `${blockedUsers.length} users currently blocked`,
          timestamp: new Date().toISOString()
        },
        {
          level: 'warning',
          message: `${suspiciousUsers.length} users flagged as suspicious`,
          timestamp: new Date().toISOString()
        }
      ]
    };

    console.log(`🛡️ Security overview requested: ${blockedUsers.length} blocked, ${suspiciousUsers.length} suspicious`);

    return res.json({
      success: true,
      overview: overview,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting security overview:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get security overview"
    });
  }
});

// GET /api/security/check/:wallet - Check wallet security status
router.get('/check/:wallet', async (req, res) => {
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

    // Check various security flags
    const isBlocked = await redis.exists(`security:blocked:${wallet}`);
    const isSuspicious = await redis.exists(`security:suspicious:${wallet}`);
    const blockReason = isBlocked ? await redis.get(`security:blocked:${wallet}`) : null;
    const suspiciousReason = isSuspicious ? await redis.get(`security:suspicious:${wallet}`) : null;

    // Get user activity data
    const userData = await redis.hGetAll(`user:${wallet}`);
    const userBattles = await redis.hGetAll(`user:${wallet}:battles`);
    const userStaking = await redis.hGetAll(`user:${wallet}:staking`);

    // Calculate risk score
    let riskScore = 0;
    const riskFactors = [];

    if (isBlocked) {
      riskScore += 100;
      riskFactors.push('User is blocked');
    }
    if (isSuspicious) {
      riskScore += 50;
      riskFactors.push('Flagged as suspicious');
    }

    // Check activity patterns
    const totalBattles = parseInt(userBattles.total) || 0;
    const totalVotes = parseInt(userBattles.votes) || 0;
    const lastActive = userData.lastActive;

    if (totalVotes > totalBattles * 10) {
      riskScore += 25;
      riskFactors.push('Unusual voting pattern');
    }

    if (lastActive && new Date() - new Date(lastActive) > 30 * 24 * 60 * 60 * 1000) {
      riskScore += 10;
      riskFactors.push('Inactive for 30+ days');
    }

    const securityStatus = {
      wallet: wallet,
      isBlocked: !!isBlocked,
      isSuspicious: !!isSuspicious,
      blockReason: blockReason,
      suspiciousReason: suspiciousReason,
      riskScore: Math.min(riskScore, 100),
      riskLevel: riskScore >= 75 ? 'HIGH' : riskScore >= 50 ? 'MEDIUM' : riskScore >= 25 ? 'LOW' : 'MINIMAL',
      riskFactors: riskFactors,
      userData: {
        username: userData.username || 'Unknown',
        lastActive: lastActive,
        totalBattles: totalBattles,
        totalVotes: totalVotes,
        stakingActive: !!userStaking.active
      },
      recommendations: riskScore > 50 ? ['Monitor closely', 'Review recent activity'] : ['No action needed'],
      lastChecked: new Date().toISOString()
    };

    console.log(`🛡️ Security check for ${wallet}: Risk ${securityStatus.riskLevel} (${riskScore})`);

    return res.json({
      success: true,
      security: securityStatus
    });

  } catch (error) {
    console.error('❌ Error checking wallet security:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to check wallet security"
    });
  }
});

// POST /api/security/block - Block a user (admin only)
router.post('/block', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { wallet, reason } = req.body;
    
    if (!wallet || !reason) {
      return res.status(400).json({
        success: false,
        error: "Wallet address and reason required"
      });
    }

    // Block the user
    await redis.set(`security:blocked:${wallet}`, reason);
    
    // Log security event
    const event = {
      type: 'user_blocked',
      wallet: wallet,
      reason: reason,
      admin: true,
      timestamp: new Date().toISOString()
    };
    
    await redis.lPush("security:events", JSON.stringify(event));
    await redis.lTrim("security:events", 0, 99); // Keep last 100 events

    console.log(`🛡️ User blocked by admin: ${wallet} - ${reason}`);

    return res.json({
      success: true,
      message: `User ${wallet} has been blocked`,
      reason: reason,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error blocking user:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to block user"
    });
  }
});

// POST /api/security/unblock - Unblock a user (admin only)
router.post('/unblock', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { wallet, reason } = req.body;
    
    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required"
      });
    }

    // Check if user is blocked
    const isBlocked = await redis.exists(`security:blocked:${wallet}`);
    
    if (!isBlocked) {
      return res.json({
        success: false,
        error: "User is not currently blocked"
      });
    }

    // Unblock the user
    await redis.del(`security:blocked:${wallet}`);
    await redis.del(`security:suspicious:${wallet}`); // Also remove suspicious flag
    
    // Log security event
    const event = {
      type: 'user_unblocked',
      wallet: wallet,
      reason: reason || 'Admin unblock',
      admin: true,
      timestamp: new Date().toISOString()
    };
    
    await redis.lPush("security:events", JSON.stringify(event));
    await redis.lTrim("security:events", 0, 99);

    console.log(`🛡️ User unblocked by admin: ${wallet} - ${reason || 'No reason provided'}`);

    return res.json({
      success: true,
      message: `User ${wallet} has been unblocked`,
      reason: reason || 'Admin unblock',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error unblocking user:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to unblock user"
    });
  }
});

// GET /api/security/events - Get recent security events
router.get('/events', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const eventStrings = await redis.lRange("security:events", 0, limit - 1);
    
    const events = [];
    for (const eventStr of eventStrings) {
      try {
        events.push(JSON.parse(eventStr));
      } catch (e) {
        console.warn('Failed to parse security event:', eventStr);
      }
    }

    console.log(`🛡️ Security events requested: ${events.length} events`);

    return res.json({
      success: true,
      events: events,
      totalEvents: events.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting security events:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get security events"
    });
  }
});

// GET /api/security/fraud-analytics - Get fraud detection analytics
router.get('/fraud-analytics', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get fraud analytics from Redis
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    // Count violations in last 24 hours
    const violationKeys = await redis.keys('violation:*');
    let totalViolations = 0;
    let botDetections = 0;
    let blockedWallets = 0;

    for (const key of violationKeys) {
      const violation = await redis.hGetAll(key);
      if (violation.timestamp && new Date(violation.timestamp).getTime() > oneDayAgo) {
        totalViolations++;
        if (violation.reason && violation.reason.includes('BOT')) {
          botDetections++;
        }
      }
    }

    // Count currently blocked wallets
    const blockedKeys = await redis.keys('blocked:*');
    blockedWallets = blockedKeys.length;

    // Estimate clean requests (total requests - violations)
    const totalRequests = await redis.get('stats:total_requests') || 0;
    const cleanRequests = Math.max(0, parseInt(totalRequests) - totalViolations);

    return res.json({
      success: true,
      analytics: {
        totalViolations,
        botDetections,
        blockedWallets,
        cleanRequests,
        detectionRate: totalRequests > 0 ? ((totalViolations / totalRequests) * 100).toFixed(2) : 0
      }
    });

  } catch (error) {
    console.error('❌ Error getting fraud analytics:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get fraud analytics"
    });
  }
});

// GET /api/security/recent-violations - Get recent security violations
router.get('/recent-violations', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const limit = parseInt(req.query.limit) || 20;

    // Get recent violations
    const violationKeys = await redis.keys('violation:*');
    const violations = [];

    for (const key of violationKeys) {
      const violation = await redis.hGetAll(key);
      if (violation && Object.keys(violation).length > 0) {
        violations.push({
          wallet: violation.wallet,
          reason: violation.reason,
          timestamp: violation.timestamp,
          meta: violation.meta ? JSON.parse(violation.meta) : null
        });
      }
    }

    // Sort by timestamp (newest first)
    violations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({
      success: true,
      violations: violations.slice(0, limit),
      totalViolations: violations.length
    });

  } catch (error) {
    console.error('❌ Error getting recent violations:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get recent violations"
    });
  }
});

// GET /api/security/suspicious-activity - Get suspicious activity
router.get('/suspicious-activity', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const limit = parseInt(req.query.limit) || 15;

    // Get suspicious activity (violations with risk scores)
    const violationKeys = await redis.keys('violation:*');
    const suspiciousActivity = [];

    for (const key of violationKeys) {
      const violation = await redis.hGetAll(key);
      if (violation && violation.reason && violation.reason.includes('SUSPICIOUS')) {
        const meta = violation.meta ? JSON.parse(violation.meta) : {};
        suspiciousActivity.push({
          wallet: violation.wallet,
          timestamp: violation.timestamp,
          riskScore: meta.botScore || meta.riskScore || 60,
          patterns: meta.detectedPatterns || ['Unknown pattern']
        });
      }
    }

    // Sort by risk score (highest first)
    suspiciousActivity.sort((a, b) => b.riskScore - a.riskScore);

    return res.json({
      success: true,
      activity: suspiciousActivity.slice(0, limit),
      totalSuspicious: suspiciousActivity.length
    });

  } catch (error) {
    console.error('❌ Error getting suspicious activity:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get suspicious activity"
    });
  }
});

export default router;
