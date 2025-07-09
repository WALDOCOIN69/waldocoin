// routes/tokenomics.js - Token economics and fee tracking
import express from "express";
import { redis } from "../redisClient.js";

const router = express.Router();

console.log("🧩 Loaded: routes/tokenomics.js");

// Fee structure constants
const FEE_STRUCTURE = {
  battle: {
    start: 100,        // WALDO
    vote: 5,           // WALDO
    burnRate: 0.05     // 5% of pot
  },
  claim: {
    instantFeeRate: 0.10,  // 10%
    stakedFeeRate: 0.05,   // 5%
    burnRate: 0.02         // 2% of fee
  },
  nft: {
    mintCost: 50       // WALDO
  },
  dao: {
    votingRequirement: 10000  // WALDO
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
        "All fees collected in WALDO token"
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
          currency: "WALDO",
          destination: "Issuer Wallet",
          note: "Entry fee contributes to battle pot"
        };
        break;

      case "battle-vote":
        calculation = {
          action: "Vote on Battle",
          fee: FEE_STRUCTURE.battle.vote,
          currency: "WALDO", 
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
          currency: "WALDO",
          note: `${burn} WALDO burned, ${fee - burn} WALDO to fees`
        };
        break;

      case "nft-mint":
        calculation = {
          action: "Mint NFT",
          fee: FEE_STRUCTURE.nft.mintCost,
          currency: "WALDO",
          destination: "Distributor Wallet",
          requirement: "60+ XP meme",
          note: "One-time minting cost per meme"
        };
        break;

      case "dao-vote":
        calculation = {
          action: "DAO Vote",
          requirement: FEE_STRUCTURE.dao.votingRequirement,
          currency: "WALDO",
          note: "Minimum WALDO balance required to vote",
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

// GET /api/tokenomics/stats - Get tokenomics statistics
router.get("/stats", async (_, res) => {
  try {
    // Get various statistics from Redis
    const airdropCount = await redis.get("airdrop:count") || 0;
    const totalBattles = (await redis.keys("battle:*")).length;
    
    // Calculate estimated burns (this could be enhanced with actual tracking)
    const estimatedDailyBurns = {
      battles: totalBattles * 0.1, // Rough estimate
      claims: 50, // Rough estimate based on activity
      total: totalBattles * 0.1 + 50
    };

    return res.json({
      success: true,
      stats: {
        airdrop: {
          claimed: parseInt(airdropCount),
          remaining: 1000 - parseInt(airdropCount),
          totalDistributed: parseInt(airdropCount) * 50000
        },
        battles: {
          total: totalBattles,
          estimatedDailyBurns: estimatedDailyBurns.battles
        },
        estimatedDailyBurns: estimatedDailyBurns.total,
        feeStructure: FEE_STRUCTURE
      },
      note: "Statistics are estimates. Implement detailed tracking for precise metrics."
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
