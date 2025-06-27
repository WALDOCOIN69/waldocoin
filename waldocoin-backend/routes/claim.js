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

  if (!wallet || !memeId || typeof tier !== "number") {
    return res.status(400).json({ success: false, error: "Missing required fields" });
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
    const net = gross - fee;

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
      timestamp: now.toISOString()
    }));

    await redis.incr(tierKey);
    await redis.set(memeClaimKey, "true"); // Prevent double claim

    // 📝 Trigger payout via XUMM
    const payload = {
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

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("User rejected the sign request");
    });

    return res.json({
      success: true,
      claimId,
      net,
      fee,
      burn,
      toXRP,
      stake: finalStake,
      next,
      uuid
    });

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

