// routes/presale/set-end-date.js
import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const { newDate } = req.body;
    if (!newDate) {
      return res.status(400).json({ error: "Missing newDate" });
    }

    await redis.set("presale:endDate", newDate);
    res.json({ success: true, message: `Countdown updated to ${newDate}` });
  } catch (err) {
    console.error("❌ Error setting presale end date:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
