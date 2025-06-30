import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const keys = await redis.keys("battle:*:data");
    const winCounts = {};

    for (const key of keys) {
      const id = key.split(":")[1];
      const data = await redis.hgetall(key);
      const votesA = parseInt(await redis.get(`battle:${id}:count:A`) || "0");
      const votesB = parseInt(await redis.get(`battle:${id}:count:B`) || "0");

      // Only count finished battles
      if (!data || !["paid", "ended"].includes(data.status)) continue;
      if (votesA === votesB) continue; // Skip draws

      // Winner is challenger or acceptor (by wallet)
      if (votesA > votesB && data.challenger) {
        winCounts[data.challenger] = (winCounts[data.challenger] || 0) + 1;
      } else if (votesB > votesA && data.acceptor) {
        winCounts[data.acceptor] = (winCounts[data.acceptor] || 0) + 1;
      }
    }

    // Build enriched leaderboard (top 5)
    let leaderboard = Object.entries(winCounts)
      .map(([wallet, wins]) => ({ wallet, wins }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 5);

    // Enrich with Twitter data
    leaderboard = await Promise.all(
      leaderboard.map(async (entry) => {
        // Try to get user profile from Redis
        const user = await redis.hgetall(`user:${entry.wallet}`);
        return {
          wallet: entry.wallet,
          wins: entry.wins,
          twitter: user.twitter || null,
          twitterPic: user.twitterPic || null
        };
      })
    );

    return res.json({ success: true, leaderboard });
  } catch (err) {
    console.error("❌ Leaderboard fetch error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
