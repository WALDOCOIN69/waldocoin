import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("👥 Loaded: routes/users.js");

// GET /api/users/list - Get user list (admin only) - Based on WALDO trustlines
router.get('/list', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const onlyTrustlines = req.query.trustlines === 'true';

    // Get user keys from Redis (these are wallets that interacted with the system)
    const userKeys = await redis.keys("user:*");
    const users = [];
    let trustlineUsers = [];

    for (const key of userKeys) {
      if (!key.includes(':battles') && !key.includes(':staking') && !key.includes(':votes')) {
        const userData = await redis.hGetAll(key);
        
        if (userData && Object.keys(userData).length > 0) {
          const walletAddress = key.split(':')[1];
          
          // Apply search filter if provided
          if (!search || 
              walletAddress.toLowerCase().includes(search.toLowerCase()) ||
              (userData.username && userData.username.toLowerCase().includes(search.toLowerCase())) ||
              (userData.twitterHandle && userData.twitterHandle.toLowerCase().includes(search.toLowerCase()))) {
            
            // Get additional user stats
            const battleStats = await redis.hGetAll(`user:${walletAddress}:battles`);
            const stakingStats = await redis.hGetAll(`user:${walletAddress}:staking`);
            
            // Check security status
            const isBlocked = await redis.exists(`security:blocked:${walletAddress}`);
            const isSuspicious = await redis.exists(`security:suspicious:${walletAddress}`);
            
            users.push({
              walletAddress: walletAddress,
              username: userData.username || `User_${walletAddress.slice(-6)}`,
              twitterHandle: userData.twitterHandle || null,
              xpLevel: parseInt(userData.xpLevel) || 1,
              totalXP: parseInt(userData.totalXP) || 0,
              waldoBalance: parseFloat(userData.waldoBalance) || 0,
              lastActive: userData.lastActive || 'Never',
              joinedAt: userData.joinedAt || 'Unknown',
              battles: {
                total: parseInt(battleStats.total) || 0,
                won: parseInt(battleStats.won) || 0,
                votes: parseInt(battleStats.votes) || 0
              },
              staking: {
                active: stakingStats.active === 'true',
                totalStaked: parseFloat(stakingStats.totalStaked) || 0,
                positions: parseInt(stakingStats.positions) || 0
              },
              security: {
                isBlocked: !!isBlocked,
                isSuspicious: !!isSuspicious,
                riskLevel: isBlocked ? 'HIGH' : isSuspicious ? 'MEDIUM' : 'LOW'
              },
              activity: {
                memesSubmitted: parseInt(userData.memesSubmitted) || 0,
                votescast: parseInt(userData.votesCast) || 0,
                daoParticipation: parseInt(userData.daoVotes) || 0
              }
            });
          }
        }
      }
    }

    // Sort by last active (most recent first)
    users.sort((a, b) => {
      if (a.lastActive === 'Never' && b.lastActive === 'Never') return 0;
      if (a.lastActive === 'Never') return 1;
      if (b.lastActive === 'Never') return -1;
      return new Date(b.lastActive) - new Date(a.lastActive);
    });

    // Calculate summary stats
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.lastActive !== 'Never' && 
      new Date() - new Date(u.lastActive) < 7 * 24 * 60 * 60 * 1000).length;
    const blockedUsers = users.filter(u => u.security.isBlocked).length;
    const stakingUsers = users.filter(u => u.staking.active).length;

    console.log(`👥 User list requested: ${users.length} users (search: "${search}")`);

    return res.json({
      success: true,
      users: users.slice(0, limit),
      summary: {
        totalUsers: totalUsers,
        activeUsers: activeUsers,
        blockedUsers: blockedUsers,
        stakingUsers: stakingUsers,
        averageXP: totalUsers > 0 ? (users.reduce((sum, u) => sum + u.totalXP, 0) / totalUsers).toFixed(1) : 0,
        averageWaldoBalance: totalUsers > 0 ? (users.reduce((sum, u) => sum + u.waldoBalance, 0) / totalUsers).toFixed(2) : 0
      },
      filter: {
        search: search,
        limit: limit,
        totalResults: users.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting user list:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user list"
    });
  }
});

// GET /api/users/stats - Get user statistics
router.get('/stats', async (req, res) => {
  try {
    // Get basic user counts
    const totalUsers = await redis.get("users:total_count") || 0;
    const activeUsers = await redis.get("users:active_count") || 0;

    // Get user distribution by XP level
    const userKeys = await redis.keys("user:*");
    const levelDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalXP = 0;
    let totalWaldo = 0;
    let usersWithTwitter = 0;

    for (const key of userKeys) {
      if (!key.includes(':battles') && !key.includes(':staking') && !key.includes(':votes')) {
        const userData = await redis.hGetAll(key);
        
        if (userData && Object.keys(userData).length > 0) {
          const xpLevel = parseInt(userData.xpLevel) || 1;
          if (levelDistribution.hasOwnProperty(xpLevel)) {
            levelDistribution[xpLevel]++;
          }
          
          totalXP += parseInt(userData.totalXP) || 0;
          totalWaldo += parseFloat(userData.waldoBalance) || 0;
          
          if (userData.twitterHandle) {
            usersWithTwitter++;
          }
        }
      }
    }

    const actualUserCount = Object.values(levelDistribution).reduce((sum, count) => sum + count, 0);

    // Get security stats
    const blockedUsers = await redis.keys("security:blocked:*");
    const suspiciousUsers = await redis.keys("security:suspicious:*");

    // Get engagement stats
    const battleParticipants = await redis.keys("user:*:battles");
    const stakingParticipants = await redis.keys("user:*:staking");

    const userStats = {
      overview: {
        totalUsers: Math.max(parseInt(totalUsers), actualUserCount),
        activeUsers: parseInt(activeUsers),
        newUsersToday: Math.floor(actualUserCount * 0.05), // Estimate
        retentionRate: actualUserCount > 0 ? ((parseInt(activeUsers) / actualUserCount) * 100).toFixed(1) : 0
      },
      distribution: {
        byLevel: levelDistribution,
        averageLevel: actualUserCount > 0 ? 
          (Object.entries(levelDistribution).reduce((sum, [level, count]) => sum + (parseInt(level) * count), 0) / actualUserCount).toFixed(2) : 1,
        levelProgression: {
          level1: `${levelDistribution[1]} users`,
          level2: `${levelDistribution[2]} users`,
          level3: `${levelDistribution[3]} users`,
          level4: `${levelDistribution[4]} users`,
          level5: `${levelDistribution[5]} users`
        }
      },
      engagement: {
        battleParticipants: battleParticipants.length,
        stakingParticipants: stakingParticipants.length,
        twitterConnected: usersWithTwitter,
        engagementRate: actualUserCount > 0 ? ((battleParticipants.length / actualUserCount) * 100).toFixed(1) : 0
      },
      economics: {
        totalXP: totalXP,
        averageXP: actualUserCount > 0 ? (totalXP / actualUserCount).toFixed(1) : 0,
        totalWaldoHeld: totalWaldo.toFixed(2),
        averageWaldoBalance: actualUserCount > 0 ? (totalWaldo / actualUserCount).toFixed(2) : 0
      },
      security: {
        blockedUsers: blockedUsers.length,
        suspiciousUsers: suspiciousUsers.length,
        securityRate: actualUserCount > 0 ? (((blockedUsers.length + suspiciousUsers.length) / actualUserCount) * 100).toFixed(2) : 0,
        cleanUsers: Math.max(0, actualUserCount - blockedUsers.length - suspiciousUsers.length)
      },
      growth: {
        dailyGrowthRate: "2.3%", // Placeholder
        weeklyGrowthRate: "15.7%", // Placeholder
        monthlyGrowthRate: "67.2%", // Placeholder
        churnRate: "8.1%" // Placeholder
      }
    };

    console.log(`👥 User stats requested: ${userStats.overview.totalUsers} total users`);

    return res.json({
      success: true,
      stats: userStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting user stats:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user statistics"
    });
  }
});

// GET /api/users/:wallet - Get specific user details (admin only)
router.get('/:wallet', async (req, res) => {
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

    // Get user data
    const userData = await redis.hGetAll(`user:${wallet}`);
    
    if (!userData || Object.keys(userData).length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Get additional user data
    const battleStats = await redis.hGetAll(`user:${wallet}:battles`);
    const stakingStats = await redis.hGetAll(`user:${wallet}:staking`);
    const voteHistory = await redis.lRange(`user:${wallet}:votes`, 0, 9); // Last 10 votes

    // Get security status
    const isBlocked = await redis.exists(`security:blocked:${wallet}`);
    const isSuspicious = await redis.exists(`security:suspicious:${wallet}`);
    const blockReason = isBlocked ? await redis.get(`security:blocked:${wallet}`) : null;

    const userDetails = {
      profile: {
        walletAddress: wallet,
        username: userData.username || `User_${wallet.slice(-6)}`,
        twitterHandle: userData.twitterHandle || null,
        joinedAt: userData.joinedAt || 'Unknown',
        lastActive: userData.lastActive || 'Never',
        status: isBlocked ? 'blocked' : isSuspicious ? 'suspicious' : 'active'
      },
      progression: {
        xpLevel: parseInt(userData.xpLevel) || 1,
        totalXP: parseInt(userData.totalXP) || 0,
        xpToNextLevel: Math.max(0, (parseInt(userData.xpLevel) * 1000) - parseInt(userData.totalXP)),
        levelProgress: ((parseInt(userData.totalXP) % 1000) / 1000 * 100).toFixed(1)
      },
      economics: {
        waldoBalance: parseFloat(userData.waldoBalance) || 0,
        totalEarned: parseFloat(userData.totalEarned) || 0,
        totalSpent: parseFloat(userData.totalSpent) || 0,
        netWorth: (parseFloat(userData.waldoBalance) + parseFloat(stakingStats.totalStaked || 0)).toFixed(2)
      },
      activity: {
        battles: {
          total: parseInt(battleStats.total) || 0,
          won: parseInt(battleStats.won) || 0,
          lost: parseInt(battleStats.lost) || 0,
          votes: parseInt(battleStats.votes) || 0,
          winRate: battleStats.total > 0 ? ((battleStats.won / battleStats.total) * 100).toFixed(1) : 0
        },
        staking: {
          active: stakingStats.active === 'true',
          totalStaked: parseFloat(stakingStats.totalStaked) || 0,
          positions: parseInt(stakingStats.positions) || 0,
          totalRewards: parseFloat(stakingStats.totalRewards) || 0
        },
        engagement: {
          memesSubmitted: parseInt(userData.memesSubmitted) || 0,
          votesCast: parseInt(userData.votesCast) || 0,
          daoParticipation: parseInt(userData.daoVotes) || 0,
          referrals: parseInt(userData.referrals) || 0
        }
      },
      security: {
        isBlocked: !!isBlocked,
        isSuspicious: !!isSuspicious,
        blockReason: blockReason,
        riskScore: isBlocked ? 100 : isSuspicious ? 50 : 10,
        lastSecurityCheck: new Date().toISOString()
      },
      recentActivity: voteHistory.map(vote => {
        try {
          return JSON.parse(vote);
        } catch {
          return { type: 'unknown', timestamp: new Date().toISOString() };
        }
      })
    };

    console.log(`👥 User details requested: ${wallet}`);

    return res.json({
      success: true,
      user: userDetails,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting user details:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user details"
    });
  }
});

// GET /api/users/trustline-count - Get count of wallets with WALDO trustline
router.get('/trustline-count', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    console.log('🔍 Querying XRPL for WALDO trustlines...');

    // Query XRPL directly for wallets holding WALDO trustlines
    // Use the WALDO issuer account to find all trustlines
    const xrplServers = [
      'https://xrplcluster.com',
      'https://s1.ripple.com:51234',
      'https://s2.ripple.com:51234'
    ];

    let trustlineCount = 0;
    let trustlineWallets = [];
    let lastError = null;

    for (const server of xrplServers) {
      try {
        console.log(`🌐 Trying XRPL server: ${server}`);

        const response = await fetch(server, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_lines',
            params: [{
              account: 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY', // WALDO issuer
              ledger_index: 'validated'
            }]
          })
        });

        const data = await response.json();

        if (data.result && data.result.lines) {
          // Filter for WALDO trustlines only
          const waldoTrustlines = data.result.lines.filter(line =>
            line.currency === 'WLO' || line.currency === 'WALDO'
          );

          trustlineCount = waldoTrustlines.length;
          trustlineWallets = waldoTrustlines.map(line => ({
            wallet: line.account,
            balance: parseFloat(line.balance || 0),
            limit: line.limit
          }));

          console.log(`✅ Found ${trustlineCount} WALDO trustlines`);

          // Success - return the data
          return res.json({
            success: true,
            trustlineCount: trustlineCount,
            trustlineWallets: trustlineWallets,
            summary: {
              totalTrustlines: trustlineCount,
              walletsWithBalance: trustlineWallets.filter(w => w.balance > 0).length,
              totalWaldoHeld: trustlineWallets.reduce((sum, w) => sum + w.balance, 0).toFixed(2)
            },
            source: 'XRPL',
            server: server,
            timestamp: new Date().toISOString()
          });
        } else {
          throw new Error(`Invalid XRPL response: ${JSON.stringify(data)}`);
        }

      } catch (serverError) {
        lastError = serverError;
        console.log(`❌ Failed to query ${server}:`, serverError.message);
        continue; // Try next server
      }
    }

    // If all servers failed, fall back to Redis count
    console.log('⚠️ All XRPL servers failed, falling back to Redis count');
    const userKeys = await redis.keys("user:*");
    const actualUserKeys = userKeys.filter(key =>
      !key.includes(':battles') &&
      !key.includes(':staking') &&
      !key.includes(':votes')
    );

    return res.json({
      success: true,
      trustlineCount: actualUserKeys.length,
      summary: {
        totalTrustlines: actualUserKeys.length,
        fallback: true,
        xrplError: lastError?.message
      },
      source: 'Redis (XRPL failed)',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting trustline count:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get trustline count",
      details: error.message
    });
  }
});

export default router;
