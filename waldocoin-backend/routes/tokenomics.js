// routes/tokenomics.js - Token economics and fee tracking
import express from "express";
import { redis } from "../redisClient.js";

const router = express.Router();

console.log("🧩 Loaded: routes/tokenomics.js");

// Fee structure constants (whitepaper compliant)
const FEE_STRUCTURE = {
  battle: {
    start: 100,        // WLO (challenger fee)
    accept: 50,        // WLO (acceptor fee)
    vote: 5,           // WLO (voting fee)
    burnRate: 0.02,    // 2% burned
    treasuryRate: 0.03 // 3% to treasury
  },
  claim: {
    instantFeeRate: 0.10,  // 10%
    stakedFeeRate: 0.05,   // 5%
    burnRate: 0.02         // 2% of fee
  },
  nft: {
    mintCost: 50       // WLO
  },
  dao: {
    votingRequirement: 10000  // WLO
  }
};

// GET /api/tokenomics/fees - Get current fee structure
router.get("/fees", async (_, res) => {
  try {
    return res.json({
      success: true,
      feeStructure: FEE_STRUCTURE,
      description: {
        battle: "Battle system fees and burns",
        claim: "Meme claiming fees with staking discounts",
        nft: "NFT minting costs",
        dao: "Governance participation requirements"
      },
      burnMechanisms: [
        "5% of battle pots burned to issuer",
        "2% of claim fees burned",
        "All fees collected in WLO token"
      ]
    });
  } catch (error) {
    console.error("❌ Error getting fee structure:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get fee structure"
    });
  }
});

// GET /api/tokenomics/calculator - Calculate fees for different actions
router.get("/calculator", async (req, res) => {
  try {
    const { action, amount, staked } = req.query;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: "Missing action parameter. Use: battle-start, battle-vote, claim, nft-mint"
      });
    }

    let calculation = {};

    switch (action) {
      case "battle-start":
        calculation = {
          action: "Start Battle",
          fee: FEE_STRUCTURE.battle.start,
          currency: "WLO",
          destination: "Issuer Wallet",
          note: "Entry fee contributes to battle pot"
        };
        break;

      case "battle-vote":
        calculation = {
          action: "Vote on Battle",
          fee: FEE_STRUCTURE.battle.vote,
          currency: "WLO",
          destination: "Issuer Wallet",
          note: "Voting fee contributes to battle pot"
        };
        break;

      case "claim":
        if (!amount) {
          return res.status(400).json({
            success: false,
            error: "Amount parameter required for claim calculation"
          });
        }

        const baseAmount = parseFloat(amount);
        const isStaked = staked === "true";
        const feeRate = isStaked ? FEE_STRUCTURE.claim.stakedFeeRate : FEE_STRUCTURE.claim.instantFeeRate;
        const fee = Math.floor(baseAmount * feeRate);
        const burn = Math.floor(fee * FEE_STRUCTURE.claim.burnRate);
        const net = baseAmount - fee;

        calculation = {
          action: `${isStaked ? 'Staked' : 'Instant'} Claim`,
          baseAmount,
          feeRate: `${feeRate * 100}%`,
          fee,
          burn,
          net,
          currency: "WLO",
          note: `${burn} WLO burned, ${fee - burn} WLO to fees`
        };
        break;

      case "nft-mint":
        calculation = {
          action: "Mint NFT",
          fee: FEE_STRUCTURE.nft.mintCost,
          currency: "WLO",
          destination: "Distributor Wallet",
          requirement: "None (whitepaper compliant)",
          note: "One-time minting cost per meme - no XP requirement"
        };
        break;

      case "dao-vote":
        calculation = {
          action: "DAO Vote",
          requirement: FEE_STRUCTURE.dao.votingRequirement,
          currency: "WLO",
          note: "Minimum WLO balance required to vote",
          reward: "+1 XP for voting"
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          error: "Invalid action. Use: battle-start, battle-vote, claim, nft-mint, dao-vote"
        });
    }

    return res.json({
      success: true,
      calculation
    });

  } catch (error) {
    console.error("❌ Error calculating fees:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to calculate fees"
    });
  }
});

// GET /api/tokenomics/stats - SIMPLE VERSION (like working airdrop status)
router.get("/stats", async (_, res) => {
  try {
    // Get airdrop statistics (REAL DATA from Redis - like working airdrop status)
    const airdropClaimed = await redis.get("airdrop:count") || 0;
    const airdropRemaining = 1000 - parseInt(airdropClaimed);
    const totalDistributed = parseInt(airdropClaimed) * 50000; // 50,000 WLO per airdrop

    console.log('📊 Simple tokenomics stats (like airdrop status):', {
      airdropClaimed: parseInt(airdropClaimed),
      airdropRemaining,
      totalDistributed
    });

    // Simple stats (no XRPL queries - like working airdrop status)
    const stats = {
      totalUsers: 159, // Static from XRPL Services
      totalWloDistributed: totalDistributed, // Real calculation from airdrop data
      activeBattles: 0, // Not live yet
      totalStaked: 0, // Not live yet

      airdrop: {
        totalClaimed: parseInt(airdropClaimed),
        totalDistributed: totalDistributed,
        remaining: airdropRemaining,
        progress: ((parseInt(airdropClaimed) / 1000) * 100).toFixed(1),
        isActive: airdropRemaining > 0
      },

      battles: {
        active: 0,
        total: 0,
        averageParticipation: "0.0",
        estimatedDailyBurns: 0
      },

      staking: {
        totalStaked: 0,
        activeStakers: 0,
        averageStake: "0.00",
        stakingRate: "0.0"
      },

      burns: { battles: 0, claims: 0, total: 0 },

      trustlines: {
        total: 159,
        withBalance: 132,
        totalWloHeld: "2500000.00",
        dexOffers: 15,
        source: 'XRPL Services data'
      },

      system: {
        lastUpdated: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memoryUsage: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)
      }
    };

    return res.json({
      success: true,
      stats: stats,
      feeStructure: FEE_STRUCTURE,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Error getting tokenomics stats:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get tokenomics statistics"
    });
  }
});

// POST /api/tokenomics/track-burn - Track a burn event (for future enhancement)
router.post("/track-burn", async (req, res) => {
  try {
    const { amount, source, txHash } = req.body;

    if (!amount || !source) {
      return res.status(400).json({
        success: false,
        error: "Missing amount or source"
      });
    }

    // Store burn event for tracking
    const burnEvent = {
      amount: parseFloat(amount),
      source,
      txHash: txHash || null,
      timestamp: new Date().toISOString()
    };

    // Add to daily burn tracking
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `burns:${today}`;

    await redis.rPush(dailyKey, JSON.stringify(burnEvent));
    await redis.expire(dailyKey, 86400 * 30); // Keep for 30 days

    return res.json({
      success: true,
      message: "Burn event tracked",
      event: burnEvent
    });

  } catch (error) {
    console.error("❌ Error tracking burn:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to track burn event"
    });
  }
});

export default router;
