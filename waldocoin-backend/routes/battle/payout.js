// routes/battle/payout.js
import express from "express";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import { calculateXpReward } from "../../utils/xp.js";
import { addXP } from "../../utils/xpManager.js";
import dayjs from "dayjs";

const router = express.Router();

console.log("🧩 Loaded: routes/battle/payout.js");

router.post("/", async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ success: false, error: "Missing battleId" });

  try {
    const battleKey = `battle:${battleId}`;
    const battleData = await redis.get(battleKey);
    if (!battleData) return res.status(404).json({ success: false, error: "Battle not found" });

    const battle = JSON.parse(battleData);

    if (battle.status !== "accepted") {
      return res.status(400).json({ success: false, error: "Battle not active or already paid" });
    }

    const now = dayjs();
    const acceptedAt = dayjs(battle.acceptedAt);
    if (now.diff(acceptedAt, "hour") < 24) {
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
    const winnerWallet = winner === "A" ? battle.challenger : battle.acceptor;

    const winningVoters = await redis.sMembers(`battle:${battleId}:voters:${winner}`);
    const totalVoters =
      (await redis.sCard(`battle:${battleId}:voters:A`)) +
      (await redis.sCard(`battle:${battleId}:voters:B`));

    const pot = 100 + 50 + (totalVoters * 5);
    const burnAmount = Math.floor(pot * 0.05);
    const net = pot - burnAmount;
    const posterAmount = Math.floor(net * 0.5);
    const voterAmount = Math.floor(net * 0.45);
    const voterSplit = winningVoters.length ? Math.floor(voterAmount / winningVoters.length) : 0;

    await xummClient.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: winnerWallet,
        Amount: String(posterAmount * 1_000_000),
        DestinationTag: 881
      },
      options: { submit: true }
    });

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

      await addXP(voter, 1);
    }

    await xummClient.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(burnAmount * 1_000_000),
        DestinationTag: 999
      },
      options: { submit: true }
    });

    await calculateXpReward(winnerWallet, 30);

    battle.status = "paid";
    battle.winner = winner;
    battle.payoutAt = now.toISOString();
    battle.voterCount = winningVoters.length;
    battle.totalPot = pot;

    await redis.set(battleKey, JSON.stringify(battle));

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
