// routes/presale/countdown.js
import express from "express";
import { redis } from "../../utils/redisClient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const endDate = await redis.get("presale:end");
    if (!endDate) {
      return res.status(404).json({ error: "Presale end date not set." });
    }
    return res.json({ endDate });
  } catch (err) {
    console.error("Countdown fetch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
