// routes/presale.js
import express from "express";
import { redis } from "../redisClient.js";

const router = express.Router();

// ✅ WALDO Presale Bonus Calculation - Updated Structure (1 XRP = 10,000 WALDO)
function calculateWaldoBonus(xrpAmount) {
  const baseWaldo = xrpAmount * 10000; // 1 XRP = 10,000 WALDO base rate

  let bonus = 0;
  let bonusTier = null;
  let bonusPercentage = 0;

  if (xrpAmount >= 100) {
    bonus = 300000; // 300k bonus (30% of 1M base)
    bonusTier = "Tier 3 (100+ XRP)";
    bonusPercentage = 30;
  } else if (xrpAmount >= 90) {
    bonus = 198000; // 198k bonus (22% of 900k base)
    bonusTier = "Tier 2 (90+ XRP)";
    bonusPercentage = 22;
  } else if (xrpAmount >= 80) {
    bonus = 120000; // 120k bonus (15% of 800k base)
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

// ✅ GET /api/presale/total-sold - Get total presale statistics
router.get("/total-sold", async (req, res) => {
  try {
    // Get all presale purchases from Redis
    const presaleKey = "presale:purchases";
    const purchases = await redis.lRange(presaleKey, 0, -1);

    let totalXRP = 0;
    let totalWALDO = 0;
    let totalPurchases = 0;

    // Calculate totals from stored purchases
    purchases.forEach(purchaseStr => {
      try {
        const purchase = JSON.parse(purchaseStr);
        totalXRP += purchase.amount || 0;
        totalWALDO += purchase.waldoAmount || 0;
        totalPurchases++;
      } catch (error) {
        console.error('Error parsing purchase:', error);
      }
    });

    // Calculate progress towards goals
    const xrpGoal = 10000; // Example goal
    const waldoGoal = 100000000; // 100M WALDO goal
    const xrpProgress = Math.min((totalXRP / xrpGoal) * 100, 100);
    const waldoProgress = Math.min((totalWALDO / waldoGoal) * 100, 100);

    console.log(`📊 Presale stats: ${totalPurchases} purchases, ${totalXRP} XRP, ${totalWALDO} WALDO`);

    res.json({
      success: true,
      totalXRP: totalXRP,
      totalWALDO: totalWALDO,
      totalPurchases: totalPurchases,
      xrpGoal: xrpGoal,
      waldoGoal: waldoGoal,
      xrpProgress: Math.round(xrpProgress * 100) / 100,
      waldoProgress: Math.round(waldoProgress * 100) / 100,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting presale totals:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get presale statistics"
    });
  }
});

// ✅ POST /api/presale/buy - Create presale purchase transaction
router.post("/buy", async (req, res) => {
  try {
    const { wallet, xrpAmount } = req.body;

    if (!wallet || !xrpAmount) {
      return res.status(400).json({
        success: false,
        error: "Missing wallet or XRP amount"
      });
    }

    // Validate XRP amount (5 XRP increments, 5-100 range)
    if (xrpAmount < 5 || xrpAmount > 100 || xrpAmount % 5 !== 0) {
      return res.status(400).json({
        success: false,
        error: "XRP amount must be in 5 XRP increments (5-100)"
      });
    }

    // Calculate WALDO amount using the same logic as /calculate
    const calculation = calculateWaldoBonus(xrpAmount);

    // Create XUMM payload for presale purchase
    const payload = {
      TransactionType: 'Payment',
      Destination: 'rMJMw3i7W4dxTBkLKSnkNETCGPeons2MVt', // WALDO distributor wallet
      Amount: (xrpAmount * 1000000).toString(), // Convert XRP to drops
      Memos: [{
        Memo: {
          MemoType: Buffer.from('PRESALE').toString('hex').toUpperCase(),
          MemoData: Buffer.from(`${xrpAmount}XRP=${calculation.totalWaldo}WALDO`).toString('hex').toUpperCase()
        }
      }]
    };

    console.log(`🚀 Creating presale purchase: ${xrpAmount} XRP = ${calculation.totalWaldo} WALDO for ${wallet}`);

    // Create XUMM sign request
    const xummResponse = await fetch('https://xumm.app/api/v1/platform/payload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.XUMM_API_KEY,
        'X-API-Secret': process.env.XUMM_API_SECRET
      },
      body: JSON.stringify({
        txjson: payload,
        options: {
          submit: true,
          multisign: false,
          expire: 1440 // 24 hours
        }
      })
    });

    const xummData = await xummResponse.json();

    if (xummData.uuid) {
      res.json({
        success: true,
        qr: xummData.refs.qr_png,
        uuid: xummData.uuid,
        deeplink: xummData.next.always,
        calculation: calculation,
        message: `Purchase ${xrpAmount} XRP worth of WALDO (${calculation.totalWaldo} tokens)`
      });
    } else {
      throw new Error('Failed to create XUMM payload');
    }

  } catch (error) {
    console.error('❌ Presale buy error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to create presale purchase"
    });
  }
});

export default router;

