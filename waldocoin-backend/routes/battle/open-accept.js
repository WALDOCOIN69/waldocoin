import express from "express";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import dayjs from "dayjs";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battles/open-accept.js");

router.post("/", async (req, res) => {
  const { wallet, tweetId } = req.body;

  if (!wallet || !tweetId) {
    return res.status(400).json({ success: false, error: "Missing wallet or tweetId" });
  }

  try {
    // Find the first open battle
    const keys = await redis.keys("battle:*");
    let battle = null;

    for (const key of keys) {
      const raw = await redis.get(key);
      const b = JSON.parse(raw);
      if (b.openInvite && !b.acceptedAt && !b.challenged) {
        battle = b;
        break;
      }
    }

    if (!battle) {
      return res.status(404).json({ success: false, error: "No open battle found" });
    }

    const feeWaldo = 50;
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
      if (event.data.signed === false) throw new Error("User rejected accept payment");
    });

    battle.challenged = wallet;
    battle.challengedTweetId = tweetId;
    battle.status = "active";
    battle.acceptedAt = dayjs().toISOString();
    battle.openInvite = false;

    await redis.set(`battle:${battle.battleId}`, JSON.stringify(battle), { EX: 60 * 60 * 24 });

    return res.json({ success: true, uuid, next, battle });

  } catch (err) {
    console.error("❌ Open accept error:", err);
    return res.status(500).json({ success: false, error: "Open battle accept failed", detail: err.message });
  }
});

export default router;
