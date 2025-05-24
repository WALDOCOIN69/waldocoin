import express from "express";
import redis from "../redisClient.js"; // adjust path if needed
const router = express.Router();

router.get("/", async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet param" });

  try {
    const xp = parseInt(await redis.get(`user:${wallet}:xp`)) || 0;
    const likes = parseInt(await redis.get(`user:${wallet}:likes`)) || 0;
    const retweets = parseInt(await redis.get(`user:${wallet}:retweets`)) || 0;
    const memes = parseInt(await redis.get(`user:${wallet}:memes`)) || 0;
    const battles = parseInt(await redis.get(`user:${wallet}:battles`)) || 0;
    const referralsRaw = await redis.get(`user:${wallet}:referrals`);
    const referrals = referralsRaw ? JSON.parse(referralsRaw) : [];

    // XP → level conversion logic
    const level = xp >= 3000 ? 5 :
                  xp >= 1750 ? 4 :
                  xp >= 850 ? 3 :
                  xp >= 250 ? 2 : 1;

    const levelTitles = {
      1: "Fresh Poster",
      2: "Shitposter",
      3: "Meme Dealer",
      4: "OG Degen",
      5: "WALDO Master"
    };

    res.json({
      wallet,
      xp,
      level,
      title: levelTitles[level],
      likes,
      retweets,
      memes,
      battles,
      referrals
    });
  } catch (err) {
    console.error("❌ Redis fetch failed for userStats:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

