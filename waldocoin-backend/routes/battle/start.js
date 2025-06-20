// routes/battle/start.js
import express from "express";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { redis } from "../../redisClient.js";
import xummClient from "../../utils/xummClient.js"; // ✅ correct
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battle/start.js");

router.post("/", async (req, res) => {
  const { wallet, tweetId } = req.body;

  if (!wallet || !tweetId) {
    return res.status(400).json({ success: false, error: "Missing wallet or tweetId" });
  }

  try {
    const battleId = uuidv4();
    const now = dayjs();
    const feeWaldo = 100;

    // 🔐 WALDO payment payload for starting a battle
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(feeWaldo * 1_000_000), // WALDO in drops
        DestinationTag: 777
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("User rejected battle start payment");
    });

    // 📦 Save battle metadata to Redis
    const battleData = {
      battleId,
      challenger: wallet,
      challengerTweetId: tweetId,
      status: "pending",
      createdAt: now.toISOString(),
      acceptedAt: null,
      expiresAt: now.add(10, "hour").toISOString(),
      votes: 0
    };

    await redis.set(`battle:${battleId}`, JSON.stringify(battleData), { EX: 60 * 60 * 12 }); // TTL: 12 hours

    return res.json({
      success: true,
      battleId,
      fee: feeWaldo,
      uuid,
      next
    });

  } catch (err) {
    console.error("❌ Battle start error:", err);
    return res.status(500).json({
      success: false,
      error: "Battle start failed",
      detail: err.message
    });
  }
});

export default router;

