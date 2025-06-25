// routes/presale.js
import express from "express";
import { redis } from "../redisClient.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

// ✅ GET /api/presale/countdown — Return presale end date
router.get("/countdown", async (req, res) => {
  try {
    const endDate = await redis.get("presale:endDate");
    res.json({ endDate: endDate || null });
  } catch (err) {
    console.error("❌ Failed to load countdown:", err);
    res.status(500).json({ error: "Failed to load countdown" });
  }
});

// ✅ POST /api/presale/set-end-date — Admin sets end date
router.post("/set-end-date", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid admin key" });
  }

  const { newDate } = req.body;
  if (!newDate || isNaN(Date.parse(newDate))) {
    return res.status(400).json({ error: "Invalid or missing date" });
  }

  try {
    await redis.set("presale:endDate", newDate);
    res.json({ success: true, endDate: newDate });
  } catch (err) {
    console.error("❌ Failed to set countdown:", err);
    res.status(500).json({ error: "Failed to set countdown" });
  }
});

// ✅ GET /api/presale — List all buyers (from Redis hash)
router.get("/", async (req, res) => {
  try {
    const buyers = await redis.hGetAll("presale:buyers");
    const parsed = Object.entries(buyers).map(([wallet, data]) => ({
      wallet,
      ...JSON.parse(data),
    }));
    res.json(parsed);
  } catch (err) {
    console.error("❌ Failed to load buyers:", err);
    res.status(500).json({ error: "Failed to load buyers" });
  }
});

// ✅ GET /api/presale/airdrops — Get airdrop history
router.get("/airdrops", async (req, res) => {
  try {
    const logs = await redis.lRange("presale:airdrops", 0, -1);
    const parsed = logs.map((item) => JSON.parse(item));
    res.json(parsed);
  } catch (err) {
    console.error("❌ Failed to load airdrops:", err);
    res.status(500).json({ error: "Failed to load airdrop history" });
  }
});

// ✅ POST /api/presale/log — Log successful airdrop (from autodistribute.js)
router.post("/log", async (req, res) => {
  const { wallet, amount, txHash, bonus, timestamp } = req.body;
  const txKey = `presale:tx:${txHash}`;

  if (!wallet || !amount || !txHash) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const alreadyProcessed = await redis.exists(txKey);
    if (alreadyProcessed) {
      return res.status(409).json({ error: "Duplicate transaction" });
    }

    // Save TX as processed (TTL 60 days)
    await redis.set(txKey, "true", { EX: 86400 * 60 });

    // Save buyer info
    const buyerData = {
      total: parseFloat(amount),
      bonus: parseFloat(bonus || 0),
      updated: timestamp || Date.now(),
    };

    // Merge if buyer exists
    const existing = await redis.hGet("presale:buyers", wallet);
    if (existing) {
      const parsed = JSON.parse(existing);
      buyerData.total += parsed.total || 0;
      buyerData.bonus += parsed.bonus || 0;
    }

    await redis.hSet("presale:buyers", wallet, JSON.stringify(buyerData));

    // Log in airdrop history list
    const logEntry = { wallet, amount, bonus, txHash, timestamp: Date.now() };
    await redis.lPush("presale:airdrops", JSON.stringify(logEntry));

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Presale log failed:", err);
    res.status(500).json({ error: "Presale log failed" });
  }
});

export default router;
