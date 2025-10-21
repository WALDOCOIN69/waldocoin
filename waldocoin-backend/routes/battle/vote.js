// routes/battle/vote.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js";
import { redis } from "../../redisClient.js";
import { addXP } from "../../utils/xpManager.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battle/vote.js");

router.post("/", async (req, res) => {
  const { wallet, battleId, vote } = req.body;

  if (!wallet || !battleId || !vote || !["A", "B"].includes(vote)) {
    return res.status(400).json({ success: false, error: "Invalid vote payload." });
  }

  try {
    const battleKey = `battle:${battleId}`;
    const battleDataRaw = await redis.get(battleKey);
    if (!battleDataRaw) {
      return res.status(404).json({ success: false, error: "Battle not found." });
    }

    const battleData = JSON.parse(battleDataRaw);

    if (battleData.status !== "accepted") {
      return res.status(400).json({ success: false, error: "No active battle to vote in." });
    }

    const voteKey = `battle:${battleId}:vote:${wallet}`;
    const alreadyVoted = await redis.get(voteKey);
    if (alreadyVoted) {
      return res.status(403).json({ success: false, error: "You have already voted." });
    }

    const { voteFeeWLO } = await (await import("../../utils/config.js")).getBattleFees();
    const feeWaldo = voteFeeWLO;

    // 🔐 WALDO payment payload - Send to dedicated Battle Escrow Wallet
    const BATTLE_ESCROW_WALLET = process.env.BATTLE_ESCROW_WALLET || "rfn7cG6qAQMuG97i9Nb5GxGdHbTjY7TzW";

    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: BATTLE_ESCROW_WALLET,
        Amount: String(feeWaldo * 1_000_000),
        DestinationTag: 779,
        Memos: [{
          Memo: {
            MemoType: Buffer.from('BATTLE_VOTE').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Battle vote fee: ${battleId} - ${vote}`).toString('hex').toUpperCase()
          }
        }]
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("User rejected voting payment");
    });

    // ⏱️ Save vote to prevent double voting (7-day expiry)
    await redis.set(voteKey, JSON.stringify({ vote, timestamp: Date.now() }), { EX: 60 * 60 * 24 * 7 });

    // 📊 Increment meme vote count
    const countKey = `battle:${battleId}:count:${vote}`;
    await redis.incr(countKey);

    // 📋 Track voter by vote choice
    await redis.sAdd(`battle:${battleId}:voters:${vote}`, wallet);

    // ⭐ Award XP for voting (whitepaper compliant: 2 XP)
    await addXP(wallet, 2);

    return res.json({
      success: true,
      uuid,
      next,
      vote,
      fee: feeWaldo
    });

  } catch (err) {
    console.error("❌ Vote error:", err);
    return res.status(500).json({ success: false, error: "Vote failed.", detail: err.message });
  }
});

export default router;

