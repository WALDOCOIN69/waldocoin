import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import xrpl from "xrpl";
import { uploadToIPFS } from "../utils/ipfsUploader.js";

const { Wallet, Client, NFTokenMint } = xrpl;

dotenv.config();
const router = express.Router();

router.post("/", async (req, res) => {
  const { tweetId, wallet } = req.body;
  if (!tweetId || !wallet) {
    return res.status(400).json({ success: false, error: "Missing tweetId or wallet." });
  }

  try {
    const imgUrl = `https://waldocoin.live/images/memes/${tweetId}.jpg`; // update as needed
    const metadata = {
      name: `WALDO Meme #${tweetId}`,
      image: imgUrl,
      description: "Meme minted on XRPL using WALDOcoin"
    };

    const ipfsUri = await uploadToIPFS(metadata);

    const client = new Client("wss://s1.ripple.com");
    await client.connect();

    const walletObj = Wallet.fromSeed(process.env.DISTRIBUTOR_SECRET);

    const tx = {
      TransactionType: "NFTokenMint",
      Account: walletObj.classicAddress,
      URI: Buffer.from(ipfsUri).toString("hex").toUpperCase(),
      Flags: 8,
      TransferFee: 0,
      NFTokenTaxon: 0
    };

    const prepared = await client.autofill(tx);
    const signed = walletObj.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    await redis.set(`meme:nft_minted:${tweetId}`, "true");

    res.json({
      success: true,
      txHash: result.result.hash,
      ipfs: ipfsUri
    });
  } catch (err) {
    console.error("❌ Confirm Mint Error:", err);
    res.status(500).json({ success: false, error: "Mint confirmation failed" });
  }
});

export default router;
