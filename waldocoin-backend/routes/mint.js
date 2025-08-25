import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import { fileURLToPath } from "url";
import path from "path";
import { xummClient } from "../utils/xummClient.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const router = express.Router();

// 🧠 Start NFT Mint Payment Flow
router.post("/", async (req, res) => {
  try {
    const { tweetId, wallet } = req.body;

    if (!tweetId || !wallet) {
      return res.status(400).json({ success: false, error: "Missing tweetId or wallet." });
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

    // NFT mint cost from config
    const { getNftConfig } = await import("../utils/config.js");
    const nftCfg = await getNftConfig();

    const paymentPayload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.DISTRIBUTOR_WALLET,
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: String(nftCfg.mintCostWLO)
        }
      },
      custom_meta: {
        identifier: `MINT:${tweetId}`,
        instruction: `Pay ${nftCfg.mintCostWLO} WALDO to mint your meme NFT.`
      }
    };

    const { created } = await xummClient.payload.createAndSubscribe(paymentPayload, (event) => {
      return event.data.signed === true;
    });

    await redis.set(`meme:mint_pending:${tweetId}`, created.uuid, { EX: 900 }); // ⏱️ TTL 15 mins

    return res.json({
      success: true,
      uuid: created.uuid,
      qr: created.refs.qr_png,
      redirect: created.next.always
    });

  } catch (err) {
    console.error("❌ Mint route error:", err);
    return res.status(500).json({ success: false, error: "Internal mint error." });
  }
});

export default router;


