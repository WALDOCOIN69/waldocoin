// 📁 routes/mint/confirm.js

import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import xrpl from "xrpl";
import { redis } from "../../redisClient.js";
import { uploadToIPFS } from "../../utils/ipfsUploader.js";
import { xummClient } from "../../utils/xummClient.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 🎯 Confirm NFT Mint After WALDO Payment
router.post("/", async (req, res) => {
  const { tweetId, wallet } = req.body;

  if (typeof tweetId !== "string" || typeof wallet !== "string") {
    return res.status(400).json({ success: false, error: "Missing or invalid tweetId or wallet." });
  }

  try {
    const mintUuid = await redis.get(`meme:mint_pending:${tweetId}`);
    if (!mintUuid) {
      return res.status(403).json({ success: false, error: "No pending mint found or session expired." });
    }

    // 🖼 Upload meme metadata to IPFS
    const metadataUrl = await uploadToIPFS({
      tweetId,
      wallet,
      description: `WALDO Meme NFT - Verified via XP system`,
      image: `https://waldocoin.live/wp-content/uploads/memes/${tweetId}.jpg`
    });

    if (!metadataUrl) {
      return res.status(500).json({ success: false, error: "Failed to upload metadata to IPFS." });
    }

    const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233"); // XRPL Testnet
    await client.connect();

    const walletInstance = xrpl.Wallet.fromSeed(process.env.MINTING_WALLET_SECRET);

    const tx = {
      TransactionType: "NFTokenMint",
      Account: walletInstance.classicAddress,
      URI: xrpl.convertStringToHex(metadataUrl),
      Flags: 8,
      NFTokenTaxon: 0
    };

    const prepared = await client.autofill(tx);
    const signed = walletInstance.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    await client.disconnect();

    if (result.result.engine_result !== "tesSUCCESS") {
      return res.status(500).json({
        success: false,
        error: "XRPL mint failed",
        detail: result.result.engine_result_message || result.result
      });
    }

    // ✅ Mark NFT as minted and clean up pending status
    await redis.set(`meme:nft_minted:${tweetId}`, result.result.hash);
    await redis.del(`meme:mint_pending:${tweetId}`);

    return res.json({
      success: true,
      txHash: result.result.hash,
      metadataUrl
    });

  } catch (err) {
    console.error("❌ Mint confirm route error:", err);
    return res.status(500).json({ success: false, error: "Internal error during mint confirmation." });
  }
});

export default router;
