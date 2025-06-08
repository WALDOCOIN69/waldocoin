import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js";
import { redis } from "../redisClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 🛠️ Route registration guard
patchRouter(router, path.basename(__filename));

// ✅ GET current presale end date
router.get("/end-date", async (req, res) => {
  try {
    const storedDate = await redis.get("presaleEndDate");

    if (!storedDate) {
      return res.json({ endDate: null });
    }

    res.json({ endDate: storedDate });
  } catch (err) {
    console.error("❌ Error fetching presale end date:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ✅ POST to set a new presale end date
router.post("/end-date", async (req, res) => {
  try {
    const { endDate } = req.body;

    if (!endDate) {
      return res.status(400).json({ success: false, error: "Missing endDate" });
    }

    await redis.set("presaleEndDate", endDate);
    console.log(`✅ Presale end date updated: ${endDate}`);
    res.json({ success: true, endDate });
  } catch (err) {
    console.error("❌ Error setting presale end date:", err);
    res.status(500).json({ success: false, error: "Failed to update end date" });
  }
});

export default router;

