// 📁 routes/presale.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js"; // ✅ Redis import added
import { patchRouter } from "../utils/patchRouter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
// patchRouter(router, path.basename(__filename)); // ✅ Route validator added

// 🔍 GET /end-date — Current presale end date
router.get("/end-date", async (req, res) => {
  try {
    const storedDate = await redis.get("presaleEndDate");
    return res.json({ endDate: storedDate || null });
  } catch (err) {
    console.error("❌ Error fetching presale end date:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// 📝 POST /end-date — Update presale end date
router.post("/end-date", async (req, res) => {
  const { endDate } = req.body;

  if (!endDate) {
    return res.status(400).json({ success: false, error: "Missing endDate" });
  }

  try {
    await redis.set("presaleEndDate", endDate);
    console.log(`✅ Presale end date updated: ${endDate}`);
    return res.json({ success: true, endDate });
  } catch (err) {
    console.error("❌ Error setting presale end date:", err);
    return res.status(500).json({ success: false, error: "Failed to update end date" });
  }
});

// 🧾 Optional: Log presale purchase for internal tracking
export function logPresalePurchase(wallet, xrpAmount, waldoAmount, bonusPercent) {
  console.log(`🧾 PRESALE LOG: ${wallet} sent ${xrpAmount} XRP → received ${waldoAmount} WALDO (Bonus: ${bonusPercent}%)`);
  // Optional: Save to Redis or DB if needed
}

export default router;
