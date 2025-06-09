// routes/linkTwitter.js
import express from "express";
import { redis } from "../redisClient.js";
import path from "path";
import { fileURLToPath } from "url";

// Patch router for route validation
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

