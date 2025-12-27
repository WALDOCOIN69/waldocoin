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

// 🗑️ ADMIN: Clear ALL Twitter links (nuclear option)
// DELETE /api/linkTwitter/clearAll?adminKey=XXX
router.delete("/clearAll", async (req, res) => {
  const { adminKey } = req.query;

  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const results = { twitterKeys: 0, walletHandleKeys: 0, userFields: 0 };

    // 1. Delete all twitter:* keys
    const twitterKeys = await redis.keys("twitter:*");
    for (const key of twitterKeys) {
      await redis.del(key);
      results.twitterKeys++;
    }

    // 2. Delete all wallet:handle:* keys
    const walletHandleKeys = await redis.keys("wallet:handle:*");
    for (const key of walletHandleKeys) {
      await redis.del(key);
      results.walletHandleKeys++;
    }

    // 3. Clear twitterHandle field from all user:* hashes
    const userKeys = await redis.keys("user:*");
    for (const key of userKeys) {
      if (key.split(':').length === 2) {
        try {
          const hasField = await redis.hExists(key, "twitterHandle");
          if (hasField) {
            await redis.hDel(key, "twitterHandle");
            results.userFields++;
          }
        } catch (e) { /* not a hash */ }
      }
    }

    console.log("🗑️ Admin cleared ALL Twitter data:", results);

    return res.json({
      success: true,
      message: "All Twitter data cleared!",
      ...results
    });

  } catch (err) {
    console.error("❌ Error clearing all Twitter data:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🗑️ ADMIN: Clear Twitter link for a wallet (temporary for debugging)
// DELETE /api/linkTwitter/clear?wallet=XXX&adminKey=XXX
router.delete("/clear", async (req, res) => {
  const { wallet, adminKey } = req.query;

  // Simple admin key check (should match Render env var)
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  if (!wallet) {
    return res.status(400).json({ success: false, error: "Missing wallet parameter" });
  }

  try {
    // Get current handle to delete all related keys
    const currentHandle = await redis.hGet(`user:${wallet}`, 'twitterHandle');

    const deleted = {
      twitterHandle: currentHandle || null,
      keysDeleted: []
    };

    if (currentHandle) {
      // Delete twitter:{handle} -> wallet mapping
      await redis.del(`twitter:${currentHandle}`);
      deleted.keysDeleted.push(`twitter:${currentHandle}`);

      // Delete wallet:handle:{wallet} -> handle mapping
      await redis.del(`wallet:handle:${wallet}`);
      deleted.keysDeleted.push(`wallet:handle:${wallet}`);

      // Delete twitterHandle field from user hash
      await redis.hDel(`user:${wallet}`, 'twitterHandle');
      deleted.keysDeleted.push(`user:${wallet}:twitterHandle (field)`);
    }

    console.log(`🗑️ Admin cleared Twitter data for wallet ${wallet}:`, deleted);

    return res.json({
      success: true,
      message: `Twitter data cleared for wallet ${wallet}`,
      ...deleted
    });

  } catch (err) {
    console.error("❌ Error clearing Twitter data:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🔍 ADMIN: Check Twitter link status for a wallet
// GET /api/linkTwitter/status?wallet=XXX
router.get("/status", async (req, res) => {
  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ success: false, error: "Missing wallet parameter" });
  }

  try {
    const twitterHandle = await redis.hGet(`user:${wallet}`, 'twitterHandle');
    const twitterKey = twitterHandle ? await redis.get(`twitter:${twitterHandle}`) : null;
    const walletHandleKey = await redis.get(`wallet:handle:${wallet}`);

    return res.json({
      success: true,
      wallet,
      data: {
        'user:{wallet}:twitterHandle': twitterHandle || null,
        'twitter:{handle}': twitterKey || null,
        'wallet:handle:{wallet}': walletHandleKey || null
      }
    });

  } catch (err) {
    console.error("❌ Error checking Twitter status:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
