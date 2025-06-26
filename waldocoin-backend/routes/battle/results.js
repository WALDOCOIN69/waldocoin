// routes/battle/results.js
import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/:battleId", async (req, res) => {
  const { battleId } = req.params;

  try {
    const [countA, countB] = await Promise.all([
      redis.get(`battle:${battleId}:count:A`),
      redis.get(`battle:${battleId}:count:B`)
    ]);

    const votesA = parseInt(countA || "0");
    const votesB = parseInt(countB || "0");

    const winner = votesA > votesB ? "A" : votesB > votesA ? "B" : "tie";

    return res.json({ success: true, votesA, votesB, winner });
  } catch (err) {
    console.error("❌ Failed to fetch battle results:", err);
    return res.status(500).json({ success: false, error: "Error fetching results" });
  }
});

export default router;
