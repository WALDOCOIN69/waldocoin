// 📁 routes/mint.js
import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ✅ Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router for malformed route patterns
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (routePath, ...handlers) {
      if (typeof routePath === "string" && /:[^\/]+:/.test(routePath)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${routePath}`);
        throw new Error(`❌ Invalid route pattern in ${file}: ${routePath}`);
      }
      return original.call(this, routePath, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

// 🧠 Start NFT Mint Payment Flow
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
          value: "50"
        }
      },
      custom_meta: {
        identifier: `MINT:${tweetId}`,
        instruction: "Pay 50 WALDO to mint your meme NFT."
      }
    };

    const { created } = await xumm.payload.createAndSubscribe(paymentPayload, (event) => {
      return event.data.signed === true;
    });

    await redis.set(`meme:mint_pending:${tweetId}`, created.uuid, { EX: 900 }); // TTL: 15 min

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

