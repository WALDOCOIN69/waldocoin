// routes/battle/current.js
import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

// How long battles run (seconds)
const BATTLE_DURATION = 60 * 60 * 24; // 24 hours; adjust if needed

router.get("/", async (req, res) => {
  try {
    const battleId = await redis.get("battle:current");
    if (!battleId) {
      return res.json({ success: false, error: "No current battle" });
    }

    const data = await redis.hgetall(`battle:${battleId}:data`);
    if (!data || data.status !== "accepted") {
      return res.json({ success: false, error: "Battle not ready" });
    }

    // Parse necessary values
    // Required: meme1, meme2, acceptedAt (timestamp), ... etc.
    const meme1 = data.meme1 ? JSON.parse(data.meme1) : {};
    const meme2 = data.meme2 ? JSON.parse(data.meme2) : {};
    const acceptedAt = data.acceptedAt ? Number(data.acceptedAt) : null; // Unix ms

    // Timer logic
    let timerSeconds = null;
    if (acceptedAt) {
      const now = Date.now();
      const end = acceptedAt + BATTLE_DURATION * 1000;
      timerSeconds = Math.max(0, Math.floor((end - now) / 1000));
    }

    return res.json({
      success: true,
      battle: {
        id: battleId,
        meme1,
        meme2,
        status: data.status,
        timerSeconds,
        acceptedAt,
        challenger: data.challenger,
        challengerHandle: data.challengerHandle,
        challenged: data.challenged,
        challengedHandle: data.challengedHandle,
        isTargeted: data.challenged ? true : false
      }
    });
  } catch (err) {
    console.error("❌ Error loading current battle:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;


