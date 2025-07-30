// routes/battle/payout.js
import express from "express";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import { calculateXpReward } from "../../utils/xp.js";
import { addXP } from "../../utils/xpManager.js";

const router = express.Router();

console.log("🧩 Loaded: routes/battle/payout.js");

const BATTLE_DURATION = 60 * 60 * 24; // 24 hours (in seconds)

router.post("/", async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ success: false, error: "Missing battleId" });

  try {
    // ALWAYS use a hash for battle data
    const battleKey = `battle:${battleId}:data`;
    const data = await redis.hgetall(battleKey);

    if (!data || !data.status) return res.status(404).json({ success: false, error: "Battle not found" });

    // Only allow payout for active/accepted battles not already ended or paid
    if (["paid", "ended", "draw"].includes(data.status)) {
      return res.status(400).json({ success: false, error: "Battle not active or already paid" });
    }
    if (data.status !== "accepted") {
      return res.status(400).json({ success: false, error: "Battle not accepted/active" });
    }

    // Timer logic: Only allow payout if enough time has passed
    const acceptedAt = data.acceptedAt ? Number(data.acceptedAt) : null;
    if (!acceptedAt) return res.status(400).json({ success: false, error: "Missing acceptedAt" });

    const now = Date.now();
    if (now < acceptedAt + BATTLE_DURATION * 1000) {
      return res.status(403).json({ success: false, error: "Battle not over yet" });
    }

    // Parse all needed data
    const challenger = data.challenger;
    const acceptor = data.acceptor;
    const meme1 = data.meme1 ? JSON.parse(data.meme1) : {};
    const meme2 = data.meme2 ? JSON.parse(data.meme2) : {};

    // Tally votes (assume "A" is challenger, "B" is acceptor)
    const countA = parseInt(await redis.get(`battle:${battleId}:count:A`) || "0", 10);
    const countB = parseInt(await redis.get(`battle:${battleId}:count:B`) || "0", 10);

    let winner = null;
    if (countA > countB) winner = "A";
    if (countB > countA) winner = "B";

    // Draw
    if (!winner) {
      await redis.hset(battleKey, { status: "draw" });
      return res.json({ success: true, result: "draw" });
    }

    const winnerWallet = winner === "A" ? challenger : acceptor;
    const loserWallet = winner === "A" ? acceptor : challenger;

    // Voters
    const winningVoters = await redis.sMembers(`battle:${battleId}:voters:${winner}`);
    const totalVoters =
      (await redis.sCard(`battle:${battleId}:voters:A`)) +
      (await redis.sCard(`battle:${battleId}:voters:B`));

    // WALDO Distribution (Whitepaper compliant: 95% distributed, 5% fees)
    const pot = 100 + 50 + (totalVoters * 5); // challenger + acceptor + voters
    const distributedAmount = Math.floor(pot * 0.95); // 95% distributed
    const burnAmount = Math.floor(pot * 0.02); // 2% burned
    const treasuryAmount = Math.floor(pot * 0.03); // 3% treasury

    // Prize distribution: 65% to winner, 30% to winning voters
    const posterAmount = Math.floor(distributedAmount * 0.65); // 65% to winner
    const voterAmount = Math.floor(distributedAmount * 0.30); // 30% to voters
    const voterSplit = winningVoters.length ? Math.floor(voterAmount / winningVoters.length) : 0;

    // Payout to meme poster
    await xummClient.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: winnerWallet,
        Amount: String(posterAmount * 1_000_000),
        DestinationTag: 881
      },
      options: { submit: true }
    });

    // Payout to voters
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

      // Award 2 XP to each voter (whitepaper compliant)
      await addXP(voter, 2);
    }

    // Burn fee to issuer
    await xummClient.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(burnAmount * 1_000_000),
        DestinationTag: 999
      },
      options: { submit: true }
    });

    // Treasury fee to treasury wallet
    await xummClient.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.TREASURY_WALLET,
        Amount: String(treasuryAmount * 1_000_000),
        DestinationTag: 888
      },
      options: { submit: true }
    });

    // XP rewards (whitepaper compliant)
    await addXP(winnerWallet, 100); // Winner gets 100 XP
    await addXP(loserWallet, 25);   // Loser gets 25 XP

    // Mark battle as paid/ended and store results
    await redis.hset(battleKey, {
      status: "paid",
      winner,
      payoutAt: now,
      voterCount: winningVoters.length,
      totalPot: pot
    });

    return res.json({
      success: true,
      result: "paid",
      winner,
      pot,
      burnAmount,
      posterAmount,
      voterAmount,
      voterSplit,
      votersPaid: winningVoters.length
    });

  } catch (err) {
    console.error("❌ Payout error:", err);
    return res.status(500).json({ success: false, error: "Payout failed", detail: err.message });
  }
});

export default router;
