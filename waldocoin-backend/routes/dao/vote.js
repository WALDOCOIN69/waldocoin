// 📁 routes/vote.js

import express from "express";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import path from "path";
import { redis } from "../../redisClient.js";
import { addXP } from "../../utils/xpManager.js";
import { rateLimitMiddleware } from "../../utils/rateLimiter.js";
import { createErrorResponse, logError } from "../../utils/errorHandler.js";
import { getNFTVotingPower } from "../../utils/nftUtilities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 🗳 Vote submission route
router.post("/", rateLimitMiddleware('API_GENERAL', (req) => req.body.wallet), async (req, res) => {
  const { proposalId, choice, wallet } = req.body;

  if (!proposalId || !choice || !wallet) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  try {
    // ✅ Fetch WALDO balance from XRPL
    const response = await fetch("https://s1.ripple.com:51234", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "account_lines",
        params: [{ account: wallet }]
      })
    });

    const data = await response.json();
    const lines = data?.result?.lines || [];

    const WALDO_ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const WALDO_CURRENCY = "WLO";
    // Load DAO requirement from config (WLO)
    const { getDaoConfig } = await import("../../utils/config.js");
    const daoCfg = await getDaoConfig();
    const requiredWaldo = daoCfg.votingRequirementWLO;

    const waldoLine = lines.find(
      l => l.currency === WALDO_CURRENCY && l.account === WALDO_ISSUER
    );

    const waldoBalance = parseFloat(waldoLine?.balance || "0");

    if (waldoBalance < requiredWaldo) {
      return res.status(403).json({
        success: false,
        error: `You need at least ${requiredWaldo.toLocaleString()} WALDO to vote (1 vote per 50k WALDO)`
      });
    }

    // Calculate BASE voting power: 1 vote per 50k WALDO
    const baseVotingPower = Math.floor(waldoBalance / requiredWaldo);

    // 🖼️ NFT HOLDER VOTING BOOST: Get multiplier based on NFT tier
    // Silver (1-2 NFTs): 1.1x | Gold (3-9): 1.25x | Platinum (10+): 1.5x | King: 3.0x
    const nftMultiplier = await getNFTVotingPower(wallet);
    const votingPower = Math.floor(baseVotingPower * nftMultiplier);

    console.log(`🗳️ DAO Vote: ${wallet} - Base: ${baseVotingPower}, NFT Multiplier: ${nftMultiplier}x, Final: ${votingPower}`);

    // ⛔ Prevent duplicate voting
    const existing = await redis.hGet(`proposalVotes:${proposalId}`, wallet);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "You already voted on this proposal."
      });
    }

    // Award XP based on voting power (1 XP per vote)
    await addXP(wallet, votingPower);

    // ✅ Save vote to Redis with voting power
    const voteData = {
      choice,
      votingPower,
      baseVotingPower,
      nftMultiplier,
      waldoBalance,
      timestamp: new Date().toISOString()
    };
    await redis.hSet(`proposalVotes:${proposalId}`, wallet, JSON.stringify(voteData));

    return res.json({
      success: true,
      votingPower,
      baseVotingPower,
      nftMultiplier: `${nftMultiplier}x`,
      waldoBalance,
      message: nftMultiplier > 1
        ? `Vote recorded with ${votingPower} voting power (${baseVotingPower} base × ${nftMultiplier}x NFT bonus)`
        : `Vote recorded with ${votingPower} voting power (${waldoBalance.toLocaleString()} WALDO)`
    });
  } catch (err) {
    console.error("❌ Voting error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;


