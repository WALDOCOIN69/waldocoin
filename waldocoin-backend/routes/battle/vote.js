// routes/battle/vote.js
import express from "express";
import xummClient from "../../utils/xummClient.js"; // ✅ default import (correct)

import { redis } from "../../redisClient.js";
import { addXP } from "../../utils/xpManager.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battle/vote.js");

router.post("/", async (req, res) => {
  const { wallet, battleId, vote } = req.body;

  if (!wallet || !battleId || !vote || !["A", "B"].includes(vote)) {
    return res.status(400).json({ success: false, error: "Invalid vote payload" });
  }

  try {
    const battleKey = `battle:${battleId}`;
    const battleDataRaw = await redis.get(battleKey);
    if (!battleDataRaw) {
      return res.status(404).json({ success: false, error: "Battle not found" });
    }

    const battleData = JSON.parse(battleDataRaw);

    if (battleData.status !== "accepted") {
      return res.status(400).json({ success: false, error: "Battle not active" });
    }

    const voteKey = `battle:${battleId}:vote:${wallet}`;
    const alreadyVoted = await redis.get(voteKey);
    if (alreadyVoted) {
      return res.status(403).json({ success: false, error: "You already voted in this battle" });
    }

    const feeWaldo = 5;

    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(feeWaldo * 1_000_000),
        DestinationTag: 779
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, event => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("❌ Vote payment rejected");
    });

    // ⏱️ Save vote with timestamp
    await redis.set(voteKey, JSON.stringify({ vote, timestamp: Date.now() }), { EX: 60 * 60 * 24 * 7 });

    // 📊 Increment vote count
    const countKey = `battle:${battleId}:count:${vote}`;
    await redis.incr(countKey);

    // 📋 Add to set of voters by side
    await redis.sAdd(`battle:${battleId}:voters:${vote}`, wallet);

    // ⭐ XP bonus for voter
    await addXP(wallet, 1);

    return res.json({
      success: true,
      uuid,
      next,
      vote,
      fee: feeWaldo
    });

  } catch (err) {
    console.error("❌ Vote error:", err);
    return res.status(500).json({ success: false, error: "Vote failed", detail: err.message });
  }
});

export default router;
