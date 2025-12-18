import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import { fileURLToPath } from "url";
import path from "path";
import { xummClient } from "../utils/xummClient.js";
import { mintFraudPrevention } from "../middleware/fraudPrevention.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const router = express.Router();

// NFT Deposit/Base Value Configuration
const NFT_DEPOSIT = {
  min: 10000,   // 10k WLO minimum
  max: 100000,  // 100k WLO maximum
  step: 10000   // 10k increments
};

// 🧠 Start NFT Mint Payment Flow (protected by fraud prevention)
router.post("/", mintFraudPrevention, async (req, res) => {
  try {
    const { tweetId, wallet, deposit } = req.body;

    if (!tweetId || !wallet) {
      return res.status(400).json({ success: false, error: "Missing tweetId or wallet." });
    }

    // Validate deposit amount (base value for the NFT)
    const depositAmount = parseInt(deposit) || NFT_DEPOSIT.min;
    if (depositAmount < NFT_DEPOSIT.min || depositAmount > NFT_DEPOSIT.max) {
      return res.status(400).json({
        success: false,
        error: `Deposit must be between ${NFT_DEPOSIT.min.toLocaleString()} and ${NFT_DEPOSIT.max.toLocaleString()} WLO.`,
        depositConfig: NFT_DEPOSIT
      });
    }

    // Enforce minimum WALDO worth: 3 XRP before mint flow
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
      console.warn('Worth check failed, denying NFT mint start:', e.message || e);
      return res.status(503).json({ success: false, error: 'Temporary wallet worth check failure. Please try again.' });
    }

    const alreadyMinted = await redis.get(`meme:nft_minted:${tweetId}`);

    if (alreadyMinted) {
      return res.status(409).json({ success: false, error: "NFT already minted for this meme." });
    }

    // Enforce minimum XP for NFT minting (project policy)
    const memeXP = parseInt(await redis.get(`meme:xp:${tweetId}`)) || 0;
    if (memeXP < 60) {
      return res.status(403).json({ success: false, error: "Meme needs at least 60 XP to mint." });
    }

    // NFT mint cost from config (base fee) + deposit (base value)
    const { getNftConfig } = await import("../utils/config.js");
    const nftCfg = await getNftConfig();
    const totalPayment = nftCfg.mintCostWLO + depositAmount;

    const paymentPayload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.DISTRIBUTOR_WALLET,
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: String(totalPayment)
        }
      },
      custom_meta: {
        identifier: `MINT:${tweetId}:${depositAmount}`,
        instruction: `Pay ${totalPayment.toLocaleString()} WALDO to mint your meme NFT (${nftCfg.mintCostWLO} fee + ${depositAmount.toLocaleString()} deposit).`
      }
    };

    const { created } = await xummClient.payload.createAndSubscribe(paymentPayload, (event) => {
      return event.data.signed === true;
    });

    // Store pending mint with deposit info
    await redis.set(`meme:mint_pending:${tweetId}`, JSON.stringify({
      uuid: created.uuid,
      wallet,
      deposit: depositAmount,
      mintFee: nftCfg.mintCostWLO,
      totalPaid: totalPayment,
      createdAt: Date.now()
    }), { EX: 900 }); // ⏱️ TTL 15 mins

    return res.json({
      success: true,
      uuid: created.uuid,
      qr: created.refs.qr_png,
      redirect: created.next.always,
      deposit: depositAmount,
      mintFee: nftCfg.mintCostWLO,
      totalPayment
    });

  } catch (err) {
    console.error("❌ Mint route error:", err);
    return res.status(500).json({ success: false, error: "Internal mint error." });
  }
});

// GET /api/mint/config - Get NFT deposit configuration
router.get("/config", async (req, res) => {
  try {
    const { getNftConfig } = await import("../utils/config.js");
    const nftCfg = await getNftConfig();

    res.json({
      success: true,
      deposit: NFT_DEPOSIT,
      mintFee: nftCfg.mintCostWLO
    });
  } catch (err) {
    console.error("❌ Mint config error:", err);
    res.status(500).json({ success: false, error: "Failed to get mint config." });
  }
});

export default router;


