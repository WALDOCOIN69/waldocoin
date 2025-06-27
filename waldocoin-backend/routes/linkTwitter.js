import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js";
import { scan_user } from "../utils/scan_user.js"; // adjust path if needed

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

console.log("🔗 Loaded: routes/linkTwitter.js");

// 🔗 Link Twitter Handle to Wallet
router.post("/", async (req, res) => {
  const { wallet, handle } = req.body;

  if (!wallet || !handle) {
    return res.status(400).json({ success: false, error: "Missing wallet or handle" });
  }

  const key = `user:${wallet}`;

  try {
    const existing = await redis.hGet(key, "twitterHandle");
    if (existing) {
      return res.status(400).json({ success: false, error: "Twitter already linked and locked." });
    }

    await redis.hSet(key, "twitterHandle", handle);
    await redis.set(`twitter:${handle.toLowerCase()}`, wallet);
    await redis.set(`wallet:handle:${wallet}`, handle.toLowerCase());

    // 🔍 Scan for #WaldoMeme tweets right after linking
    const memesFound = await scan_user(handle.toLowerCase());

    return res.json({
      success: true,
      message: `Twitter handle linked successfully and scanned.`,
      memesStored: memesFound
    });

  } catch (err) {
    console.error("❌ Redis error in linkTwitter:", err);
    return res.status(500).json({ success: false, error: "Redis error", detail: err.message });
  }
});

export default router;
