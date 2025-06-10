import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router for strict route pattern detection
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string") {
        if (/:[^\/]+:/.test(path) || /:(\/|$)/.test(path)) {
          console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path}`);
          throw new Error(`❌ Invalid route pattern in ${file}: ${path}`);
        }
      }
      return original.call(this, path, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

// 📌 Wallet Analytics from Redis
router.get("/wallet/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const key = `wallet:${address}:analytics`;
    const data = await redis.hGetAll(key);
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "No analytics found for wallet." });
    }
    res.json({ address, ...data });
  } catch (err) {
    console.error("❌ Wallet analytics error:", err);
    res.status(500).json({ error: "Failed to load wallet analytics." });
  }
});

// ⚔️ Battle Stats from Redis
router.get("/battles", async (req, res) => {
  try {
    const data = await redis.hGetAll("stats:battles");
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "No battle stats found." });
    }
    res.json(data);
  } catch (err) {
    console.error("❌ Battle stats error:", err);
    res.status(500).json({ error: "Failed to load battle stats." });
  }
});

// 🎁 Airdrop Stats from Redis
router.get("/airdrops", async (req, res) => {
  try {
    const data = await redis.hGetAll("stats:airdrops");
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "No airdrop stats found." });
    }
    res.json(data);
  } catch (err) {
    console.error("❌ Airdrop stats error:", err);
    res.status(500).json({ error: "Failed to load airdrop stats." });
  }
});

export default router;

