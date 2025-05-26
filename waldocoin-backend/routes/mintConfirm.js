import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import { Wallet, Client, NFTokenMint } from "xrpl";
import { uploadToIPFS } from "../utils/ipfsUploader.js";

dotenv.config();
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { tweetId } = req.body;
    if (!tweetId) return res.status(400).json({ success: false, error: "Missing tweetId" });

    const uuid = await redis.get(`meme:mint_pending:${tweetId}`);
    if (!uuid) return res.status(404).json({ success: false, error: "No pending mint found." });

    const xummPkg = await import("xumm-sdk");
    const XummSdk = xummPkg.default || xummPkg;
    const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

    const result = await xumm.payload.get(uuid);
    if (result.meta.signed !== true)
      return res.status(403).json({ success: false, error: "XUMM payment not signed." });

    const xp = parseInt(await redis.get(`meme:xp:${tweetId}`)) || 0;
    if (xp < 60)
      return res.status(403).json({ success: false, error: "Meme not eligible for minting." });

    const alreadyMinted = await redis.get(`meme:nft_minted:${tweetId}`);
    if (alreadyMinted)
      return res.status(409).json({ success: false, error: "NFT already minted for this meme." });

    const meme = await redis.hgetall(`meme:${tweetId}`);
    if (!meme || !meme.image_url)
      return res.status(400).json({ success: false, error: "Missing meme image." });

    // 🧠 Upload image + metadata to IPFS
    const metadataURI = await uploadToIPFS(tweetId, meme.image_url, {
      name: `WaldoMeme #${tweetId}`,
      description: `Minted via WALDO. XP: ${meme.xp}`,
      attributes: [
        { trait_type: "XP", value: parseInt(meme.xp) },
        { trait_type: "Tier", value: parseInt(meme.tier) },
        { trait_type: "Likes", value: parseInt(meme.likes) },
        { trait_type: "Retweets", value: parseInt(meme.retweets) }
      ]
    });

    const client = new Client(process.env.XRPL_NODE);
    await client.connect();

    const wallet = Wallet.fromSeed(process.env.DISTRIBUTOR_SECRET);

    const mintTx = {
      TransactionType: "NFTokenMint",
      Account: wallet.classicAddress,
      URI: Buffer.from(metadataURI).toString("hex").toUpperCase(),
      Flags: 8,
      NFTokenTaxon: 0
    };

    const prepared = await client.autofill(mintTx);
    const signed = wallet.sign(prepared);
    const txResult = await client.submitAndWait(signed.tx_blob);

    await client.disconnect();

    if (txResult.result.meta.TransactionResult !== "tesSUCCESS")
      return res.status(500).json({ success: false, error: "NFT mint failed on XRPL." });

    await redis.set(`meme:nft_minted:${tweetId}`, 1);
    await redis.del(`meme:mint_pending:${tweetId}`);

    res.json({
      success: true,
      message: "NFT minted successfully!",
      txHash: txResult.result.hash
    });
  } catch (err) {
    console.error("❌ Mint Confirm Error:", err);
    res.status(500).json({ success: false, error: "NFT minting failed." });
  }
});

export default router;
