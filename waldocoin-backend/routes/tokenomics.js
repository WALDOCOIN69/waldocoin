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

// GET /api/tokenomics/stats - Get comprehensive tokenomics statistics for admin panel
router.get("/stats", async (_, res) => {
  try {
    // Get airdrop statistics
    const airdropClaimed = await redis.get("airdrop:total_claimed") || 0;
    const airdropRemaining = 1000 - parseInt(airdropClaimed);
    const totalDistributed = parseInt(airdropClaimed) * 50; // 50 WALDO per airdrop

    // Get battle statistics
    const activeBattles = await redis.get("battles:active_count") || 0;
    const totalBattles = await redis.get("battles:total_count") || 0;
    const battleKeys = await redis.keys("battle:*");
    const actualBattleCount = battleKeys.length;

    // Get staking statistics
    const totalStaked = await redis.get("staking:total_amount") || 0;
    const activeStakers = await redis.get("staking:active_count") || 0;

    // Get user statistics
    const totalUsers = await redis.get("users:total_count") || 150; // Default estimate
    const activeUsers = await redis.get("users:active_count") || 45; // Default estimate

    // Calculate burn statistics
    const estimatedDailyBurns = {
      battles: parseInt(totalBattles) * 5, // 5 WALDO average per battle
      claims: parseInt(airdropClaimed) * 2.5, // 2.5 WALDO average per claim
      total: (parseInt(totalBattles) * 5) + (parseInt(airdropClaimed) * 2.5)
    };

    // Calculate additional metrics
    const airdropProgress = (parseInt(airdropClaimed) / 1000) * 100;
    const averageStakePerUser = parseInt(activeStakers) > 0 ? (parseInt(totalStaked) / parseInt(activeStakers)) : 0;

    const stats = {
      totalUsers: parseInt(totalUsers),
      totalWaldoDistributed: totalDistributed,
      activeBattles: parseInt(activeBattles),
      totalStaked: parseInt(totalStaked),
      airdrop: {
        totalClaimed: parseInt(airdropClaimed),
        totalDistributed: totalDistributed,
        remaining: airdropRemaining,
        progress: airdropProgress.toFixed(1),
        isActive: airdropRemaining > 0
      },
      battles: {
        active: parseInt(activeBattles),
        total: Math.max(parseInt(totalBattles), actualBattleCount),
        averageParticipation: parseInt(totalUsers) > 0 ? (parseInt(totalBattles) / parseInt(totalUsers) * 100).toFixed(1) : 0,
        estimatedDailyBurns: estimatedDailyBurns.battles
      },
      staking: {
        totalStaked: parseInt(totalStaked),
        activeStakers: parseInt(activeStakers),
        averageStake: averageStakePerUser.toFixed(2),
        stakingRate: parseInt(totalUsers) > 0 ? ((parseInt(activeStakers) / parseInt(totalUsers)) * 100).toFixed(1) : 0
      },
      burns: estimatedDailyBurns,
      system: {
        lastUpdated: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
      }
    };

    console.log('📊 Enhanced tokenomics stats requested:', {
      totalUsers: stats.totalUsers,
      airdropClaimed: stats.airdrop.totalClaimed,
      activeBattles: stats.battles.active,
      totalStaked: stats.staking.totalStaked
    });

    return res.json({
      success: true,
      stats: stats,
      feeStructure: FEE_STRUCTURE,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Error getting enhanced tokenomics stats:", error);
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
