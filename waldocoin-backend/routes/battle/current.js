// routes/battle/current.js
import express from "express";
import { redis } from "../../redisClient.js";
import { getTweetDataForBattle } from "../../utils/tweetValidator.js";
import { BATTLE_KEYS, getBattle } from "../../utils/battleStorage.js";

const router = express.Router();

// How long battles run (seconds)
const BATTLE_DURATION = 60 * 60 * 24; // 24 hours; adjust if needed

router.get("/", async (req, res) => {
  try {
    const battleId = await redis.get(BATTLE_KEYS.current());
    if (!battleId) {
      return res.json({ success: false, error: "No current battle" });
    }

    const data = await getBattle(battleId);
    if (!data || !data.status) {
      return res.json({ success: false, error: "Battle not ready" });
    }

    // Only expose battles that are pending/open/accepted
    if (!["pending", "open", "accepted"].includes(data.status)) {
      return res.json({ success: false, error: "No current battle" });
    }

    // Get proper meme data for display
    let meme1 = null;
    let meme2 = null;

    if (data.challengerTweetId) {
      meme1 = await getTweetDataForBattle(data.challengerTweetId);
    }

    if (data.acceptorTweetId) {
      meme2 = await getTweetDataForBattle(data.acceptorTweetId);
    }

    const acceptedAt = data.acceptedAt ? Number(data.acceptedAt) : null; // Unix ms

    // Timer logic – only for accepted battles
    let timerSeconds = null;
    if (acceptedAt && data.status === "accepted") {
      const now = Date.now();
      const end = acceptedAt + BATTLE_DURATION * 1000;
      timerSeconds = Math.max(0, Math.floor((end - now) / 1000));
    }

    const isTargeted = !!data.acceptor;

    return res.json({
      success: true,
      battle: {
        id: battleId,
        meme1,
        meme2,
        // Frontend expects "pending" for both targeted and open pre-accept battles
        status: data.status === "open" ? "pending" : data.status,
        timerSeconds,
        acceptedAt,
        challenger: data.challenger,
        challengerHandle: data.challengerHandle,
        challenged: isTargeted ? data.acceptor : null,
        challengedHandle: isTargeted ? data.acceptorHandle : null,
        isTargeted
      }
    });
  } catch (err) {
    console.error("❌ Error loading current battle:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;


