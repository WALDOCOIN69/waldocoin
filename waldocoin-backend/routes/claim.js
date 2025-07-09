import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { redis } from "../redisClient.js";
import { xummClient } from "../utils/xummClient.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

console.log("🧩 Loaded: routes/claim.js");

// 🧠 XP-based reward system
const baseRewards = [0, 100, 200, 300]; // By tier
const maxClaimsPerMonth = 10;
const stakingWindowHours = 8;
const memeCooldownDays = 30;

router.post("/", async (req, res) => {
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
    const feeRate = finalStake ? 0.05 : 0.10;
    const burnRate = 0.02;

    const gross = baseReward;
    const fee = Math.floor(gross * feeRate);
    const burn = Math.floor(fee * burnRate);
    const toXRP = fee - burn;

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
      timestamp: now.toISOString()
    }));

    await redis.incr(tierKey);
    await redis.set(memeClaimKey, "true"); // Prevent double claim

    // Handle staked vs instant claims differently
    let payload;

    if (finalStake && stakedAmount > 0) {
      // For staked claims, create a staking position
      const stakeId = uuidv4();
      const unlockDate = now.add(30, 'day'); // 30-day minimum staking period

      // Store staking position
      await redis.hSet(`stake:${stakeId}`, {
        stakeId,
        wallet,
        amount: stakedAmount,
        duration: 30,
        apy: 0.12, // 12% APY
        stakedAt: now.toISOString(),
        unlockDate: unlockDate.toISOString(),
        status: 'active',
        source: 'meme_claim',
        memeId,
        rewards: 0,
        lastCompounded: now.toISOString()
      });

      await redis.sAdd(`stakes:wallet:${wallet}`, stakeId);

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

export default router;

