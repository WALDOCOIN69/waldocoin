import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const keys = await redis.keys("battle:*:data");

    // Track both wins and total decisive battles per wallet so we can
    // calculate an accurate win rate on the frontend.
    const stats = {}; // { [wallet]: { wins: number, totalBattles: number } }

    const ensureStats = (wallet) => {
      if (!wallet) return;
      if (!stats[wallet]) {
        stats[wallet] = { wins: 0, totalBattles: 0 };
      }
    };

    for (const key of keys) {
      const id = key.split(":")[1];
      const data = await redis.hgetall(key);
      const votesA = parseInt((await redis.get(`battle:${id}:count:A`)) || "0", 10);
      const votesB = parseInt((await redis.get(`battle:${id}:count:B`)) || "0", 10);

      // Only count finished battles
      if (!data || !["paid", "ended"].includes(data.status)) continue;

      // If it's a draw, don't count it towards wins OR totalBattles
      if (votesA === votesB) continue;

      const challenger = data.challenger;
      const acceptor = data.acceptor;

      // Count a decisive battle participation for both sides (when present)
      if (challenger) {
        ensureStats(challenger);
        stats[challenger].totalBattles += 1;
      }
      if (acceptor) {
        ensureStats(acceptor);
        stats[acceptor].totalBattles += 1;
      }

      // Increment wins for the winner
      if (votesA > votesB && challenger) {
        ensureStats(challenger);
        stats[challenger].wins += 1;
      } else if (votesB > votesA && acceptor) {
        ensureStats(acceptor);
        stats[acceptor].wins += 1;
      }
    }

    // Build enriched leaderboard (top 10 by wins, at least 1 win)
    let leaderboard = Object.entries(stats)
      .filter(([, s]) => s.wins > 0)
      .map(([wallet, s]) => ({ wallet, wins: s.wins, totalBattles: s.totalBattles }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 10);

    // Enrich with Twitter data
    leaderboard = await Promise.all(
      leaderboard.map(async (entry) => {
        // Try to get user profile from Redis
        const user = await redis.hgetall(`user:${entry.wallet}`);
        return {
          wallet: entry.wallet,
          wins: entry.wins,
          totalBattles: entry.totalBattles,
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
