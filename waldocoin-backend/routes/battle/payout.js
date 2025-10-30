// routes/battle/payout.js
import express from "express";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import { calculateXpReward, addXP } from "../../utils/xpManager.js";

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
    const losingVoters = await redis.sMembers(`battle:${battleId}:voters:${winner === "A" ? "B" : "A"}`);
    const totalVoters = winningVoters.length + losingVoters.length;

    // Handle no-votes scenario - no fees charged if no one voted
    if (totalVoters === 0) {
      console.log(`⚔️ Battle ${battleId} had no votes - no fees charged, no payouts`);

      // Mark battle as completed with no payouts
      await redis.hset(battleKey, {
        status: "completed_no_votes",
        winner: "none",
        payoutAt: now,
        voterCount: 0,
        totalPot: 0,
        message: "Battle ended with no votes - no fees charged"
      });

      return res.json({
        success: true,
        result: "completed_no_votes",
        message: "Battle ended with no votes. No fees charged, no payouts made.",
        totalPot: 0,
        voterCount: 0
      });
    }

    // Handle one-sided voting - cancel battle and refund everyone
    if (losingVoters.length === 0) {
      console.log(`⚔️ Battle ${battleId} was one-sided - canceling and refunding all participants`);

      // Import refund utilities
      const { refundFullBattle } = await import("../../utils/battleRefunds.js");

      // Refund all participants (challenger + acceptor + all voters)
      await refundFullBattle(battleId, "One-sided voting - battle canceled");

      // Mark battle as canceled
      await redis.hset(battleKey, {
        status: "canceled_one_sided",
        winner: "none",
        payoutAt: now,
        voterCount: totalVoters,
        totalPot: 0,
        message: "Battle canceled due to one-sided voting - all participants refunded"
      });

      return res.json({
        success: true,
        result: "canceled_one_sided",
        message: `Battle canceled due to one-sided voting. All participants (challenger, acceptor, ${totalVoters} voters) have been refunded.`,
        totalPot: 0,
        voterCount: totalVoters,
        refundedVoters: totalVoters
      });
    }

    // WALDO Distribution - Two-sided battle with losing side redistribution
    const memeCreatorFees = 150000 + 75000; // challenger + acceptor fees (no house fees)
    const winningVoteFees = winningVoters.length * 30000;
    const losingVoteFees = losingVoters.length * 30000;
    const totalVotingPool = winningVoteFees + losingVoteFees;

    // House fees only apply to betting pool, not meme creator fees
    const burnAmount = Math.floor(totalVotingPool * 0.0025); // 0.25% of betting pool
    const treasuryAmount = Math.floor(totalVotingPool * 0.0175); // 1.75% of betting pool
    const availableVotingPool = totalVotingPool - burnAmount - treasuryAmount;

    const totalPot = memeCreatorFees + totalVotingPool;
    const prizePool = memeCreatorFees + availableVotingPool; // Meme fees + net betting pool

    // Prize distribution: 55% to winner, 45% + losing side bets to winning voters
    const posterAmount = Math.floor(prizePool * 0.55); // 55% to winner
    const baseVoterAmount = Math.floor(prizePool * 0.45); // 45% base voter share
    const totalVoterAmount = baseVoterAmount + losingVoteFees; // Add losing side bets
    const voterSplit = winningVoters.length ? Math.floor(totalVoterAmount / winningVoters.length) : 0;

    console.log(`💰 Battle payout: Winner gets ${posterAmount} WLO, ${winningVoters.length} winning voters share ${totalVoterAmount} WLO (${voterSplit} each)`);
    console.log(`📊 Meme creator fees: ${memeCreatorFees} WLO (no house fees), Betting pool: ${totalVotingPool} WLO`);
    console.log(`🏦 Voter house fees (2% total): Burn ${burnAmount} WLO (0.25%), Treasury ${treasuryAmount} WLO (1.75%)`);
    console.log(`📊 Losing side contributed ${losingVoteFees} WLO (${losingVoters.length} voters) to winning voters`);

    // Import treasury wallet functionality
    const { xrpSendWaldo } = await import("../../utils/sendWaldo.js");

    // Payout to winner from treasury wallet
    if (posterAmount > 0) {
      await xrpSendWaldo(winnerWallet, posterAmount);
      console.log(`💰 Paid ${posterAmount} WLO to winner: ${winnerWallet}`);
    }

    // Payout to winning voters from treasury wallet
    for (const voter of winningVoters) {
      if (voterSplit > 0) {
        await xrpSendWaldo(voter, voterSplit);
        console.log(`🗳️ Paid ${voterSplit} WLO to voter: ${voter}`);
      }

      // Award XP to each winning voter
      await addXP(voter, 10); // Increased XP for winning voters
    }

    // Burn 0.5% to dead address (black hole)
    if (burnAmount > 0) {
      const BURN_ADDRESS = "rrrrrrrrrrrrrrrrrrrrrhoLvTp"; // XRPL black hole address
      await xrpSendWaldo(BURN_ADDRESS, burnAmount);
      console.log(`🔥 Burned ${burnAmount} WLO to black hole address`);
    }

    // Send 2.5% to treasury wallet (r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K)
    if (treasuryAmount > 0) {
      const TREASURY_WALLET = "r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K";
      await xrpSendWaldo(TREASURY_WALLET, treasuryAmount);
      console.log(`🏦 Sent ${treasuryAmount} WLO to treasury: ${TREASURY_WALLET}`);
    }

    // XP rewards
    await addXP(winnerWallet, 100); // Winner gets 100 XP
    await addXP(loserWallet, 25);   // Loser gets 25 XP (consolation)

    // Mark battle as paid/ended and store results
    await redis.hset(battleKey, {
      status: "paid",
      winner,
      payoutAt: now,
      voterCount: winningVoters.length,
      losingVoterCount: losingVoters.length,
      totalPot,
      memeCreatorFees,
      totalVotingPool,
      prizePool,
      burnAmount,
      treasuryAmount,
      voterSplit,
      losingVoteFees
    });

    console.log(`⚔️ Battle ${battleId} completed - Winner: ${winner}, Total Pot: ${totalPot} WLO, Losing side: ${losingVoteFees} WLO redistributed`);

    return res.json({
      success: true,
      result: "paid",
      winner,
      winnerWallet,
      totalPot,
      memeCreatorFees,
      totalVotingPool,
      prizePool,
      burnAmount,
      treasuryAmount,
      posterAmount,
      totalVoterAmount,
      voterSplit,
      votersPaid: winningVoters.length,
      losingVoterCount: losingVoters.length,
      losingVoteFees,
      message: `Battle completed! Winner gets ${posterAmount} WLO, ${winningVoters.length} winning voters get ${voterSplit} WLO each. Voter house fees: ${burnAmount + treasuryAmount} WLO (2% total: 1.75% treasury, 0.25% burn).`
    });

  } catch (err) {
    console.error("❌ Payout error:", err);
    return res.status(500).json({ success: false, error: "Payout failed", detail: err.message });
  }
});

export default router;
