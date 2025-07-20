import express from 'express';
import { redis } from '../redisClient.js';

const router = express.Router();

console.log("🗳️ Loaded: routes/dao.js");

// GET /api/dao/proposals - Get active DAO proposals
router.get('/proposals', async (req, res) => {
  try {
    const status = req.query.status || 'active';
    const limit = parseInt(req.query.limit) || 20;
    
    // Get proposal keys based on status
    const proposalKeys = await redis.keys(`dao:proposal:*`);
    const proposals = [];

    for (const key of proposalKeys) {
      const proposalData = await redis.hGetAll(key);
      
      if (proposalData && Object.keys(proposalData).length > 0) {
        const proposalId = key.split(':')[2];
        
        // Get vote counts
        const yesVotes = await redis.get(`dao:proposal:${proposalId}:yes`) || 0;
        const noVotes = await redis.get(`dao:proposal:${proposalId}:no`) || 0;
        const totalVotes = parseInt(yesVotes) + parseInt(noVotes);
        
        // Check if proposal matches status filter
        if (status === 'all' || proposalData.status === status) {
          proposals.push({
            id: proposalId,
            title: proposalData.title || `Proposal ${proposalId}`,
            description: proposalData.description || 'No description provided',
            proposer: proposalData.proposer || 'Unknown',
            status: proposalData.status || 'active',
            type: proposalData.type || 'general',
            createdAt: proposalData.createdAt,
            expiresAt: proposalData.expiresAt,
            votes: {
              yes: parseInt(yesVotes),
              no: parseInt(noVotes),
              total: totalVotes
            },
            quorum: parseInt(proposalData.quorum) || 100,
            quorumMet: totalVotes >= (parseInt(proposalData.quorum) || 100),
            passingThreshold: parseFloat(proposalData.threshold) || 0.6,
            currentSupport: totalVotes > 0 ? (parseInt(yesVotes) / totalVotes) : 0,
            timeRemaining: proposalData.expiresAt ? 
              Math.max(0, new Date(proposalData.expiresAt) - new Date()) : 0
          });
        }
      }
    }

    // Sort by creation date (newest first)
    proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    console.log(`🗳️ DAO proposals requested: ${proposals.length} proposals (status: ${status})`);

    return res.json({
      success: true,
      proposals: proposals.slice(0, limit),
      totalProposals: proposals.length,
      filter: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting DAO proposals:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get DAO proposals"
    });
  }
});

// GET /api/dao/stats - Get DAO statistics
router.get('/stats', async (req, res) => {
  try {
    // Get proposal counts by status
    const proposalKeys = await redis.keys(`dao:proposal:*`);
    const stats = {
      active: 0,
      passed: 0,
      failed: 0,
      expired: 0,
      total: 0
    };

    let totalVotes = 0;
    let totalParticipants = 0;

    for (const key of proposalKeys) {
      const proposalData = await redis.hGetAll(key);
      if (proposalData && Object.keys(proposalData).length > 0) {
        const status = proposalData.status || 'active';
        if (stats.hasOwnProperty(status)) {
          stats[status]++;
        }
        stats.total++;

        // Count votes for participation stats
        const proposalId = key.split(':')[2];
        const yesVotes = await redis.get(`dao:proposal:${proposalId}:yes`) || 0;
        const noVotes = await redis.get(`dao:proposal:${proposalId}:no`) || 0;
        totalVotes += parseInt(yesVotes) + parseInt(noVotes);
      }
    }

    // Get unique voters
    const voterKeys = await redis.keys(`dao:voter:*`);
    totalParticipants = voterKeys.length;

    // Calculate participation metrics
    const totalUsers = await redis.get("users:total_count") || 0;
    const participationRate = totalUsers > 0 ? ((totalParticipants / totalUsers) * 100).toFixed(1) : 0;
    const averageVotesPerProposal = stats.total > 0 ? (totalVotes / stats.total).toFixed(1) : 0;

    const daoStats = {
      proposals: stats,
      participation: {
        totalVoters: totalParticipants,
        totalVotes: totalVotes,
        participationRate: `${participationRate}%`,
        averageVotesPerProposal: parseFloat(averageVotesPerProposal)
      },
      governance: {
        quorumRequirement: 100, // Default quorum
        passingThreshold: 60, // 60% yes votes
        proposalDuration: 7, // 7 days
        minimumWaldoToPropose: 10000,
        minimumWaldoToVote: 100
      },
      treasury: {
        totalFunds: await redis.get("dao:treasury:balance") || 0,
        lastDistribution: await redis.get("dao:treasury:last_distribution"),
        pendingProposals: stats.active
      },
      recentActivity: {
        proposalsThisWeek: stats.active, // Simplified
        votesThisWeek: Math.floor(totalVotes * 0.3), // Estimate
        newVotersThisWeek: Math.floor(totalParticipants * 0.1) // Estimate
      }
    };

    console.log(`🗳️ DAO stats requested: ${stats.total} total proposals, ${totalParticipants} participants`);

    return res.json({
      success: true,
      stats: daoStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting DAO stats:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get DAO statistics"
    });
  }
});

// POST /api/dao/create-proposal - Create new proposal (admin only)
router.post('/create-proposal', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { title, description, type, duration, quorum, threshold } = req.body;
    
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: "Title and description required"
      });
    }

    // Generate proposal ID
    const proposalId = `prop_${Date.now()}`;
    const expiresAt = new Date(Date.now() + (duration || 7) * 24 * 60 * 60 * 1000);

    // Create proposal
    const proposalData = {
      title: title,
      description: description,
      proposer: 'admin',
      status: 'active',
      type: type || 'general',
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      quorum: quorum || 100,
      threshold: threshold || 0.6
    };

    await redis.hSet(`dao:proposal:${proposalId}`, proposalData);
    
    // Initialize vote counters
    await redis.set(`dao:proposal:${proposalId}:yes`, 0);
    await redis.set(`dao:proposal:${proposalId}:no`, 0);

    console.log(`🗳️ New proposal created by admin: ${proposalId} - ${title}`);

    return res.json({
      success: true,
      message: "Proposal created successfully",
      proposal: {
        id: proposalId,
        ...proposalData,
        votes: { yes: 0, no: 0, total: 0 }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error creating proposal:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to create proposal"
    });
  }
});

// POST /api/dao/close-proposal - Close a proposal (admin only)
router.post('/close-proposal', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { proposalId, reason } = req.body;
    
    if (!proposalId) {
      return res.status(400).json({
        success: false,
        error: "Proposal ID required"
      });
    }

    // Check if proposal exists
    const proposalExists = await redis.exists(`dao:proposal:${proposalId}`);
    
    if (!proposalExists) {
      return res.status(404).json({
        success: false,
        error: "Proposal not found"
      });
    }

    // Get current vote counts
    const yesVotes = await redis.get(`dao:proposal:${proposalId}:yes`) || 0;
    const noVotes = await redis.get(`dao:proposal:${proposalId}:no`) || 0;
    const totalVotes = parseInt(yesVotes) + parseInt(noVotes);

    // Get proposal data to check quorum and threshold
    const proposalData = await redis.hGetAll(`dao:proposal:${proposalId}`);
    const quorum = parseInt(proposalData.quorum) || 100;
    const threshold = parseFloat(proposalData.threshold) || 0.6;

    // Determine final status
    let finalStatus = 'failed';
    if (totalVotes >= quorum) {
      const supportRate = parseInt(yesVotes) / totalVotes;
      finalStatus = supportRate >= threshold ? 'passed' : 'failed';
    }

    // Update proposal status
    await redis.hSet(`dao:proposal:${proposalId}`, {
      status: finalStatus,
      closedAt: new Date().toISOString(),
      closedBy: 'admin',
      closeReason: reason || 'Admin closure',
      finalVotes: JSON.stringify({ yes: parseInt(yesVotes), no: parseInt(noVotes), total: totalVotes })
    });

    console.log(`🗳️ Proposal closed by admin: ${proposalId} - Status: ${finalStatus}`);

    return res.json({
      success: true,
      message: `Proposal ${proposalId} has been closed`,
      proposalId: proposalId,
      finalStatus: finalStatus,
      finalVotes: {
        yes: parseInt(yesVotes),
        no: parseInt(noVotes),
        total: totalVotes
      },
      reason: reason || 'Admin closure',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error closing proposal:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to close proposal"
    });
  }
});

// GET /api/dao/proposal/:id - Get specific proposal details
router.get('/proposal/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const proposalData = await redis.hGetAll(`dao:proposal:${id}`);
    
    if (!proposalData || Object.keys(proposalData).length === 0) {
      return res.status(404).json({
        success: false,
        error: "Proposal not found"
      });
    }

    // Get vote counts
    const yesVotes = await redis.get(`dao:proposal:${id}:yes`) || 0;
    const noVotes = await redis.get(`dao:proposal:${id}:no`) || 0;
    const totalVotes = parseInt(yesVotes) + parseInt(noVotes);

    const proposal = {
      id: id,
      title: proposalData.title,
      description: proposalData.description,
      proposer: proposalData.proposer,
      status: proposalData.status,
      type: proposalData.type,
      createdAt: proposalData.createdAt,
      expiresAt: proposalData.expiresAt,
      closedAt: proposalData.closedAt,
      votes: {
        yes: parseInt(yesVotes),
        no: parseInt(noVotes),
        total: totalVotes
      },
      quorum: parseInt(proposalData.quorum) || 100,
      quorumMet: totalVotes >= (parseInt(proposalData.quorum) || 100),
      passingThreshold: parseFloat(proposalData.threshold) || 0.6,
      currentSupport: totalVotes > 0 ? (parseInt(yesVotes) / totalVotes) : 0,
      timeRemaining: proposalData.expiresAt ? 
        Math.max(0, new Date(proposalData.expiresAt) - new Date()) : 0
    };

    console.log(`🗳️ Proposal details requested: ${id}`);

    return res.json({
      success: true,
      proposal: proposal,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting proposal details:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get proposal details"
    });
  }
});

// POST /api/dao/vote - Vote on a DAO proposal
router.post('/vote', async (req, res) => {
  try {
    const { wallet, proposalId, vote } = req.body; // vote: true (yes) or false (no)

    if (!wallet || !proposalId || typeof vote !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, proposalId, vote (boolean)"
      });
    }

    // Get proposal
    const proposalData = await redis.hGetAll(`dao:proposal:${proposalId}`);

    if (!proposalData || Object.keys(proposalData).length === 0) {
      return res.status(404).json({
        success: false,
        error: "Proposal not found"
      });
    }

    if (proposalData.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: "Proposal is not accepting votes"
      });
    }

    // Check if proposal has expired
    const expiresAt = new Date(proposalData.expiresAt);
    if (new Date() > expiresAt) {
      return res.status(400).json({
        success: false,
        error: "Proposal voting period has expired"
      });
    }

    // Check if user already voted
    const voteKey = `dao:vote:${proposalId}:${wallet}`;
    const existingVote = await redis.get(voteKey);

    if (existingVote) {
      return res.status(400).json({
        success: false,
        error: "You have already voted on this proposal"
      });
    }

    // Get user's WALDO balance (simplified - in production would check actual balance)
    const userData = await redis.hGetAll(`user:${wallet}`);
    const waldoBalance = parseInt(userData.waldoBalance) || 0;

    if (waldoBalance < 100) {
      return res.status(400).json({
        success: false,
        error: "Minimum 100 WALDO required to vote"
      });
    }

    // Record vote
    await redis.set(voteKey, JSON.stringify({
      wallet,
      proposalId,
      vote,
      votingPower: waldoBalance,
      votedAt: new Date().toISOString()
    }), { EX: 30 * 24 * 60 * 60 }); // 30 day expiry

    // Update proposal vote counts
    const voteField = vote ? 'yesVotes' : 'noVotes';
    const powerField = vote ? 'yesVotingPower' : 'noVotingPower';

    await redis.hIncrBy(`dao:proposal:${proposalId}`, voteField, 1);
    await redis.hIncrBy(`dao:proposal:${proposalId}`, powerField, waldoBalance);
    await redis.hIncrBy(`dao:proposal:${proposalId}`, 'totalVotes', 1);
    await redis.hIncrBy(`dao:proposal:${proposalId}`, 'totalVotingPower', waldoBalance);

    // Update user stats
    await redis.hIncrBy(`user:${wallet}`, 'daoVotes', 1);
    await redis.hIncrBy(`user:${wallet}`, 'daoVotingPower', waldoBalance);

    console.log(`🗳️ DAO vote recorded: ${wallet} voted ${vote ? 'YES' : 'NO'} on ${proposalId} with ${waldoBalance} voting power`);

    return res.json({
      success: true,
      message: `Vote recorded: ${vote ? 'YES' : 'NO'}`,
      vote,
      votingPower: waldoBalance
    });

  } catch (error) {
    console.error('❌ DAO vote error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to record vote"
    });
  }
});

export default router;
