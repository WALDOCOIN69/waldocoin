// routes/airdrop.js
import express from "express";
import xrpl from "xrpl";
import { redis } from "../redisClient.js";
import {
  WALDOCOIN_TOKEN,
  WALDO_ISSUER,
  WALDO_DISTRIBUTOR_SECRET
} from "../constants.js";

const router = express.Router();

// Airdrop configuration
const AIRDROP_LIMIT = 1000; // Maximum number of airdrops
const AIRDROP_AMOUNT = "50000.000000"; // Amount per airdrop
const AIRDROP_REDIS_KEY = "airdrop:wallets"; // Redis set to track claimed wallets
const AIRDROP_COUNT_KEY = "airdrop:count"; // Redis counter for total airdrops

router.post("/", async (req, res) => {
  const { wallet, password } = req.body;

  // Input validation
  if (!wallet || typeof wallet !== 'string' || !wallet.startsWith("r") || wallet.length < 25 || wallet.length > 34) {
    return res.status(400).json({ success: false, error: "Invalid wallet address format" });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: "Password is required" });
  }

  if (password !== "WALDOCREW") {
    return res.status(401).json({ success: false, error: "Invalid password" });
  }

  try {
    // Check if airdrop limit has been reached
    const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;
    if (parseInt(currentCount) >= AIRDROP_LIMIT) {
      return res.status(410).json({
        success: false,
        error: `Airdrop ended. Maximum ${AIRDROP_LIMIT} wallets have already claimed.`,
        totalClaimed: parseInt(currentCount)
      });
    }

    // Check if wallet has already claimed airdrop
    const hasAlreadyClaimed = await redis.sismember(AIRDROP_REDIS_KEY, wallet);
    if (hasAlreadyClaimed) {
      return res.status(409).json({
        success: false,
        error: "This wallet has already claimed the airdrop.",
        totalClaimed: parseInt(currentCount)
      });
    }
    console.log("🐛 Airdrop POST called");
    console.log("🐛 wallet from body:", wallet);
    console.log("🐛 WALDOCOIN_TOKEN:", WALDOCOIN_TOKEN);
    console.log("🐛 WALDO_ISSUER:", WALDO_ISSUER);

    const sender = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
    console.log("🚨 Sender wallet:", sender.classicAddress);

    const client = new xrpl.Client("wss://xrplcluster.com");
    await client.connect();

    // 🔍 Check if the wallet is active
    try {
      await client.request({
        command: 'account_info',
        account: wallet
      });
    } catch (err) {
      if (err.data?.error === 'actNotFound') {
        await client.disconnect();
        return res.status(400).json({
          success: false,
          error: "Destination wallet is not activated. Must hold XRP first."
        });
      }
      throw err;
    }

    // 🔍 Check trustline
    const trustlines = await client.request({
      command: "account_lines",
      account: wallet
    });

    const hasTrustline = trustlines.result.lines.some(
      (line) =>
        String(line.currency).trim().toUpperCase() === String(WALDOCOIN_TOKEN).trim().toUpperCase() &&
        line.account === WALDO_ISSUER
    );

    if (!hasTrustline) {
      await client.disconnect();
      return res.status(400).json({ success: false, error: "❌ No WALDO trustline found" });
    }

    // ✅ Build and send TX
    const tx = {
      TransactionType: "Payment",
      Account: sender.classicAddress,
      Destination: wallet,
      Amount: {
        currency: WALDOCOIN_TOKEN.toUpperCase(),
        issuer: WALDO_ISSUER,
        value: AIRDROP_AMOUNT
      }
    };

    const prepared = await client.autofill(tx);
    const signed = sender.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    await client.disconnect();

    if (result.result.meta.TransactionResult !== "tesSUCCESS") {
      console.error("❌ TX failed:", result.result.meta);
      return res.status(500).json({
        success: false,
        error: "Transaction failed",
        detail: result.result.meta.TransactionResult
      });
    }

    // ✅ Transaction successful - Track in Redis
    await redis.sadd(AIRDROP_REDIS_KEY, wallet); // Add wallet to claimed set
    const newCount = await redis.incr(AIRDROP_COUNT_KEY); // Increment counter

    console.log(`✅ Airdrop successful! Wallet ${wallet} claimed. Total: ${newCount}/${AIRDROP_LIMIT}`);

    return res.json({
      success: true,
      txHash: result.result.hash,
      amount: AIRDROP_AMOUNT,
      totalClaimed: newCount,
      remaining: AIRDROP_LIMIT - newCount
    });

  } catch (err) {
    console.error("❌ Airdrop error:", err);
    return res.status(500).json({ success: false, error: "Airdrop failed", detail: err.message });
  }
});

// GET /api/airdrop/status - Check airdrop status
router.get("/status", async (_, res) => {
  try {
    const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;
    const totalClaimed = parseInt(currentCount);
    const remaining = AIRDROP_LIMIT - totalClaimed;
    const isActive = remaining > 0;

    return res.json({
      success: true,
      airdrop: {
        isActive,
        totalLimit: AIRDROP_LIMIT,
        totalClaimed,
        remaining,
        amountPerClaim: AIRDROP_AMOUNT,
        status: isActive ? "ACTIVE" : "ENDED"
      }
    });
  } catch (err) {
    console.error("❌ Airdrop status error:", err);
    return res.status(500).json({ success: false, error: "Failed to get airdrop status" });
  }
});

// GET /api/airdrop/check/:wallet - Check if specific wallet has claimed
router.get("/check/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || !wallet.startsWith("r")) {
      return res.status(400).json({ success: false, error: "Invalid wallet address" });
    }

    const hasAlreadyClaimed = await redis.sismember(AIRDROP_REDIS_KEY, wallet);
    const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;

    return res.json({
      success: true,
      wallet,
      hasClaimed: hasAlreadyClaimed,
      totalClaimed: parseInt(currentCount),
      remaining: AIRDROP_LIMIT - parseInt(currentCount)
    });
  } catch (err) {
    console.error("❌ Airdrop check error:", err);
    return res.status(500).json({ success: false, error: "Failed to check wallet status" });
  }
});

export default router;



