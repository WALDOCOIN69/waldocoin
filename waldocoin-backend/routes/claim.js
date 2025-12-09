import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { redis } from "../redisClient.js";
import { xummClient } from "../utils/xummClient.js";
import { rateLimitMiddleware } from "../utils/rateLimiter.js";
import { createErrorResponse, logError } from "../utils/errorHandler.js";
import { addToHolderRewardPool } from "../utils/nftUtilities.js";
import { claimFraudPrevention } from "../middleware/fraudPrevention.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

console.log("🧩 Loaded: routes/claim.js");

// 🧠 XP-based reward system
const baseRewards = [0, 100, 200, 300]; // By tier
const maxClaimsPerMonth = 20;
const stakingWindowHours = 8;
const memeCooldownDays = 30;

// Apply full fraud prevention + rate limiting to claim endpoint
router.post("/", claimFraudPrevention, rateLimitMiddleware('PAYMENT_CREATE', (req) => req.body.wallet), async (req, res) => {
  const { wallet, stake, tier, memeId } = req.body;

  // Input validation
  if (!wallet || typeof wallet !== 'string' || !wallet.startsWith("r") || wallet.length < 25 || wallet.length > 34) {
    return res.status(400).json({ success: false, error: "Invalid wallet address format" });
  }

  if (!memeId || typeof memeId !== 'string' || memeId.length === 0) {
    return res.status(400).json({ success: false, error: "Invalid meme ID" });
  }

  if (typeof tier !== "number" || tier < 0 || tier > 3 || !Number.isInteger(tier)) {
    return res.status(400).json({ success: false, error: "Invalid tier value" });
  }

  if (stake !== undefined && typeof stake !== 'boolean') {
    return res.status(400).json({ success: false, error: "Stake must be a boolean value" });
  }


  // Enforce minimum WALDO worth: 3 XRP
  try {
    const { ensureMinWaldoWorth } = await import("../utils/waldoWorth.js");
    const worth = await ensureMinWaldoWorth(wallet, 3);
    if (!worth.ok) {
      return res.status(403).json({
        success: false,
        error: `Minimum balance required: ${worth.requiredWaldo.toLocaleString()} WALDO (~${worth.minXrp} XRP at ${worth.waldoPerXrp.toLocaleString()} WALDO/XRP). Your balance: ${worth.balance.toLocaleString()} WALDO`,
        details: worth
      });
    }
  } catch (e) {
    console.warn('Worth check failed, denying claim:', e.message || e);
    return res.status(503).json({ success: false, error: 'Temporary wallet worth check failure. Please try again.' });
  }

  const now = dayjs();
  const monthKey = now.format("YYYY-MM");
  const logKey = `rewards:${wallet}:${monthKey}:log`;
  const tierKey = `rewards:${wallet}:${monthKey}:tier:${tier}`;
  const memeClaimKey = `meme:${memeId}:claimed`;
  const memePostedKey = `meme:${memeId}:timestamp`;

  try {
    // ⏱️ Check if meme is already claimed
    const claimed = await redis.get(memeClaimKey);
    if (claimed) {
      return res.status(409).json({ success: false, error: "Reward already claimed for this meme." });
    }

    // 📅 Check monthly claim cap
    const logs = await redis.lRange(logKey, 0, -1);
    if (logs.length >= maxClaimsPerMonth) {
      return res.status(403).json({ success: false, error: "Monthly reward limit reached." });
    }

    // 🔍 Debug block to check if meme is stored correctly
    const redisKey = `memes:${wallet}:${memeId}`;
    const memeData = await redis.hGetAll(redisKey);
    console.log("🔍 Redis data for meme:", redisKey, memeData);

    if (!memeData || !memeData.timestamp) {
      console.log("❌ Meme not found or missing timestamp in Redis");
      return res.status(400).json({ success: false, error: "Meme not tracked or missing timestamp." });
    }

    // ⌛ Check meme age and staking window
    const postedAtRaw = memeData.timestamp;
    if (!postedAtRaw) {
      console.log("❌ Timestamp missing in memeData");
      return res.status(400).json({ success: false, error: "Meme not tracked or missing timestamp." });
    }
    const postedAt = dayjs.unix(parseInt(postedAtRaw));

    const stakingDeadline = postedAt.add(stakingWindowHours, "hour");
    const memeExpiry = postedAt.add(memeCooldownDays, "day");

    if (now.isAfter(memeExpiry)) {
      return res.status(410).json({ success: false, error: "Meme is too old to claim." });
    }

    const finalStake = now.isAfter(stakingDeadline) ? false : stake;

    // 🎯 Validate reward tier
    const baseReward = baseRewards[tier] || 0;
    if (baseReward === 0) {
      return res.status(400).json({ success: false, error: "Invalid reward tier." });
    }

    const claimId = uuidv4();
    const { getClaimConfig } = await import("../utils/config.js");
    const claimCfg = await getClaimConfig();
    const feeRate = finalStake ? claimCfg.stakedFeeRate : claimCfg.instantFeeRate;
    const burnRate = claimCfg.burnRate || 0.0025;  // 0.25% of fee burned
    const revenueShareRate = claimCfg.revenueShareRate || 0.10;    // 10% of fee to NFT holder revenue share

    const gross = baseReward;
    const fee = Math.floor(gross * feeRate);
    const burn = Math.floor(fee * burnRate);
    const revenueShare = Math.floor(fee * revenueShareRate);
    const holderPoolContribution = revenueShare;
    const toXRP = fee - burn - revenueShare;

    // 💰 NFT Holder Revenue Share: 10% of claim fees go to holder reward pool (3+ NFTs only)
    if (revenueShare > 0) {
      await addToHolderRewardPool(revenueShare);
      console.log(`💰 Added ${revenueShare} WALDO to NFT holder reward pool from claim fee (10% of ${fee} fee)`);
    }

    // 🔥 Burn: 0.25% of claim fees burned
    if (burn > 0) {
      console.log(`🔥 Burning ${burn} WALDO from claim fee (0.25% of ${fee} fee)`);
    }

    // For staked claims, tokens go to staking vault instead of user
    const net = finalStake ? 0 : gross - fee; // Immediate payout only for instant claims
    const stakedAmount = finalStake ? gross - fee : 0; // Amount to be staked

    // 🧠 Log claim metadata
    await redis.rPush(logKey, JSON.stringify({
      claimId,
      memeId,
      tier,
      stake: finalStake,
      gross,
      fee,
      burn,
      toXRP,
      net,
      stakedAmount,
      holderPoolContribution,
      timestamp: now.toISOString()
    }));

    await redis.incr(tierKey);
    await redis.set(memeClaimKey, "true"); // Prevent double claim

    // Handle staked vs instant claims differently
    let payload;

    if (finalStake && stakedAmount > 0) {
      // For staked claims, create a per-meme staking position using new dual system
      const stakeId = `permeme_${wallet}_${Date.now()}_${memeId}`;
      const unlockDate = now.add(30, 'day'); // Fixed 30-day per-meme staking

      // Calculate per-meme staking values (whitepaper system)
      const stakingFee = Math.floor(stakedAmount * 0.05); // 5% staking fee
      const actualStaked = stakedAmount - stakingFee;
      const bonusAmount = Math.floor(actualStaked * 0.15); // Fixed 15% bonus
      const totalReward = actualStaked + bonusAmount;

      // Store per-meme staking position using new dual system format
      await redis.hSet(`staking:${stakeId}`, {
        stakeId,
        wallet,
        memeId,
        originalAmount: stakedAmount,
        stakingFee: stakingFee,
        stakedAmount: actualStaked,
        bonusAmount: bonusAmount,
        totalReward: totalReward,
        duration: 30,
        startDate: now.toISOString(),
        endDate: unlockDate.toISOString(),
        status: 'active',
        type: 'per_meme',
        source: 'meme_claim',
        claimed: false,
        createdAt: now.toISOString()
      });

      // Add to user's per-meme stakes
      await redis.sAdd(`user:${wallet}:per_meme_stakes`, stakeId);

      // Update global per-meme staking totals
      await redis.incrByFloat('staking:total_per_meme_staked', actualStaked);
      await redis.incr('staking:total_per_meme_stakes');

      // Log per-meme staking creation
      await redis.lPush('staking_logs', JSON.stringify({
        action: 'per_meme_stake_from_claim',
        stakeId,
        wallet,
        memeId,
        originalAmount: stakedAmount,
        stakedAmount: actualStaked,
        bonusAmount: bonusAmount,
        timestamp: now.toISOString()
      }));

      console.log(`🎭 Per-meme stake created from claim: ${wallet} staked ${actualStaked} WALDO for meme ${memeId}`);

      // No immediate payout for staked claims
      payload = null;

    } else {
      // For instant claims, create immediate payout
      payload = {
        txjson: {
          TransactionType: "Payment",
          Destination: wallet,
          Amount: String(net * 1_000_000), // drops
          DestinationTag: 12345
        },
        options: {
          submit: true,
          expire: 300
        }
      };
    }

    if (payload) {
      // Process instant claim payment
      const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
        if (event.data.signed === true) return true;
        if (event.data.signed === false) throw new Error("User rejected the sign request");
      });

      return res.json({
        success: true,
        claimId,
        type: 'instant',
        net,
        fee,
        burn,
        toXRP,
        stake: finalStake,
        next,
        uuid
      });
    } else {
      // Staked claim - no immediate payment
      return res.json({
        success: true,
        claimId,
        type: 'staked',
        stakedAmount,
        fee,
        burn,
        toXRP,
        stake: finalStake,
        message: `${stakedAmount} WALDO staked for 30 days at 12% APY`,
        unlockDate: now.add(30, 'day').toISOString()
      });
    }

  } catch (err) {
    console.error("❌ Claim processing error:", err);
    return res.status(500).json({
      success: false,
      error: "XUMM claim failed",
      detail: err.message
    });
  }
});

// POST /api/claim - Claim meme rewards (for stats dashboard)
router.post('/', rateLimitMiddleware('PAYMENT_CREATE', (req) => req.body.wallet), async (req, res) => {
  try {
    const { wallet, memeId, tier, stake } = req.body;

    if (!wallet || !memeId || !tier) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, memeId, tier"
      });
    }

    // Check minimum WALDO balance requirement (dynamic from admin settings)
    const userData = await redis.hGetAll(`user:${wallet}`);
    const waldoBalance = parseInt(userData.waldoBalance) || 0;

    // Get current minimum requirement from admin settings
    const minimumWaldo = await redis.get("requirements:meme_rewards") || 6000; // Default 6000 WALDO
    const waldoPerXrp = await redis.get("conversion:waldo_per_xrp") || 1000; // Default 1000 WALDO per XRP
    const xrpWorth = (minimumWaldo / waldoPerXrp).toFixed(1);

    if (waldoBalance < minimumWaldo) {
      return res.status(400).json({
        success: false,
        error: `Minimum ${parseInt(minimumWaldo).toLocaleString()} WALDO (${xrpWorth} XRP worth) required to claim meme rewards. Current balance: ${waldoBalance.toLocaleString()} WALDO`,
        minimumRequired: parseInt(minimumWaldo),
        currentBalance: waldoBalance,
        shortfall: parseInt(minimumWaldo) - waldoBalance,
        xrpWorth: parseFloat(xrpWorth)
      });
    }

    // Check if already claimed
    const claimKey = `claim:${wallet}:${memeId}`;
    const alreadyClaimed = await redis.get(claimKey);

    if (alreadyClaimed) {
      return res.json({
        success: false,
        error: "Meme already claimed by this wallet"
      });
    }

    // Calculate reward based on tier
    const tierRewards = {
      1: 10,   // Tier 1: 10 WALDO
      2: 25,   // Tier 2: 25 WALDO
      3: 50,   // Tier 3: 50 WALDO
      4: 100,  // Tier 4: 100 WALDO
      5: 250   // Tier 5: 250 WALDO
    };

    const baseReward = tierRewards[tier] || 10;
    let finalReward = baseReward;

    // Apply staking bonus if chosen
    if (stake) {
      finalReward = Math.floor(baseReward * 1.5); // 50% bonus for staking
    }

    // Record the claim
    await redis.set(claimKey, JSON.stringify({
      wallet,
      memeId,
      tier,
      baseReward,
      finalReward,
      staked: stake,
      claimedAt: new Date().toISOString()
    }), { EX: 60 * 60 * 24 * 30 }); // 30 day expiry

    // Update user stats
    const userKey = `user:${wallet}`;
    await redis.hIncrBy(userKey, 'totalClaimed', finalReward);
    await redis.hIncrBy(userKey, 'totalClaims', 1);

    // Update global stats
    await redis.incrBy('stats:total_claimed', finalReward);
    await redis.incr('stats:total_claims');

    console.log(`💰 Claim processed: ${wallet} claimed ${finalReward} WALDO for meme ${memeId} (tier ${tier})`);

    return res.json({
      success: true,
      message: `Successfully claimed ${finalReward} WALDO!`,
      reward: finalReward,
      staked: stake,
      tier: tier
    });

  } catch (error) {
    console.error('❌ Claim error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to process claim"
    });
  }
});

export default router;

