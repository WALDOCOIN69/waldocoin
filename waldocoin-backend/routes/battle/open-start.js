import express from "express";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battles/open-start.js");

router.post("/", async (req, res) => {
  const { wallet, tweetId } = req.body;

  if (!wallet || !tweetId) {
    return res.status(400).json({ success: false, error: "Missing wallet or tweetId" });
  }

  try {
    const battleId = uuidv4();
    const now = dayjs();
    const feeWaldo = 100;

    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(feeWaldo * 1_000_000),
        DestinationTag: 777
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("User rejected payment");
    });

    const battleData = {
      battleId,
      challenger: wallet,
      challengerTweetId: tweetId,
      challengerHandle: null,
      challenged: null,
      challengedTweetId: null,
      challengedHandle: null,
      status: "open",
      createdAt: now.toISOString(),
      acceptedAt: null,
      expiresAt: now.add(24, "hour").toISOString(),
      votes: 0,
      openInvite: true
    };

    await redis.set(`battle:${battleId}`, JSON.stringify(battleData), { EX: 60 * 60 * 24 });

    return res.json({ success: true, battleId, uuid, next });

  } catch (err) {
    console.error("❌ Open start error:", err);
    return res.status(500).json({ success: false, error: "Open battle creation failed", detail: err.message });
  }
});

export default router;
