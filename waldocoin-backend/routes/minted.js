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
    router[method] = function (path, ...handlers) {
      if (typeof path === "string" && /:[^\/]+:/.test(path)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path}`);
      }
      return original.call(this, path, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

// 🔍 GET /minted — Return real NFT mints from Redis
router.get("/minted", async (req, res) => {
  try {
    const keys = await redis.keys("meme:nft_minted:*");
    const minted = [];

    for (const key of keys) {
      const tweetId = key.split(":")[2];
      const txHash = await redis.get(key);
      minted.push({ tweetId, txHash });
    }

    res.json(minted);
  } catch (err) {
    console.error("❌ Failed to fetch minted memes:", err);
    res.status(500).json({ error: "Internal error fetching minted memes." });
  }
});

export default router;
