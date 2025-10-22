// routes/admin/dao.js - Admin DAO Management System
import express from 'express';
import { redis } from '../../redisClient.js';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { validateAdminKey, getAdminKey } from '../../utils/adminAuth.js';
import { rateLimitMiddleware } from '../../utils/rateLimiter.js';
import { createErrorResponse, logError } from '../../utils/errorHandler.js';

const router = express.Router();

console.log("🏛️ Loaded: routes/admin/dao.js");

// Governance tiers and requirements
const GOVERNANCE_TIERS = {
  COMMUNITY: {
    name: 'Community Proposal',
    minStake: 100000,
    quorum: 1000,
    threshold: 0.60,
    votingPeriod: 7,
    executionDelay: 24
  },
  PROTOCOL: {
    name: 'Protocol Proposal',
    minStake: 500000,
    quorum: 5000,
    threshold: 0.65,
    votingPeriod: 14,
    executionDelay: 48
  },
  TREASURY: {
    name: 'Treasury Proposal',
    minStake: 1000000,
    quorum: 10000,
    threshold: 0.70,
    votingPeriod: 21,
    executionDelay: 72
  },
  EMERGENCY: {
    name: 'Emergency Proposal',
    minStake: 0,
    quorum: 2000,
    threshold: 0.55,
    votingPeriod: 3,
    executionDelay: 12
  }
};

// Proposal templates
const PROPOSAL_TEMPLATES = {
  FEE_ADJUSTMENT: {
    title: 'Adjust System Fees',
    description: 'Proposal to modify fee structure for [SYSTEM_COMPONENT]',
    category: 'FEE_ADJUSTMENT',
    tier: 'PROTOCOL'
  },
  STAKING_PARAMS: {
    title: 'Modify Staking Parameters',
    description: 'Proposal to adjust staking rewards, durations, or requirements',
    category: 'STAKING_PARAMS',
    tier: 'PROTOCOL'
  },
  TREASURY_ALLOCATION: {
    title: 'Treasury Fund Allocation',
    description: 'Proposal to allocate treasury funds for [PURPOSE]',
    category: 'TREASURY_ALLOCATION',
    tier: 'TREASURY'
  },
  FEATURE_REQUEST: {
    title: 'New Feature Implementation',
    description: 'Proposal to implement new feature: [FEATURE_NAME]',
    category: 'FEATURE_REQUEST',
    tier: 'COMMUNITY'
  },
  SECURITY_FIX: {
    title: 'Emergency Security Fix',
    description: 'Emergency proposal to address critical security issue',
    category: 'SECURITY_FIX',
    tier: 'EMERGENCY'
  }
};

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
  const adminKey = getAdminKey(req);
  const validation = validateAdminKey(adminKey);

  if (!validation.valid) {
    return res.status(403).json({ success: false, error: validation.error });
  }

  next();
};

// GET /api/admin/dao/overview - DAO management overview
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    // Get pending requests
    const pendingRequestIds = await redis.lrange('dao:pending_requests', 0, -1);
    const pendingRequests = [];

    for (const requestId of pendingRequestIds) {
      const request = await redis.hgetall(`dao:request:${requestId}`);
      if (request && Object.keys(request).length > 0) {
        pendingRequests.push({ id: requestId, ...request });
      }
    }

    // Get active proposals
    const proposalKeys = await redis.keys('dao:proposal:*');
    const activeProposals = [];

    for (const key of proposalKeys) {
      const proposal = await redis.hgetall(key);
      if (proposal && proposal.status === 'ACTIVE') {
        const proposalId = key.replace('dao:proposal:', '');
        activeProposals.push({ id: proposalId, ...proposal });
      }
    }

    // Get treasury balance
    const treasuryBalance = await redis.get('dao:treasury:balance') || '0';

    // Calculate stats
    const totalVotes = await redis.get('dao:stats:total_votes') || '0';
    const totalProposals = proposalKeys.length;

    return res.json({
      success: true,
      overview: {
        pendingRequests: pendingRequests.length,
        activeProposals: activeProposals.length,
        totalProposals,
        totalVotes: parseInt(totalVotes),
        treasuryBalance: parseFloat(treasuryBalance)
      },
      pendingRequests: pendingRequests.slice(0, 10), // Latest 10
      activeProposals: activeProposals.slice(0, 5), // Latest 5
      governanceTiers: GOVERNANCE_TIERS,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await logError('ADMIN_DAO_OVERVIEW_FAILED', error, {}, 'admin', 'GET /api/admin/dao/overview');
    return res.status(500).json({
      success: false,
      error: "Failed to load DAO overview"
    });
  }
});

// GET /api/admin/dao/requests - Get all pending proposal requests
router.get('/requests', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'PENDING_REVIEW';
    const limit = parseInt(req.query.limit) || 50;

    const requestKeys = await redis.keys('dao:request:*');
    const requests = [];

    for (const key of requestKeys) {
      const request = await redis.hgetall(key);
      if (request && (status === 'ALL' || request.status === status)) {
        const requestId = key.replace('dao:request:', '');
        requests.push({ id: requestId, ...request });
      }
    }

    // Sort by submission date (newest first)
    requests.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    return res.json({
      success: true,
      requests: requests.slice(0, limit),
      totalRequests: requests.length,
      filter: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await logError('ADMIN_DAO_REQUESTS_FAILED', error, {}, 'admin', 'GET /api/admin/dao/requests');
    return res.status(500).json({
      success: false,
      error: "Failed to load proposal requests"
    });
  }
});

// GET /api/admin/dao/templates - Get proposal templates
router.get('/templates', requireAdmin, async (req, res) => {
  try {
    return res.json({
      success: true,
      templates: PROPOSAL_TEMPLATES,
      governanceTiers: GOVERNANCE_TIERS,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to load templates"
    });
  }
});

// POST /api/admin/dao/create-proposal - Create new proposal (admin only)
router.post('/create-proposal', requireAdmin, rateLimitMiddleware('ADMIN_ACTION', () => 'admin'), async (req, res) => {
  try {
    const { title, description, tier, category, customParams } = req.body;

    if (!title || !description || !tier) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: title, description, tier"
      });
    }

    if (!GOVERNANCE_TIERS[tier]) {
      return res.status(400).json({
        success: false,
        error: "Invalid governance tier"
      });
    }

    // Generate proposal ID
    const proposalId = `prop_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const now = dayjs();
    const tierConfig = GOVERNANCE_TIERS[tier];

    // Calculate dates
    const votingStartsAt = now.add(1, 'hour'); // 1 hour review period
    const votingEndsAt = votingStartsAt.add(tierConfig.votingPeriod, 'days');
    const executionAt = votingEndsAt.add(tierConfig.executionDelay, 'hours');

    // Create proposal
    const proposalData = {
      title: title.trim(),
      description: description.trim(),
      tier,
      category: category || 'GENERAL',
      proposer: 'admin',
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      votingStartsAt: votingStartsAt.toISOString(),
      votingEndsAt: votingEndsAt.toISOString(),
      executionAt: executionAt.toISOString(),
      quorum: customParams?.quorum || tierConfig.quorum,
      threshold: customParams?.threshold || tierConfig.threshold,
      minStake: tierConfig.minStake,
      executionDelay: tierConfig.executionDelay,
      customParams: customParams ? JSON.stringify(customParams) : null
    };

    // Store proposal
    await redis.hset(`dao:proposal:${proposalId}`, proposalData);

    // Initialize vote counters
    await redis.set(`dao:proposal:${proposalId}:yes`, 0);
    await redis.set(`dao:proposal:${proposalId}:no`, 0);

    // Add to active proposals list
    await redis.lpush('dao:active_proposals', proposalId);

    console.log(`🏛️ New proposal created by admin: ${proposalId} - ${title}`);

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
    await logError('ADMIN_PROPOSAL_CREATE_FAILED', error, req.body, 'admin', 'POST /api/admin/dao/create-proposal');
    return res.status(500).json({
      success: false,
      error: "Failed to create proposal"
    });
  }
});

// POST /api/admin/dao/approve-request - Convert community request to proposal
router.post('/approve-request', requireAdmin, rateLimitMiddleware('ADMIN_ACTION', () => 'admin'), async (req, res) => {
  try {
    const { requestId, tier, adminNotes, customParams } = req.body;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: "Missing request ID"
      });
    }

    // Get the request
    const request = await redis.hgetall(`dao:request:${requestId}`);
    if (!request || Object.keys(request).length === 0) {
      return res.status(404).json({
        success: false,
        error: "Request not found"
      });
    }

    if (request.status !== 'PENDING_REVIEW') {
      return res.status(400).json({
        success: false,
        error: "Request is not pending review"
      });
    }

    // Use provided tier or default to requested tier
    const finalTier = tier || request.requestedTier || 'COMMUNITY';

    if (!GOVERNANCE_TIERS[finalTier]) {
      return res.status(400).json({
        success: false,
        error: "Invalid governance tier"
      });
    }

    // Create proposal from request
    const proposalId = `prop_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const now = dayjs();
    const tierConfig = GOVERNANCE_TIERS[finalTier];

    const votingStartsAt = now.add(1, 'hour');
    const votingEndsAt = votingStartsAt.add(tierConfig.votingPeriod, 'days');
    const executionAt = votingEndsAt.add(tierConfig.executionDelay, 'hours');

    const proposalData = {
      title: request.title,
      description: request.description,
      tier: finalTier,
      category: request.category || 'GENERAL',
      proposer: request.wallet,
      originalRequestId: requestId,
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      votingStartsAt: votingStartsAt.toISOString(),
      votingEndsAt: votingEndsAt.toISOString(),
      executionAt: executionAt.toISOString(),
      quorum: customParams?.quorum || tierConfig.quorum,
      threshold: customParams?.threshold || tierConfig.threshold,
      minStake: tierConfig.minStake,
      executionDelay: tierConfig.executionDelay,
      customParams: customParams ? JSON.stringify(customParams) : null
    };

    // Store proposal
    await redis.hset(`dao:proposal:${proposalId}`, proposalData);

    // Initialize vote counters
    await redis.set(`dao:proposal:${proposalId}:yes`, 0);
    await redis.set(`dao:proposal:${proposalId}:no`, 0);

    // Add to active proposals
    await redis.lpush('dao:active_proposals', proposalId);

    // Update request status
    await redis.hset(`dao:request:${requestId}`, {
      status: 'APPROVED',
      reviewedAt: now.toISOString(),
      reviewedBy: 'admin',
      adminNotes: adminNotes || 'Approved and converted to proposal',
      proposalId
    });

    // Refund stake to original proposer
    await redis.hdel(`dao:stakes:${request.wallet}`, requestId);

    // Remove from pending requests
    await redis.lrem('dao:pending_requests', 1, requestId);

    console.log(`✅ Request approved and converted to proposal: ${requestId} -> ${proposalId}`);

    return res.json({
      success: true,
      message: "Request approved and converted to proposal",
      proposalId,
      originalRequestId: requestId,
      proposer: request.wallet,
      stakeRefunded: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await logError('ADMIN_REQUEST_APPROVE_FAILED', error, req.body, 'admin', 'POST /api/admin/dao/approve-request');
    return res.status(500).json({
      success: false,
      error: "Failed to approve request"
    });
  }
});

// POST /api/admin/dao/reject-request - Reject community request
router.post('/reject-request', requireAdmin, rateLimitMiddleware('ADMIN_ACTION', () => 'admin'), async (req, res) => {
  try {
    const { requestId, reason } = req.body;

    if (!requestId || !reason) {
      return res.status(400).json({
        success: false,
        error: "Missing request ID or rejection reason"
      });
    }

    // Get the request
    const request = await redis.hgetall(`dao:request:${requestId}`);
    if (!request || Object.keys(request).length === 0) {
      return res.status(404).json({
        success: false,
        error: "Request not found"
      });
    }

    if (request.status !== 'PENDING_REVIEW') {
      return res.status(400).json({
        success: false,
        error: "Request is not pending review"
      });
    }

    const now = dayjs();

    // Update request status
    await redis.hset(`dao:request:${requestId}`, {
      status: 'REJECTED',
      reviewedAt: now.toISOString(),
      reviewedBy: 'admin',
      adminNotes: reason
    });

    // Keep stake (penalty for rejected proposals)
    // Remove from pending requests
    await redis.lrem('dao:pending_requests', 1, requestId);

    console.log(`❌ Request rejected: ${requestId} - ${reason}`);

    return res.json({
      success: true,
      message: "Request rejected",
      requestId,
      reason,
      stakePenalty: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await logError('ADMIN_REQUEST_REJECT_FAILED', error, req.body, 'admin', 'POST /api/admin/dao/reject-request');
    return res.status(500).json({
      success: false,
      error: "Failed to reject request"
    });
  }
});

export default router;
