// routes/mintConfirm.js
import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import xrpl from "xrpl";
import { uploadToIPFS } from "../utils/ipfsUploader.js";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router to catch malformed routes
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string" && /:[^\/]+:/.test(path)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path}`);
      }
      return original.call(this, path, ...handlers);
    };
  }
};

dotenv.config();
const router = express.Router();
patchRouter(router, path.basename(__filename));

router.post("/", async (req, res) => {
  const { tweetId, wallet } = req.body;

  if (!tweetId || !wallet) {
    return res.status(400).json({ success: false, error: "Missing tweetId or wallet." });
  }

  try {
    // ⏳ Check for pending mint UUID
    const mintUuid = await redis.get(`meme:mint_pending:${tweetId}`);
    if (!mintUuid) {
      return res.status(403).json({ success: false, error: "No pending mint found or expired." });
    }

    // 🚀 Upload metadata to IPFS
    const metadataUrl = await uploadToIPFS({
      tweetId,
      wallet,
      description: `WALDO Meme NFT - Verified via XP system`,
      image: `https://waldocoin.live/wp-content/uploads/memes/${tweetId}.jpg`
    });

    if (!metadataUrl) {
      return res.status(500).json({ success: false, error: "Failed to upload metadata to IPFS." });
    }

    // 🔐 Connect to XRPL
    const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
    await client.connect();

    const walletInstance = xrpl.Wallet.fromSeed(process.env.MINTING_WALLET_SECRET);

    // 🪙 Prepare NFTokenMint transaction
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
      return res.status(500).json({ success: false, error: "XRPL mint failed", detail: result.result });
    }

    // ✅ Update Redis
    await redis.set(`meme:nft_minted:${tweetId}`, result.result.hash);
    await redis.del(`meme:mint_pending:${tweetId}`);

    res.json({
      success: true,
      txHash: result.result.hash,
      metadataUrl
    });
  } catch (err) {
    console.error("❌ NFT mint confirm error:", err);
    res.status(500).json({ success: false, error: "Internal error during mint confirmation." });
  }
});

export default router;
