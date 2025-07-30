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

    const alreadyMinted = await redis.get(`meme:nft_minted:${tweetId}`);

    if (alreadyMinted) {
      return res.status(409).json({ success: false, error: "NFT already minted for this meme." });
    }

    // Note: Whitepaper doesn't specify XP requirement for NFT minting, only 50 WALDO cost

    const paymentPayload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.DISTRIBUTOR_WALLET,
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: "50"
        }
      },
      custom_meta: {
        identifier: `MINT:${tweetId}`,
        instruction: "Pay 50 WALDO to mint your meme NFT."
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


