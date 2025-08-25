// 📁 routes/userStats.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js";

// Shared level thresholds and titles (must match frontend)
const LEVEL_THRESHOLDS = [0, 1000, 3000, 7000, 15000];
const LEVEL_TITLES = {
  1: "Waldo Watcher",
  2: "Waldo Scout",
  3: "Waldo Agent",
  4: "Waldo Commander",
  5: "Waldo Legend"
};

// Minimum requirements per level (to attain that level)
// For level N>1: need minted >= minted, and (battles >= battles OR referrals >= referrals)
const LEVEL_MIN_REQ = {
  1: { minted: 0, battles: 0, referrals: 0 },
  2: { minted: 1, battles: 0, referrals: 1 },
  3: { minted: 3, battles: 1, referrals: 2 },
  4: { minted: 7, battles: 3, referrals: 3 },
  5: { minted: 10, battles: 5, referrals: 5 }
};

function deriveLevelFromXP(xp) {
  const val = Number.isFinite(xp) ? xp : 0;
  if (val >= LEVEL_THRESHOLDS[4]) return 5;
  if (val >= LEVEL_THRESHOLDS[3]) return 4;
  if (val >= LEVEL_THRESHOLDS[2]) return 3;
  if (val >= LEVEL_THRESHOLDS[1]) return 2;
  return 1;
}

function enforceLevel({ xp, mintedCount, battles, referrals }) {
  // Find the highest level satisfying both XP and minimums
  const intended = deriveLevelFromXP(xp);
  for (let lvl = intended; lvl >= 1; lvl--) {
    const req = LEVEL_MIN_REQ[lvl] || { minted: 0, battles: 0, referrals: 0 };
    const hasMinted = (mintedCount || 0) >= (req.minted || 0);
    const hasEngagement = (battles || 0) >= (req.battles || 0) || (Array.isArray(referrals) ? referrals.length : (referrals || 0)) >= (req.referrals || 0);
    if (hasMinted && hasEngagement) return lvl;
  }
  return 1;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 📊 GET /user-stats?wallet=rXYZ
router.get("/", async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet param" });

  try {
    const xp = parseInt(await redis.get(`user:${wallet}:xp`)) || 0;
    const likes = parseInt(await redis.get(`user:${wallet}:likes`)) || 0;
    const retweets = parseInt(await redis.get(`user:${wallet}:retweets`)) || 0;
    const memes = parseInt(await redis.get(`user:${wallet}:memes`)) || 0;
    const battles = parseInt(await redis.get(`user:${wallet}:battles`)) || 0;
    // referrals may be stored as JSON array or numeric count; normalize to array length
    const referralsRaw = await redis.get(`user:${wallet}:referrals`);
    const referrals = (() => {
      if (!referralsRaw) return [];
      try {
        const parsed = JSON.parse(referralsRaw);
        if (Array.isArray(parsed)) return parsed;
        const n = parseInt(referralsRaw);
        return Number.isFinite(n) ? Array.from({ length: Math.max(0, n) }) : [];
      } catch {
        const n = parseInt(referralsRaw);
        return Number.isFinite(n) ? Array.from({ length: Math.max(0, n) }) : [];
      }
    })();

    // Count minted NFTs for this wallet
    let mintedCount = 0;
    try {
      const tweetIds = await redis.sMembers(`wallet:tweets:${wallet}`);
      if (Array.isArray(tweetIds) && tweetIds.length) {
        for (const id of tweetIds) {
          const minted = await redis.get(`meme:nft_minted:${id}`);
          if (minted && minted !== 'false') mintedCount++;
        }
      }
    } catch (e) {
      // non-fatal
    }

    // Enforce level with XP thresholds + minimums
    const enforcedLevel = enforceLevel({ xp, mintedCount, battles, referrals });

    res.json({
      wallet,
      xp,
      level: enforcedLevel,
      title: LEVEL_TITLES[enforcedLevel],
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

