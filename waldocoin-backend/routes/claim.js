// routes/claim.js

import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isAutoBlocked, logViolation } from "../utils/security.js";

dotenv.config();
const router = express.Router();

// Setup DB path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "../db.json");

// Constants
const ISSUER = "rf97bQQbqztUnL1BYB5ti4rC691e7u5C8F";
const CURRENCY = "WLD";
const WALDO_TO_XRP = 0.0042;

const INSTANT_FEE_PERCENT = 0.10;
const STAKE_FEE_PERCENT = 0.05;
const BURN_RATE = 0.02;

const tierCaps = {
  1: 36,
  2: 72,
  3: 180,
  4: 900,
  5: 1800
};

function getBaseRewardByTier(tier) {
  const map = { 1: 1, 2: 2, 3: 5, 4: 25, 5: 50 };
  return map[tier] || null;
}

router.post("/", async (req, res) => {
  const { wallet, stake, tier, memeId } = req.body;

  if (!wallet || typeof stake !== "boolean" || !tier) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const xummPkg = await import("xumm-sdk");
    const Xumm = xummPkg.default || xummPkg.Xumm || xummPkg;
    const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
  

    if (await isAutoBlocked(wallet)) {
      return res.status(403).json({
        error: "❌ This wallet is temporarily blocked due to repeated abuse."
      });
    }

    const db = JSON.parse(fs.readFileSync(DB_PATH));
    db.rewards = db.rewards || {};
    db.rewards[wallet] = db.rewards[wallet] || {};

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    db.rewards[wallet][monthKey] = db.rewards[wallet][monthKey] || {};

    const log = db.rewards[wallet][monthKey]._log || [];
    if (log.length >= 10) {
      await logViolation(wallet, "claim_limit_exceeded", { memeId, currentLogLength: log.length });
      return res.status(400).json({
        success: false,
        error: "❌ You’ve already claimed rewards for 10 memes this month."
      });
    }

    const baseReward = getBaseRewardByTier(tier);
    if (!baseReward) {
      await logViolation(wallet, "invalid_tier", { tier, memeId });
      return res.status(400).json({ error: "Invalid tier" });
    }

    let reward = stake
      ? baseReward * 1.15 * (1 - STAKE_FEE_PERCENT)
      : baseReward * (1 - INSTANT_FEE_PERCENT);

    const claimedThisMonth = db.rewards[wallet][monthKey][tier] || 0;
    const maxAllowed = tierCaps[tier];

    if ((claimedThisMonth + reward) > maxAllowed) {
      await logViolation(wallet, "tier_cap_exceeded", { tier, reward, claimedThisMonth, memeId });
      return res.json({
        success: false,
        error: `Monthly cap reached for Tier ${tier}. You’ve already claimed ${claimedThisMonth.toFixed(2)} WALDO this month.`
      });
    }

    console.log("🧪 Creating payload with:", {
      wallet,
      stake,
      tier,
      reward,
      issuer: ISSUER
    });

    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: wallet,
        Amount: {
          currency: CURRENCY,
          value: reward.toFixed(2),
          issuer: ISSUER
        }
      },
      options: {
        submit: true,
        expire: 300
      }
    });

    // Save reward
    db.rewards[wallet][monthKey][tier] = claimedThisMonth + reward;
    db.rewards[wallet][monthKey]._log = log.concat({
      timestamp: new Date().toISOString(),
      tier,
      stake,
      reward: reward.toFixed(2),
      memeId
    });

    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

    res.json({
      success: true,
      uuid: payload.uuid,
      signUrl: payload.next.always,
      qr: payload.refs.qr_png,
      reward: reward.toFixed(2)
    });
  } 
  catch (err) {
    const reason =
      err?.response?.data ||
      err?.data ||
      err?.message ||
      err;
  
    console.error("❌ XUMM Claim Error:", reason);
    res.status(500).json({
      success: false,
      error: "XUMM claim failed.",
      detail: reason
    });
  }
});

export default router;

