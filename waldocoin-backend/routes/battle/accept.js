import express from "express";
import dayjs from "dayjs";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battle/accept.js");

router.post("/", async (req, res) => {
  const { wallet, tweetId, battleId } = req.body;

  if (!wallet || !tweetId || !battleId) {
    return res.status(400).json({ success: false, error: "Missing wallet, tweetId, or battleId" });
  }

  try {
    const battleKey = `battle:${battleId}:data`; // <- Consistent hash key!
    const battle = await redis.hgetall(battleKey);

    if (!battle || !battle.status) {
      return res.status(404).json({ success: false, error: "Battle not found" });
    }

    if (battle.status !== "pending") {
      return res.status(400).json({ success: false, error: "Battle is not pending" });
    }

    if (battle.acceptedAt) {
      return res.status(400).json({ success: false, error: "Battle already accepted" });
    }

    const feeWaldo = 50;
    const now = dayjs();

    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(feeWaldo * 1_000_000),
        DestinationTag: 778
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("User rejected battle accept payment");
    });

    // Update only the necessary fields (Redis hash)
    await redis.hset(battleKey, {
      acceptor: wallet,
      acceptorTweetId: tweetId,
      acceptedAt: now.valueOf(), // store as timestamp ms
      endsAt: now.add(24, "hour").valueOf(),
      status: "accepted",
      votes: 0
    });

    // Optionally set a TTL (30 hours)
    await redis.expire(battleKey, 60 * 60 * 30);

    return res.json({
      success: true,
      uuid,
      next,
      battleId,
      fee: feeWaldo
    });

  } catch (err) {
    console.error("❌ Accept battle error:", err);
    return res.status(500).json({
      success: false,
      error: "Accept battle failed",
      detail: err.message
    });
  }
});

export default router;

