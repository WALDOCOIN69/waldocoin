// routes/dao/create.js - Community Proposal Request System
import express from "express";
import { redis } from "../../redisClient.js";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { rateLimitMiddleware } from "../../utils/rateLimiter.js";
import { createErrorResponse, logError } from "../../utils/errorHandler.js";
import getWaldoBalance from "../../utils/getWaldoBalance.js";

const router = express.Router();
console.log("🧩 Loaded: routes/dao/create.js (Community Request System)");

// Minimum WALDO required to submit a proposal request
const MIN_WALDO_FOR_REQUEST = 100000; // 100K WALDO minimum

// POST /api/dao/create - Submit proposal request (requires WALDO stake)
router.post("/", rateLimitMiddleware('DAO_CREATE', (req) => req.body.wallet), async (req, res) => {
  try {
    const { wallet, title, description, category, requestedTier } = req.body;

    if (!wallet || !title || !description) {
      const errorResponse = await createErrorResponse(
        'MISSING_FIELDS',
        { fields: ['wallet', 'title', 'description'] },
        wallet,
        'POST /api/dao/create'
      );
      return res.status(400).json(errorResponse);
    }

    // Check WALDO balance
    const waldoBalance = await getWaldoBalance(wallet);
    if (waldoBalance < MIN_WALDO_FOR_REQUEST) {
      const errorResponse = await createErrorResponse(
        'INSUFFICIENT_WALDO',
        {
          required: MIN_WALDO_FOR_REQUEST,
          current: waldoBalance,
          action: 'submit proposal request'
        },
        wallet,
        'POST /api/dao/create'
      );
      return res.status(403).json(errorResponse);
    }

    // Create proposal request (not actual proposal)
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = dayjs();

    const proposalRequest = {
      id: requestId,
      wallet,
      title: title.trim(),
      description: description.trim(),
      category: category || 'GENERAL',
      requestedTier: requestedTier || 'COMMUNITY',
      status: 'PENDING_REVIEW',
      waldoStaked: MIN_WALDO_FOR_REQUEST,
      submittedAt: now.toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      adminNotes: null
    };

    // Store proposal request
    await redis.hset(`dao:request:${requestId}`, proposalRequest);
    await redis.lpush('dao:pending_requests', requestId);

    // Track user's staked amount (for potential refund)
    await redis.hset(`dao:stakes:${wallet}`, requestId, MIN_WALDO_FOR_REQUEST);

    console.log(`📝 New proposal request submitted: ${requestId} by ${wallet}`);

    return res.json({
      success: true,
      message: "Proposal request submitted for admin review",
      requestId,
      stakedAmount: MIN_WALDO_FOR_REQUEST,
      status: 'PENDING_REVIEW',
      note: "Your request will be reviewed by admins. If approved, it will become an official proposal and your stake will be refunded."
    });

  } catch (error) {
    await logError('DAO_REQUEST_SUBMISSION_FAILED', error, req.body, req.body?.wallet, 'POST /api/dao/create');
    return res.status(500).json({
      success: false,
      error: "Failed to submit proposal request",
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
