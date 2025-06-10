import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getXummClient } from "../utils/xummClient.js";
import { redis } from "../redisClient.js";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { patchRouter } from "../utils/patchRouter.js"; // ✅ Use shared validator

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
patchRouter(router, path.basename(__filename)); // ✅ Strict route check

console.log("🧩 Loaded: routes/claim.js");

router.post("/", async (req, res) => {
  const { wallet, stake, tier, memeId } = req.body;

  if (!wallet || !memeId || typeof tier !== "number") {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  const now = dayjs();
  const monthKey = now.format("YYYY-MM");
  const logKey = `rewards:${wallet}:${monthKey}:log`;
  const tierKey = `rewards:${wallet}:${monthKey}:tier:${tier}`;

  try {
    // 🚫 Monthly cap: max 10 rewards
    const logs = await redis.lRange(logKey, 0, -1);
    if (logs.length >= 10) {
      return res.status(403).json({ success: false, error: "Monthly reward limit reached" });
    }

    // ✅ Calculate reward
    const baseReward = [0, 100, 200, 300][tier] || 0;
    if (baseReward === 0) {
      return res.status(400).json({ success: false, error: "Invalid reward tier" });
    }

    const claimId = uuidv4();
    const feeRate = stake ? 0.05 : 0.10;
    const burnRate = 0.02;

    const gross = baseReward;
    const fee = Math.floor(gross * feeRate);
    const burn = Math.floor(fee * burnRate);
    const toXRP = fee - burn;
    const net = gross - fee;

    // 💾 Store log
    await redis.rPush(logKey, JSON.stringify({
      claimId,
      memeId,
      tier,
      stake,
      gross,
      fee,
      burn,
      toXRP,
      net,
      timestamp: now.toISOString()
    }));
    await redis.incr(tierKey);

    // 📝 XUMM payout
    const xumm = getXummClient();
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: wallet,
        Amount: String(net * 1_000_000), // XRP drops
        DestinationTag: 12345
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xumm.payload.createAndSubscribe(payload, event => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("❌ User rejected the sign request");
    });

    return res.json({
      success: true,
      uuid,
      net,
      fee,
      burn,
      toXRP,
      next
    });

  } catch (err) {
    console.error("❌ Claim processing error:", err);
    return res.status(500).json({ success: false, error: "XUMM claim failed", detail: err.message });
  }
});

export default router;

