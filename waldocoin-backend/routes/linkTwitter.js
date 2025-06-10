import express from "express";
import { redis } from "../redisClient.js";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);

// ✅ Patch router for bad route detection
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
    return res.json({ success: true, message: "Twitter handle linked successfully." });

  } catch (err) {
    console.error("❌ Redis error in linkTwitter:", err);
    return res.status(500).json({ success: false, error: "Redis error", detail: err.message });
  }
});

export default router;


