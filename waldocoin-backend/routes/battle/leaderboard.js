import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const keys = await redis.keys("battle:*:meta");
    const winCounts = {};

    for (const key of keys) {
      const id = key.split(":")[1];
      const raw = await redis.hgetall(key);
      const votesA = parseInt(await redis.get(`battle:${id}:count:A`) || "0");
      const votesB = parseInt(await redis.get(`battle:${id}:count:B`) || "0");

      if (!raw || raw.status !== "accepted") continue;

      if (votesA > votesB) {
        winCounts[raw.challengerTweetId] = (winCounts[raw.challengerTweetId] || 0) + 1;
      } else if (votesB > votesA) {
        winCounts[raw.opponentTweetId] = (winCounts[raw.opponentTweetId] || 0) + 1;
      }
    }

    const leaderboard = Object.entries(winCounts)
      .map(([memeId, wins]) => ({ memeId, wins }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 5); // Top 5 only

    return res.json({ success: true, leaderboard });
  } catch (err) {
    console.error("❌ Leaderboard fetch error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
