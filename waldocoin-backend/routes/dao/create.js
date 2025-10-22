// routes/dao/create.js
import express from "express";
import { redis } from "../../redisClient.js";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { rateLimitMiddleware } from "../../utils/rateLimiter.js";
import { createErrorResponse, logError } from "../../utils/errorHandler.js";

const router = express.Router();
console.log("🧩 Loaded: routes/dao/create.js");

router.post("/", rateLimitMiddleware('ADMIN_ACTION', (req) => req.ip), async (req, res) => {
  const { title, description, duration } = req.body;

  if (!title || !description || !duration) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  try {
    const proposalId = uuidv4();
    const now = dayjs();
    const expiresAt = now.add(Number(duration), "hour").toISOString();

    const proposal = {
      id: proposalId,
      title,
      description,
      status: "active",
      yesVotes: 0,
      noVotes: 0,
      createdAt: now.toISOString(),
      expiresAt,
    };

    await redis.set(`dao:proposal:${proposalId}`, JSON.stringify(proposal));
    await redis.lpush("dao:activeProposals", proposalId);

    return res.json({ success: true, proposalId });
  } catch (err) {
    console.error("❌ DAO Proposal Create Error:", err);
    return res.status(500).json({ success: false, error: "Create failed", detail: err.message });
  }
});

export default router;
