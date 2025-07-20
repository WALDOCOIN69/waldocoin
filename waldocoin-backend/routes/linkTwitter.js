import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js";
import { scan_user } from "../utils/scan_user.js"; // adjust path if needed

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

console.log("🔗 Loaded: routes/linkTwitter.js");

// 🔗 Link Twitter Handle to Wallet (Updated for stats dashboard compatibility)
router.post("/", async (req, res) => {
  const { wallet, twitterHandle } = req.body; // Updated to match stats dashboard

  if (!wallet || !twitterHandle) {
    return res.status(400).json({ success: false, error: "Missing wallet or twitterHandle" });
  }

  // Clean handle (remove @ if present)
  const cleanHandle = twitterHandle.replace(/^@/, '').toLowerCase();

  const key = `user:${wallet}`;

  try {
    const existing = await redis.hGet(key, "twitterHandle");
    if (existing) {
      return res.status(400).json({ success: false, error: "Twitter already linked and locked." });
    }

    await redis.hSet(key, "twitterHandle", cleanHandle);
    await redis.set(`twitter:${cleanHandle}`, wallet);
    await redis.set(`wallet:handle:${wallet}`, cleanHandle);

    // Award XP bonus for linking
    await redis.hIncrBy(key, 'xp', 100);

    // 🔍 Scan for #WaldoMeme tweets right after linking
    let memesFound = 0;
    try {
      memesFound = await scan_user(cleanHandle);
    } catch (scanError) {
      console.log('⚠️ Scan failed but linking succeeded:', scanError.message);
    }

    console.log(`🐦 Twitter linked: ${wallet} -> @${cleanHandle}`);

    return res.json({
      success: true,
      message: `Twitter handle @${cleanHandle} linked successfully!`,
      twitterHandle: cleanHandle,
      memesStored: memesFound,
      xpBonus: 100
    });

  } catch (err) {
    console.error("❌ Redis error in linkTwitter:", err);
    return res.status(500).json({ success: false, error: "Redis error", detail: err.message });
  }
});

export default router;
