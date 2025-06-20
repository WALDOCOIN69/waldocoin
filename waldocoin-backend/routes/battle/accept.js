import express from "express";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js"; // ✅ fixed to named import
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
    const battleKey = `battle:${battleId}`;
    const raw = await redis.get(battleKey);

    if (!raw) {
      return res.status(404).json({ success: false, error: "Battle not found" });
    }

    const battle = JSON.parse(raw);

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

    battle.acceptor = wallet;
    battle.acceptorTweetId = tweetId;
    battle.acceptedAt = now.toISOString();
    battle.endsAt = now.add(24, "hour").toISOString();
    battle.status = "accepted";
    battle.votes = 0;

    await redis.set(battleKey, JSON.stringify(battle), { EX: 60 * 60 * 30 }); // 30h TTL

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
