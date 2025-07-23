// routes/presale.js
import express from "express";
import { redis } from "../redisClient.js";

const router = express.Router();

// ✅ WALDO Presale Bonus Calculation - Updated Structure (1 XRP = 1,000 WALDO)
function calculateWaldoBonus(xrpAmount) {
  const baseWaldo = xrpAmount * 1000; // 1 XRP = 1,000 WALDO base rate

  let bonus = 0;
  let bonusTier = null;
  let bonusPercentage = 0;

  if (xrpAmount >= 100) {
    bonus = 30000; // 30k bonus (30% of 100k base)
    bonusTier = "Tier 3 (100+ XRP)";
    bonusPercentage = 30;
  } else if (xrpAmount >= 90) {
    bonus = 20000; // 20k bonus (22% of 90k base)
    bonusTier = "Tier 2 (90+ XRP)";
    bonusPercentage = 22;
  } else if (xrpAmount >= 80) {
    bonus = 12000; // 12k bonus (15% of 80k base)
    bonusTier = "Tier 1 (80+ XRP)";
    bonusPercentage = 15;
  }

  const totalWaldo = baseWaldo + bonus;

  return {
    baseWaldo,
    bonus,
    totalWaldo,
    bonusTier,
    bonusPercentage
  };
}

// 🛡️ Admin key check middleware
function adminCheck(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (key !== "waldogod2025") return res.status(401).json({ success: false, error: "Unauthorized" });
  next();
}

// ✅ GET /api/presale — Return presale buyers from Redis
router.get("/", async (req, res) => {
  try {
    const raw = await redis.get("presale:buyers");
    const buyers = raw ? JSON.parse(raw) : [];
    res.json(buyers);
  } catch (err) {
    console.error("❌ Failed to load presale buyers:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/presale/airdrops — Return airdrop history
router.get("/airdrops", async (req, res) => {
  try {
    const raw = await redis.get("presale:airdrops");
    const drops = raw ? JSON.parse(raw) : [];
    res.json(drops);
  } catch (err) {
    console.error("❌ Failed to load airdrop history:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/presale/countdown — Return presale end date
router.get("/countdown", async (req, res) => {
  try {
    const endDate = await redis.get("presale:endDate");
    res.json({ endDate });
  } catch (err) {
    console.error("❌ Failed to load countdown:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/presale/calculate — Calculate WALDO bonus for XRP amount
router.get("/calculate", async (req, res) => {
  const xrpAmount = parseFloat(req.query.amount);

  if (!xrpAmount || xrpAmount <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid XRP amount. Must be a positive number."
    });
  }

  try {
    const calculation = calculateWaldoBonus(xrpAmount);

    res.json({
      success: true,
      xrpAmount: xrpAmount,
      calculation: {
        baseWaldo: calculation.baseWaldo,
        bonus: calculation.bonus,
        totalWaldo: calculation.totalWaldo,
        bonusTier: calculation.bonusTier,
        bonusPercentage: calculation.bonusPercentage
      }
    });
  } catch (err) {
    console.error("❌ Failed to calculate bonus:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ✅ POST /api/presale/set-end-date — Set presale end date
router.post("/set-end-date", adminCheck, async (req, res) => {
  const { newDate } = req.body;
  if (!newDate || isNaN(new Date(newDate))) {
    return res.status(400).json({ success: false, error: "Invalid date" });
  }

  try {
    await redis.set("presale:endDate", newDate);
    res.json({ success: true, endDate: newDate });
  } catch (err) {
    console.error("❌ Failed to update countdown:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ✅ POST /api/presale/log — Add a new presale buyer to Redis with auto bonus calculation
router.post("/log", async (req, res) => {
  const { wallet, amount, tokens, email, timestamp, bonusTier } = req.body;

  if (!wallet || !amount || !timestamp) {
    return res.status(400).json({ success: false, error: "Missing required fields: wallet, amount, timestamp" });
  }

  try {
    const raw = await redis.get("presale:buyers");
    const buyers = raw ? JSON.parse(raw) : [];

    const alreadyExists = buyers.some(
      b => b.wallet === wallet && b.timestamp === timestamp
    );

    if (alreadyExists) {
      return res.status(400).json({ success: false, error: "Already logged" });
    }

    // Auto-calculate bonus based on XRP amount
    const xrpAmount = parseFloat(amount);
    const calculation = calculateWaldoBonus(xrpAmount);

    const newBuyer = {
      wallet,
      amount: xrpAmount,
      tokens: tokens || calculation.totalWaldo, // Use provided tokens or calculated total
      baseWaldo: calculation.baseWaldo,
      bonus: calculation.bonus,
      totalWaldo: calculation.totalWaldo,
      bonusTier: bonusTier || calculation.bonusTier,
      bonusPercentage: calculation.bonusPercentage,
      email: email || null,
      timestamp,
    };

    buyers.push(newBuyer);
    await redis.set("presale:buyers", JSON.stringify(buyers));

    console.log(`✅ Presale logged: ${wallet} - ${xrpAmount} XRP = ${calculation.totalWaldo.toLocaleString()} WALDO (${calculation.bonusTier || 'No bonus'})`);

    res.json({
      success: true,
      buyer: newBuyer,
      calculation: {
        baseWaldo: calculation.baseWaldo,
        bonus: calculation.bonus,
        totalWaldo: calculation.totalWaldo,
        bonusTier: calculation.bonusTier,
        bonusPercentage: calculation.bonusPercentage
      }
    });
  } catch (err) {
    console.error("❌ Failed to log presale buyer:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;

