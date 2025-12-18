import express from "express";
import dotenv from "dotenv";

import xrpl from "xrpl";
import { redis } from "../../redisClient.js";
import { uploadToIPFS } from "../../utils/ipfsUploader.js";
import { getXrplClient } from "../../utils/xrplClient.js"; // Optional: If you’re centralizing XRPL connections
import { xummClient } from "../../utils/xummClient.js";

dotenv.config();

const router = express.Router();

// 🎯 Confirm NFT Mint After WALDO Payment
router.post("/", async (req, res) => {
  const { tweetId, wallet } = req.body;

  if (typeof tweetId !== "string" || typeof wallet !== "string") {
    return res.status(400).json({ success: false, error: "Missing or invalid tweetId or wallet." });
  }

  try {
    const mintPendingRaw = await redis.get(`meme:mint_pending:${tweetId}`);
    if (!mintPendingRaw) {
      return res.status(403).json({ success: false, error: "No pending mint found or session expired." });
    }

    // Parse pending mint data (now includes deposit info)
    let mintData;
    try {
      mintData = JSON.parse(mintPendingRaw);
    } catch (e) {
      // Legacy format - just the UUID string
      mintData = { uuid: mintPendingRaw, deposit: 0 };
    }

    const mintUuid = mintData.uuid;
    const depositAmount = mintData.deposit ?? 0; // Use nullish coalescing to allow 0

    // ✅ Verify XUMM payload was signed and corresponds to the mint payment
    const payload = await xummClient.payload.get(mintUuid);
    if (!payload || !payload.meta || payload.meta.signed !== true) {
      return res.status(402).json({ success: false, error: "Payment not confirmed via XUMM" });
    }

    // Optional: Verify XRPL transaction details if available
    try {
      const txid = payload?.response?.txid || payload?.response?.hex || null;
      if (txid) {
        const xrplClient = await getXrplClient();
        const txResp = await xrplClient.request({ command: "tx", transaction: txid });
        const tx = txResp.result;
        if (tx.TransactionType !== "Payment" || tx.meta?.TransactionResult !== "tesSUCCESS") {
          return res.status(400).json({ success: false, error: "Invalid payment transaction" });
        }
        // Validate payment details (50 WALDO to distributor from the signer)
        const amount = tx.Amount;
        const dest = tx.Destination;
        const issuer = amount?.issuer || amount?.value?.issuer;
        const currency = amount?.currency || amount?.value?.currency;
        const value = parseFloat(amount?.value || 0);
        if (!(currency === "WLO" && issuer === process.env.WALDO_ISSUER && dest === process.env.DISTRIBUTOR_WALLET && value >= 50)) {
          return res.status(400).json({ success: false, error: "Payment details do not match mint requirements" });
        }
      }
    } catch (e) {
      // If XRPL tx lookup fails, still require payload signed; log the incident
      console.warn("⚠️ XRPL tx verification skipped:", e?.message || e);
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

    const client = new xrpl.Client("wss://xrplcluster.com"); // ⛓ XRPL Mainnet
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

    // ✅ Mark NFT as minted with deposit info and clean up pending status
    const nftData = {
      txHash: result.result.hash,
      wallet,
      tweetId,
      deposit: depositAmount,
      mintedAt: Date.now()
    };
    await redis.set(`meme:nft_minted:${tweetId}`, JSON.stringify(nftData));
    await redis.del(`meme:mint_pending:${tweetId}`);

    // Store deposit/base value for the NFT (for marketplace reference)
    await redis.set(`nft:deposit:${tweetId}`, depositAmount);

    console.log(`🖼️ NFT minted: ${tweetId} with ${depositAmount.toLocaleString()} WLO deposit`);

    return res.json({
      success: true,
      txHash: result.result.hash,
      metadataUrl,
      deposit: depositAmount
    });

  } catch (err) {
    console.error("❌ Mint confirm route error:", err);
    return res.status(500).json({ success: false, error: "Internal error during mint confirmation." });
  }
});

export default router;
