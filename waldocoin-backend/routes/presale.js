import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js";
import { redis } from "../redisClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
patchRouter(router, path.basename(__filename));

// ✅ GET the current presale end date
router.get("/end-date", async (req, res) => {
  try {
    const storedDate = await redis.get("presaleEndDate");
    res.json({ endDate: storedDate || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch end date" });
  }
});

// ✅ POST a new presale end date (admin only)
router.post("/end-date", express.json(), async (req, res) => {
  const { endDate } = req.body;
  if (!endDate) {
    return res.status(400).json({ error: "endDate is required" });
  }

  try {
    await redis.set("presaleEndDate", endDate);
    res.json({ success: true, endDate });
  } catch (err) {
    res.status(500).json({ error: "Failed to set end date" });
  }
});

export default router;

