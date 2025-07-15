// routes/staking.js - Comprehensive staking system
import express from "express";
import dayjs from "dayjs";
import { redis } from "../redisClient.js";
import { xummClient } from "../utils/xummClient.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

console.log("🧩 Loaded: routes/staking.js");

// Staking configuration
const STAKING_CONFIG = {
  minStakingPeriod: 30, // days
  maxStakingPeriod: 365, // days
  baseAPY: 0.12, // 12% base APY
  bonusAPY: 0.08, // 8% bonus for longer periods
  earlyUnstakePenalty: 0.15, // 15% penalty for early unstaking
  compoundingFrequency: 'daily' // daily compounding
};

// POST /api/staking/stake - Stake WALDO tokens
router.post("/stake", async (req, res) => {
  try {
    const { wallet, amount, duration } = req.body;
    
    // Input validation
    if (!wallet || !wallet.startsWith('r')) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet address"
      });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid staking amount"
      });
    }
    
    if (!duration || duration < STAKING_CONFIG.minStakingPeriod || duration > STAKING_CONFIG.maxStakingPeriod) {
      return res.status(400).json({
        success: false,
        error: `Staking duration must be between ${STAKING_CONFIG.minStakingPeriod} and ${STAKING_CONFIG.maxStakingPeriod} days`
      });
    }
    
    const stakeId = uuidv4();
    const now = dayjs();
    const unlockDate = now.add(duration, 'day');
    
    // Calculate APY based on duration
    const apy = duration >= 180 ? 
      STAKING_CONFIG.baseAPY + STAKING_CONFIG.bonusAPY : 
      STAKING_CONFIG.baseAPY;
    
    // Create XUMM payment to lock tokens
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.STAKING_VAULT_WALLET, // Dedicated staking vault
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: amount.toString()
        },
        DestinationTag: 888 // Staking tag
      },
      custom_meta: {
        identifier: `STAKE:${stakeId}`,
        instruction: `Stake ${amount} WALDO for ${duration} days at ${(apy * 100).toFixed(1)}% APY`
      }
    };
    
    const { created } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      return event.data.signed === true;
    });
    
    // Store staking record
    const stakeData = {
      stakeId,
      wallet,
      amount: parseFloat(amount),
      duration,
      apy,
      stakedAt: now.toISOString(),
      unlockDate: unlockDate.toISOString(),
      status: 'pending',
      source: 'direct_stake', // Mark as direct stake for tiered re-staking eligibility
      txHash: null,
      rewards: 0,
      lastCompounded: now.toISOString()
    };
    
    await redis.hSet(`stake:${stakeId}`, stakeData);
    await redis.sAdd(`stakes:wallet:${wallet}`, stakeId);
    await redis.set(`stake:pending:${stakeId}`, created.uuid, { EX: 900 }); // 15 min TTL
    
    return res.json({
      success: true,
      stakeId,
      uuid: created.uuid,
      qr: created.refs.qr_png,
      redirect: created.next.always,
      stakeData
    });
    
  } catch (error) {
    console.error("❌ Staking error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to create staking transaction"
    });
  }
});

// POST /api/staking/unstake - Unstake tokens
router.post("/unstake", async (req, res) => {
  try {
    const { wallet, stakeId, force = false } = req.body;
    
    if (!wallet || !stakeId) {
      return res.status(400).json({
        success: false,
        error: "Wallet and stake ID required"
      });
    }
    
    const stakeData = await redis.hGetAll(`stake:${stakeId}`);
    if (!stakeData || !stakeData.wallet) {
      return res.status(404).json({
        success: false,
        error: "Stake not found"
      });
    }
    
    if (stakeData.wallet !== wallet) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to unstake this position"
      });
    }
    
    if (stakeData.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: "Stake is not active"
      });
    }
    
    const now = dayjs();
    const unlockDate = dayjs(stakeData.unlockDate);
    const isEarlyUnstake = now.isBefore(unlockDate);
    
    if (isEarlyUnstake && !force) {
      return res.status(400).json({
        success: false,
        error: "Stake is still locked. Use force=true for early unstaking with penalty.",
        unlockDate: stakeData.unlockDate,
        penalty: `${STAKING_CONFIG.earlyUnstakePenalty * 100}%`
      });
    }
    
    // Calculate final rewards
    const rewards = await calculateStakingRewards(stakeId);
    const penalty = isEarlyUnstake ? parseFloat(stakeData.amount) * STAKING_CONFIG.earlyUnstakePenalty : 0;
    const finalAmount = parseFloat(stakeData.amount) + rewards - penalty;
    
    // Create unstaking transaction
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: wallet,
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: finalAmount.toString()
        },
        DestinationTag: 889 // Unstaking tag
      },
      custom_meta: {
        identifier: `UNSTAKE:${stakeId}`,
        instruction: `Unstake ${stakeData.amount} WALDO + ${rewards.toFixed(2)} rewards${penalty > 0 ? ` - ${penalty.toFixed(2)} penalty` : ''}`
      }
    };
    
    const { created } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      return event.data.signed === true;
    });
    
    // Update stake status
    await redis.hSet(`stake:${stakeId}`, {
      status: 'unstaking',
      unstakedAt: now.toISOString(),
      finalAmount,
      rewards,
      penalty: penalty || 0,
      isEarlyUnstake
    });
    
    return res.json({
      success: true,
      stakeId,
      originalAmount: parseFloat(stakeData.amount),
      rewards,
      penalty,
      finalAmount,
      isEarlyUnstake,
      uuid: created.uuid,
      qr: created.refs.qr_png
    });
    
  } catch (error) {
    console.error("❌ Unstaking error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process unstaking"
    });
  }
});

// GET /api/staking/positions/:wallet - Get staking positions
router.get("/positions/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet || !wallet.startsWith('r')) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet address"
      });
    }
    
    const stakeIds = await redis.sMembers(`stakes:wallet:${wallet}`);
    const positions = [];
    
    for (const stakeId of stakeIds) {
      const stakeData = await redis.hGetAll(`stake:${stakeId}`);
      if (stakeData && stakeData.wallet) {
        const currentRewards = await calculateStakingRewards(stakeId);
        positions.push({
          ...stakeData,
          amount: parseFloat(stakeData.amount),
          apy: parseFloat(stakeData.apy),
          rewards: parseFloat(stakeData.rewards),
          currentRewards,
          totalValue: parseFloat(stakeData.amount) + currentRewards
        });
      }
    }
    
    return res.json({
      success: true,
      wallet,
      positions,
      totalStaked: positions.reduce((sum, p) => sum + p.amount, 0),
      totalRewards: positions.reduce((sum, p) => sum + p.currentRewards, 0)
    });
    
  } catch (error) {
    console.error("❌ Error getting staking positions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking positions"
    });
  }
});

// Helper function to calculate staking rewards with proper payout logic
async function calculateStakingRewards(stakeId) {
  try {
    const stakeData = await redis.hGetAll(`stake:${stakeId}`);
    if (!stakeData || !stakeData.wallet) return 0;

    const stakedAt = dayjs(stakeData.stakedAt);
    const unlockDate = dayjs(stakeData.unlockDate);
    const now = dayjs();

    // Check if stake has matured and needs automatic payout
    if (now.isAfter(unlockDate) && stakeData.status === 'active') {
      await processAutomaticPayout(stakeId);
      return 0; // No rewards during payout processing
    }

    // Only calculate rewards up to the unlock date, not beyond
    const effectiveEndDate = now.isBefore(unlockDate) ? now : unlockDate;
    const daysStaked = effectiveEndDate.diff(stakedAt, 'day', true);

    const principal = parseFloat(stakeData.amount);
    const apy = parseFloat(stakeData.apy);

    // Simple daily compounding calculation - only up to unlock date
    const dailyRate = apy / 365;
    const rewards = principal * (Math.pow(1 + dailyRate, daysStaked) - 1);

    return Math.max(0, rewards);
  } catch (error) {
    console.error("❌ Error calculating rewards:", error);
    return 0;
  }
}

// Process automatic payout when staking period ends
async function processAutomaticPayout(stakeId) {
  try {
    const stakeData = await redis.hGetAll(`stake:${stakeId}`);
    if (!stakeData || stakeData.status !== 'active') return;

    const stakedAt = dayjs(stakeData.stakedAt);
    const unlockDate = dayjs(stakeData.unlockDate);
    const daysStaked = unlockDate.diff(stakedAt, 'day', true);

    const principal = parseFloat(stakeData.amount);
    const apy = parseFloat(stakeData.apy);

    // Calculate final rewards for the exact staking period
    const dailyRate = apy / 365;
    const finalRewards = principal * (Math.pow(1 + dailyRate, daysStaked) - 1);
    const totalPayout = principal + finalRewards;

    // Create automatic payout transaction
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: stakeData.wallet,
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: totalPayout.toString()
        },
        DestinationTag: 890 // Automatic payout tag
      },
      custom_meta: {
        identifier: `AUTO_PAYOUT:${stakeId}`,
        instruction: `Automatic payout: ${principal} WALDO + ${finalRewards.toFixed(2)} rewards`
      }
    };

    const { created } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      return event.data.signed === true;
    });

    // Update stake status to completed with payout details
    await redis.hSet(`stake:${stakeId}`, {
      status: 'completed',
      completedAt: dayjs().toISOString(),
      finalRewards,
      totalPayout,
      payoutTxHash: created.uuid,
      // Add 7-day window for re-staking into tiered APY
      restakeWindowEnd: dayjs().add(7, 'day').toISOString()
    });

    console.log(`✅ Automatic payout processed for stake ${stakeId}: ${totalPayout} WALDO`);

  } catch (error) {
    console.error("❌ Error processing automatic payout:", error);
  }
}

// Tiered re-staking endpoint (only available after payout)
router.post("/restake", async (req, res) => {
  try {
    const { wallet, completedStakeId, amount, duration } = req.body;

    if (!wallet || !completedStakeId || !amount || !duration) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, completedStakeId, amount, duration"
      });
    }

    // Validate the completed stake and re-staking window
    const completedStake = await redis.hGetAll(`stake:${completedStakeId}`);
    if (!completedStake || completedStake.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: "Invalid or incomplete stake reference"
      });
    }

    // Ensure this was an original staking position (not instant payout)
    // Only users who originally chose staking can access tiered re-staking
    if (!completedStake.source || (completedStake.source !== 'meme_claim' && completedStake.source !== 'direct_stake')) {
      return res.status(403).json({
        success: false,
        error: "Tiered re-staking is only available for users who originally chose staking over instant payout"
      });
    }

    const restakeWindowEnd = dayjs(completedStake.restakeWindowEnd);
    const now = dayjs();

    if (now.isAfter(restakeWindowEnd)) {
      return res.status(400).json({
        success: false,
        error: "Re-staking window has expired. Please create a new stake."
      });
    }

    // Validate duration for tiered APY
    if (duration < 30 || duration > 365) {
      return res.status(400).json({
        success: false,
        error: "Duration must be between 30 and 365 days"
      });
    }

    // Calculate tiered APY based on previous staking history
    let tierMultiplier = 1.0;
    const previousDuration = parseInt(completedStake.duration);

    // Tier bonuses based on previous staking commitment
    if (previousDuration >= 365) {
      tierMultiplier = 1.3; // 30% bonus for previous year-long stakers
    } else if (previousDuration >= 180) {
      tierMultiplier = 1.2; // 20% bonus for previous 6-month stakers
    } else if (previousDuration >= 90) {
      tierMultiplier = 1.1; // 10% bonus for previous 3-month stakers
    }

    // Base APY calculation with tier bonus
    const baseAPY = duration >= 180 ?
      STAKING_CONFIG.baseAPY + STAKING_CONFIG.bonusAPY :
      STAKING_CONFIG.baseAPY;

    const tieredAPY = baseAPY * tierMultiplier;

    const stakeId = uuidv4();
    const unlockDate = now.add(duration, 'day');

    // Create XUMM payment for re-staking
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.STAKING_VAULT_WALLET,
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: amount.toString()
        },
        DestinationTag: 891 // Tiered re-staking tag
      },
      custom_meta: {
        identifier: `RESTAKE:${stakeId}`,
        instruction: `Tiered re-stake: ${amount} WALDO for ${duration} days at ${(tieredAPY * 100).toFixed(1)}% APY (${((tierMultiplier - 1) * 100).toFixed(0)}% tier bonus)`
      }
    };

    const { created } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      return event.data.signed === true;
    });

    // Store tiered staking record
    const stakeData = {
      stakeId,
      wallet,
      amount: parseFloat(amount),
      duration,
      apy: tieredAPY,
      baseAPY,
      tierMultiplier,
      previousStakeId: completedStakeId,
      stakedAt: now.toISOString(),
      unlockDate: unlockDate.toISOString(),
      status: 'pending',
      type: 'tiered_restake',
      txHash: null,
      rewards: 0,
      lastCompounded: now.toISOString()
    };

    await redis.hSet(`stake:${stakeId}`, stakeData);
    await redis.sAdd(`stakes:wallet:${wallet}`, stakeId);
    await redis.set(`stake:pending:${stakeId}`, created.uuid, { EX: 900 });

    // Mark the completed stake as re-staked to prevent multiple re-stakes
    await redis.hSet(`stake:${completedStakeId}`, {
      restakedTo: stakeId,
      restakedAt: now.toISOString()
    });

    return res.json({
      success: true,
      stakeId,
      tieredAPY,
      tierMultiplier,
      baseAPY,
      uuid: created.uuid,
      qr: created.refs.qr_png,
      redirect: created.next.always,
      stakeData
    });

  } catch (error) {
    console.error("❌ Tiered re-staking error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process tiered re-staking"
    });
  }
});

export default router;
