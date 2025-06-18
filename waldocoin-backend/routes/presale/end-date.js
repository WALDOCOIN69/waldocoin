// routes/presale/end-date.js
import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const endDate = await redis.get("presale:endDate");
    if (!endDate) return res.json({ endDate: null });
    res.json({ endDate });
  } catch (err) {
    console.error("❌ Error fetching presale end date:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
