// routes/battle/payout.js
import express from "express";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import { calculateXpReward } from "../../utils/xp.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

console.log("🧩 Loaded: routes/battle/payout.js");

router.post("/", async (req, res) => {
  const { battleId } = req.body;

  if (!battleId) {
    return res.status(400).json({ success: false, error: "Missing battleId" });
  }

  try {
    const battleKey = `battle:${battleId}`;
    const battleDataRaw = await redis.get(battleKey);
    if (!battleDataRaw) {
      return res.status(404).json({ success: false, error: "Battle not found" });
    }

    const battle = JSON.parse(battleDataRaw);
    const now = Date.now();

    if (battle.status !== "accepted") {
      return res.status(400).json({ success: false, error: "Battle not active or already paid" });
    }

    const elapsed = now - battle.acceptedAt;
    const battleDuration = 24 * 60 * 60 * 1000;

    if (elapsed < battleDuration) {
      return res.status(403).json({ success: false, error: "Battle not over yet" });
    }

    const countA = parseInt(await redis.get(`battle:${battleId}:count:A`) || "0");
    const countB = parseInt(await redis.get(`battle:${battleId}:count:B`) || "0");

    const winner = countA > countB ? "A" : countB > countA ? "B" : null;
    if (!winner) {
      battle.status = "draw";
      await redis.set(battleKey, JSON.stringify(battle));
      return res.json({ success: true, result: "draw" });
    }

    const loser = winner === "A" ? "B" : "A";
    const winnerWallet = battle[winner];
    const votersKey = `battle:${battleId}:vote:*`;
    const allKeys = await redis.keys(votersKey);
    const winningVoters = [];

    for (const key of allKeys) {
      const vote = await redis.get(key);
      if (vote === winner) {
        const parts = key.split(":");
        const voterWallet = parts[3];
        winningVoters.push(voterWallet);
      }
    }

    // Calculate payout amounts
    const posterShare = 0.5;
    const voterShare = 0.45;
    const treasuryBurn = 0.05;

    const pot = 100 + 50 + (battle.votes * 5); // starter + accept + all voters
    const burnAmount = Math.floor(pot * treasuryBurn);
    const remaining = pot - burnAmount;
    const posterAmount = Math.floor(remaining * posterShare);
    const voterAmount = Math.floor(remaining * voterShare);
    const voterSplit = Math.floor(voterAmount / winningVoters.length);

    // Send payment to poster
    const posterPayload = await xummClient.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: winnerWallet,
        Amount: String(posterAmount * 1_000_000),
        DestinationTag: 881
      },
      options: { submit: true }
    });

    // Send payment to voters
    for (const voter of winningVoters) {
      await xummClient.payload.create({
        txjson: {
          TransactionType: "Payment",
          Destination: voter,
          Amount: String(voterSplit * 1_000_000),
          DestinationTag: 882
        },
        options: { submit: true }
      });
    }

    // Burn + Treasury
    await xummClient.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(burnAmount * 1_000_000),
        DestinationTag: 999
      },
      options: { submit: true }
    });

    // XP Bonus
    await calculateXpReward(winnerWallet, 30); // e.g. +30 XP

    // Finalize battle state
    battle.status = "paid";
    battle.winner = winner;
    battle.payoutAt = Date.now();
    battle.voterCount = winningVoters.length;
    await redis.set(battleKey, JSON.stringify(battle));

    return res.json({
      success: true,
      result: "paid",
      pot,
      burnAmount,
      posterAmount,
      voterAmount,
      votersPaid: winningVoters.length
    });

  } catch (err) {
    console.error("❌ Payout error:", err);
    return res.status(500).json({ success: false, error: "Payout failed", detail: err.message });
  }
});

export default router;
