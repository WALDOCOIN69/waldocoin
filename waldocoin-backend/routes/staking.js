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

// Helper function to calculate staking rewards
async function calculateStakingRewards(stakeId) {
  try {
    const stakeData = await redis.hGetAll(`stake:${stakeId}`);
    if (!stakeData || !stakeData.wallet) return 0;
    
    const stakedAt = dayjs(stakeData.stakedAt);
    const now = dayjs();
    const daysStaked = now.diff(stakedAt, 'day', true);
    
    const principal = parseFloat(stakeData.amount);
    const apy = parseFloat(stakeData.apy);
    
    // Simple daily compounding calculation
    const dailyRate = apy / 365;
    const rewards = principal * (Math.pow(1 + dailyRate, daysStaked) - 1);
    
    return Math.max(0, rewards);
  } catch (error) {
    console.error("❌ Error calculating rewards:", error);
    return 0;
  }
}

export default router;
