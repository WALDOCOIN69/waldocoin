// routes/battle/current.js
import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/current", async (req, res) => {
  try {
    const battleId = await redis.get("battle:current");

    if (!battleId) {
      return res.json({ success: false, error: "No current battle" });
    }

    const data = await redis.hgetall(`battle:${battleId}:data`);

    if (!data || data.status !== "accepted") {
      return res.json({ success: false, error: "Battle not ready" });
    }

    return res.json({ success: true, battle: data });
  } catch (err) {
    console.error("❌ Error loading current battle:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
