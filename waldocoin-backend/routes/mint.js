import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router for malformed route detection
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
  try {
    const { tweetId, wallet } = req.body;
    if (!tweetId || !wallet) {
      return res.status(400).json({ success: false, error: "Missing tweetId or wallet." });
    }

    const xp = parseInt(await redis.get(`meme:xp:${tweetId}`)) || 0;
    const alreadyMinted = await redis.get(`meme:nft_minted:${tweetId}`);
    if (xp < 60) {
      return res.status(403).json({ success: false, error: "Meme not eligible for NFT. Requires 60+ XP." });
    }
    if (alreadyMinted) {
      return res.status(409).json({ success: false, error: "NFT already minted for this meme." });
    }

    const xummPkg = await import("xumm-sdk");
    const XummSdk = xummPkg.default || xummPkg;
    const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

    const paymentPayload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.DISTRIBUTOR_WALLET,
        Amount: {
          currency: "WALDO",
          issuer: process.env.WALDO_ISSUER,
          value: "50" // Mint fee
        }
      },
      custom_meta: {
        identifier: `MINT:${tweetId}`,
        instruction: "Pay 50 WALDO to mint your meme NFT.",
      }
    };

    const payload = await xumm.payload.createAndSubscribe(paymentPayload, event => {
      return event.data.signed === true;
    });

    // Store pending mint status with ref ID
    await redis.set(`meme:mint_pending:${tweetId}`, payload.created.uuid, "EX", 900); // expire in 15 min

    res.json({
      success: true,
      uuid: payload.created.uuid,
      qr: payload.created.refs.qr_png,
      redirect: payload.created.next.always
    });
  } catch (err) {
    console.error("❌ Mint error:", err);
    res.status(500).json({ success: false, error: "Internal mint error." });
  }
});

export default router;

