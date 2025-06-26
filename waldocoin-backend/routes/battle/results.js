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

    // Default reward logic
    let xpGained = 0;
    let waldoEarned = 0;
    let votersXp = 0;
    let votersWaldo = 0;

    if (winner !== "tie") {
      xpGained = 50;
      waldoEarned = 100;
      votersXp = 5;
      votersWaldo = 10;
    }

    return res.json({
      success: true,
      votesA,
      votesB,
      winner,
      xpGained,
      waldoEarned,
      votersXp,
      votersWaldo
    });
  } catch (err) {
    console.error("❌ Failed to fetch battle results:", err);
    return res.status(500).json({ success: false, error: "Error fetching results" });
  }
});

export default router;

