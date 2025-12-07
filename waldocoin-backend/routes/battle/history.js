import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

// GET /api/battle/history - Lightweight history for WordPress battle arena
router.get("/", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const keys = await redis.keys("battle:*:data");
    const completed = [];

    for (const key of keys) {
      const data = await redis.hGetAll(key);
      if (!data || !["paid", "ended", "refunded", "expired"].includes(data.status)) continue;

      const battleId = key.split(":")[1];

      const votesA = parseInt((await redis.get(`battle:${battleId}:count:A`)) || "0");
      const votesB = parseInt((await redis.get(`battle:${battleId}:count:B`)) || "0");

      const totalVotes = votesA + votesB;
      let winnerSide = "tie";
      if (votesA > votesB) winnerSide = "A";
      else if (votesB > votesA) winnerSide = "B";

      const prizePool = parseInt(data.prizePool) || 0;

      completed.push({
        id: battleId,
        winner: winnerSide,
        votes: totalVotes,
        prize: prizePool,
        endTime: data.payoutAt || data.endedAt || data.expiredAt || data.createdAt
      });
    }

    // Sort by most recent completion/expiration
    completed.sort((a, b) => new Date(b.endTime) - new Date(a.endTime));

    return res.json({
      success: true,
      battles: completed.slice(0, limit)
    });
  } catch (err) {
    console.error("❌ Error fetching battle history:", err);
    return res.status(500).json({ success: false, error: "Failed to load battle history" });
  }
});

export default router;

