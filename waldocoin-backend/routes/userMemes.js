import express from "express";
import { redis } from "../redisClient.js";

const router = express.Router();

// GET /api/userMemes?wallet=...
// Returns user's memes (tweets ingested), including xp/likes/retweets and nft_minted flag
router.get("/", async (req, res) => {
  try {
    const wallet = (req.query.wallet || "").trim();
    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid or missing wallet" });
    }

    const tweetIds = await redis.sMembers(`wallet:tweets:${wallet}`);
    if (!Array.isArray(tweetIds) || tweetIds.length === 0) {
      return res.json({ success: true, memes: [] });
    }

    const memes = [];
    for (const id of tweetIds) {
      try {
        const data = await redis.hGetAll(`meme:${id}`);
        const mintedVal = await redis.get(`meme:nft_minted:${id}`);
        const meme = {
          tweet_id: id,
          likes: parseInt(data.likes) || 0,
          retweets: parseInt(data.retweets) || 0,
          xp: parseInt(data.xp) || 0,
          created_at: data.created_at || null,
          // Frontend expects nft_minted to be 'true'/true tolerant; return boolean true/false
          nft_minted: !!(mintedVal && mintedVal !== 'false')
        };
        memes.push(meme);
      } catch (e) {
        // Skip problematic id, continue
      }
    }

    // Sort by created_at desc if available
    memes.sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      return tb - ta;
    });

    return res.json({ success: true, memes });
  } catch (err) {
    console.error("❌ Error in /api/userMemes:", err);
    return res.status(500).json({ success: false, error: "Failed to load user memes" });
  }
});

export default router;

