// 📁 routes/minted.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router to catch malformed routes
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (routePath, ...handlers) {
      if (typeof routePath === "string" && /:[^\/]+:/.test(routePath)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${routePath}`);
        throw new Error(`❌ Invalid route pattern in ${file}: ${routePath}`);
      }
      return original.call(this, routePath, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

// 🔍 GET /minted — Return all minted memes from Redis
router.get("/minted", async (req, res) => {
  try {
    const keys = await redis.keys("meme:nft_minted:*");

    if (!keys || keys.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const minted = [];

    for (const key of keys) {
      const tweetId = key.split(":")[2];
      const txHash = await redis.get(key);
      if (txHash) minted.push({ tweetId, txHash });
    }

    return res.json({ success: true, data: minted });
  } catch (err) {
    console.error("❌ Error fetching minted NFTs:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch minted NFTs." });
  }
});

export default router;
