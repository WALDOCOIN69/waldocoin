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

  // Calculate bonus as percentage of base amount
  if (xrpAmount >= 100) {
    bonusPercentage = 30;
    bonus = Math.floor(baseWaldo * 0.30); // 30% bonus
    bonusTier = "Tier 3 (100+ XRP)";
  } else if (xrpAmount >= 90) {
    bonusPercentage = 22;
    bonus = Math.floor(baseWaldo * 0.22); // 22% bonus
    bonusTier = "Tier 2 (90+ XRP)";
  } else if (xrpAmount >= 80) {
    bonusPercentage = 15;
    bonus = Math.floor(baseWaldo * 0.15); // 15% bonus
    bonusTier = "Tier 1 (80+ XRP)";
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

// ✅ GET /api/presale/countdown - Get presale countdown end date
router.get("/countdown", async (req, res) => {
  try {
    const endDate = await redis.get("presale:end_date");

    res.json({
      success: true,
      endDate: endDate || null,
      timeRemaining: endDate ? Math.max(0, new Date(endDate) - new Date()) : null
    });

  } catch (error) {
    console.error('❌ Error getting presale countdown:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get presale countdown"
    });
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
    const xrpGoal = 400000; // Example goal
    const waldoGoal = 40000000; // 40M WALDO goal
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
      Destination: DISTRIBUTOR_WALLET, // WALDO distributor wallet
      Amount: (xrpAmount * 1000000).toString(), // Convert XRP to drops
      Memos: [{
        Memo: {
          MemoType: Buffer.from('PRESALE').toString('hex').toUpperCase(),
          MemoData: Buffer.from(`${xrpAmount}XRP=${calculation.totalWaldo}WALDO`).toString('hex').toUpperCase()
        }
      }]
    };

    console.log(`🚀 Creating presale purchase: ${xrpAmount} XRP = ${calculation.totalWaldo} WALDO for ${wallet}`);

    // Create XUMM sign request with timeout (like airdrop)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

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
          submit: false, // Don't auto-submit, let user sign
          multisign: false,
          expire: 1440, // 24 hours
          return_url: {
            web: 'https://waldocoin.live/presale-success'
          }
        },
        custom_meta: {
          identifier: `presale-${Date.now()}`,
          blob: {
            wallet,
            xrpAmount,
            waldoAmount: calculation.totalWaldo,
            bonusPercentage: calculation.bonusPercentage
          }
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
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

// ✅ GET /api/presale/analytics - Comprehensive presale analytics for admin
router.get("/analytics", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get all presale purchases
    const purchaseKeys = await redis.keys("presale:purchase:*");
    const purchases = [];
    let totalXRP = 0;
    let totalWALDO = 0;
    let totalPurchases = 0;

    for (const key of purchaseKeys) {
      try {
        const purchaseData = await redis.hGetAll(key);
        if (purchaseData.xrpAmount) {
          const purchase = {
            wallet: purchaseData.wallet,
            xrpAmount: parseFloat(purchaseData.xrpAmount),
            waldoAmount: parseFloat(purchaseData.waldoAmount),
            timestamp: purchaseData.timestamp,
            txHash: purchaseData.txHash,
            bonusPercent: parseFloat(purchaseData.bonusPercent || 0)
          };

          purchases.push(purchase);
          totalXRP += purchase.xrpAmount;
          totalWALDO += purchase.waldoAmount;
          totalPurchases++;
        }
      } catch (error) {
        console.error(`Error processing purchase ${key}:`, error);
      }
    }

    // Calculate analytics
    const averageXRPPerPurchase = totalPurchases > 0 ? totalXRP / totalPurchases : 0;
    const averageWALDOPerPurchase = totalPurchases > 0 ? totalWALDO / totalPurchases : 0;

    // Time-based analytics
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let purchases24h = 0;
    let purchases7d = 0;
    let xrp24h = 0;
    let xrp7d = 0;

    purchases.forEach(purchase => {
      if (purchase.timestamp) {
        const purchaseTime = new Date(purchase.timestamp);
        if (purchaseTime > last24h) {
          purchases24h++;
          xrp24h += purchase.xrpAmount;
        }
        if (purchaseTime > last7d) {
          purchases7d++;
          xrp7d += purchase.xrpAmount;
        }
      }
    });

    // Bonus tier analysis
    const bonusTiers = {
      'no_bonus': purchases.filter(p => p.bonusPercent === 0).length,
      'tier_15': purchases.filter(p => p.bonusPercent === 15).length,
      'tier_22': purchases.filter(p => p.bonusPercent === 22).length,
      'tier_30': purchases.filter(p => p.bonusPercent === 30).length
    };

    // Top purchasers
    const walletTotals = {};
    purchases.forEach(purchase => {
      if (!walletTotals[purchase.wallet]) {
        walletTotals[purchase.wallet] = { xrp: 0, waldo: 0, count: 0 };
      }
      walletTotals[purchase.wallet].xrp += purchase.xrpAmount;
      walletTotals[purchase.wallet].waldo += purchase.waldoAmount;
      walletTotals[purchase.wallet].count++;
    });

    const topPurchasers = Object.entries(walletTotals)
      .sort(([, a], [, b]) => b.xrp - a.xrp)
      .slice(0, 10)
      .map(([wallet, data]) => ({
        wallet: `${wallet.slice(0, 8)}...${wallet.slice(-6)}`,
        xrpTotal: data.xrp,
        waldoTotal: data.waldo,
        purchaseCount: data.count
      }));

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      overview: {
        totalPurchases: totalPurchases,
        totalXRP: totalXRP,
        totalWALDO: totalWALDO,
        averageXRPPerPurchase: Math.round(averageXRPPerPurchase * 100) / 100,
        averageWALDOPerPurchase: Math.round(averageWALDOPerPurchase)
      },
      timeBasedMetrics: {
        purchases24h: purchases24h,
        purchases7d: purchases7d,
        xrp24h: xrp24h,
        xrp7d: xrp7d,
        dailyAverage: Math.round((purchases7d / 7) * 10) / 10,
        weeklyTrend: purchases7d > purchases24h * 7 ? 'increasing' : 'stable'
      },
      bonusAnalysis: bonusTiers,
      topPurchasers: topPurchasers,
      recentPurchases: purchases
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 20)
        .map(p => ({
          ...p,
          wallet: `${p.wallet.slice(0, 8)}...${p.wallet.slice(-6)}`
        }))
    });

  } catch (error) {
    console.error('❌ Error getting presale analytics:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get presale analytics"
    });
  }
});

// ✅ GET /api/presale/admin-summary - Quick presale summary for admin dashboard
router.get("/admin-summary", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get basic presale metrics
    const totalSold = await redis.get("presale:total_sold") || 0;
    const totalXRP = await redis.get("presale:total_xrp") || 0;
    const totalPurchases = await redis.get("presale:total_purchases") || 0;

    // Get recent activity (last 24h)
    const purchaseKeys = await redis.keys("presale:purchase:*");
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    let recentPurchases = 0;
    let recentXRP = 0;

    for (const key of purchaseKeys.slice(0, 50)) { // Check last 50 purchases
      try {
        const purchaseData = await redis.hGetAll(key);
        if (purchaseData.timestamp) {
          const purchaseTime = new Date(purchaseData.timestamp);
          if (purchaseTime > last24h) {
            recentPurchases++;
            recentXRP += parseFloat(purchaseData.xrpAmount || 0);
          }
        }
      } catch (error) {
        // Skip failed entries
      }
    }

    res.json({
      success: true,
      totalSold: parseInt(totalSold),
      totalXRP: parseFloat(totalXRP),
      totalPurchases: parseInt(totalPurchases),
      recentActivity: {
        purchases24h: recentPurchases,
        xrp24h: recentXRP
      },
      formatted: {
        totalSold: parseInt(totalSold).toLocaleString(),
        totalXRP: parseFloat(totalXRP).toLocaleString(),
        totalPurchases: parseInt(totalPurchases).toLocaleString()
      }
    });

  } catch (error) {
    console.error('❌ Error getting presale admin summary:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get presale admin summary"
    });
  }
});

// ✅ POST /api/presale/set-countdown - Set presale countdown end date (Admin only)
router.post("/set-countdown", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { endDate, action } = req.body;

    if (action === 'clear') {
      // Clear the countdown
      await redis.del("presale:end_date");

      // Log admin action
      await redis.lPush('admin_logs', JSON.stringify({
        action: 'presale_countdown_cleared',
        timestamp: new Date().toISOString(),
        ip: req.ip || 'unknown',
        details: 'Presale countdown cleared'
      }));

      res.json({
        success: true,
        message: "Presale countdown cleared",
        endDate: null
      });

    } else if (endDate) {
      // Validate the date
      const parsedDate = new Date(endDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format"
        });
      }

      // Check if date is in the future
      if (parsedDate <= new Date()) {
        return res.status(400).json({
          success: false,
          error: "End date must be in the future"
        });
      }

      // Set the countdown end date
      await redis.set("presale:end_date", parsedDate.toISOString());

      // Log admin action
      await redis.lPush('admin_logs', JSON.stringify({
        action: 'presale_countdown_set',
        timestamp: new Date().toISOString(),
        ip: req.ip || 'unknown',
        details: `Presale countdown set to: ${parsedDate.toISOString()}`
      }));

      res.json({
        success: true,
        message: "Presale countdown updated successfully",
        endDate: parsedDate.toISOString(),
        timeRemaining: Math.max(0, parsedDate - new Date())
      });

    } else {
      res.status(400).json({
        success: false,
        error: "Missing endDate or action parameter"
      });
    }

  } catch (error) {
    console.error('❌ Error setting presale countdown:', error);
    res.status(500).json({
      success: false,
      error: "Failed to set presale countdown"
    });
  }
});

// ✅ POST /api/presale/webhook - Handle XUMM webhook for completed transactions
router.post("/webhook", async (req, res) => {
  try {
    const { meta, txid, signed, user_token } = req.body;

    console.log('📥 Presale webhook received:', { meta, txid, signed });

    if (signed && txid && meta?.resolved_at) {
      // Transaction was signed and completed
      console.log('✅ Processing completed presale transaction:', txid);

      // Get transaction details from XRPL
      try {
        const txResponse = await fetch('https://s1.ripple.com:51234', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'tx',
            params: [{
              transaction: txid,
              binary: false
            }]
          })
        });

        const txData = await txResponse.json();

        if (txData.result && txData.result.TransactionType === 'Payment') {
          const transaction = txData.result;
          const fromWallet = transaction.Account;
          const toWallet = transaction.Destination;
          const xrpAmount = parseInt(transaction.Amount) / 1000000; // Convert drops to XRP

          // Verify this is a presale transaction to our distributor wallet
          if (toWallet === DISTRIBUTOR_WALLET) {
            console.log(`💰 Presale payment received: ${xrpAmount} XRP from ${fromWallet}`);

            // Calculate WALDO amount with bonus
            const calculation = calculateWaldoBonus(xrpAmount);

            // Send WALDO tokens to buyer
            await sendWaldoTokens(fromWallet, calculation.totalWaldo, calculation, txid);

            // Record the purchase
            await recordPresalePurchase(fromWallet, xrpAmount, calculation, txid);

            console.log(`✅ Presale completed: ${fromWallet} received ${calculation.totalWaldo} WALDO`);
          }
        }
      } catch (error) {
        console.error('❌ Error processing transaction:', error);
      }
    }

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Function to send WALDO tokens to buyer
async function sendWaldoTokens(buyerWallet, waldoAmount, calculation, originalTxId) {
  try {
    console.log(`🚀 Sending ${waldoAmount} WALDO to ${buyerWallet}`);

    // Create WALDO payment transaction
    const payload = {
      TransactionType: 'Payment',
      Account: DISTRIBUTOR_WALLET, // WALDO distributor wallet
      Destination: buyerWallet,
      Amount: {
        currency: 'WLO',
        issuer: 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY',
        value: waldoAmount.toString()
      },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('PRESALE_DELIVERY').toString('hex').toUpperCase(),
          MemoData: Buffer.from(`Base:${calculation.baseWaldo}+Bonus:${calculation.bonus}=${waldoAmount}WALDO`).toString('hex').toUpperCase()
        }
      }]
    };

    // Submit transaction using XUMM or direct XRPL submission
    // For now, we'll use XUMM to create and auto-submit
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
          expire: 60, // 1 hour
          return_url: {
            web: 'https://waldocoin.live/presale-success'
          }
        },
        custom_meta: {
          identifier: `presale-delivery-${originalTxId}`,
          blob: {
            buyerWallet,
            waldoAmount,
            originalTxId
          }
        }
      })
    });

    const xummData = await xummResponse.json();

    if (xummData.uuid) {
      console.log(`✅ WALDO delivery transaction created: ${xummData.uuid}`);

      // Store delivery transaction info
      await redis.hSet(`presale:delivery:${originalTxId}`, {
        buyerWallet,
        waldoAmount,
        deliveryUuid: xummData.uuid,
        status: 'pending',
        timestamp: new Date().toISOString()
      });

      return xummData.uuid;
    } else {
      throw new Error('Failed to create WALDO delivery transaction');
    }

  } catch (error) {
    console.error('❌ Error sending WALDO tokens:', error);

    // Store failed delivery for manual processing
    await redis.hSet(`presale:failed_delivery:${originalTxId}`, {
      buyerWallet,
      waldoAmount,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    throw error;
  }
}

// ✅ Function to record presale purchase
async function recordPresalePurchase(wallet, xrpAmount, calculation, txId) {
  try {
    // Store individual purchase record
    await redis.hSet(`presale:purchase:${txId}`, {
      wallet,
      xrpAmount,
      waldoAmount: calculation.totalWaldo,
      baseWaldo: calculation.baseWaldo,
      bonus: calculation.bonus,
      bonusPercentage: calculation.bonusPercentage,
      bonusTier: calculation.bonusTier || 'No Bonus',
      txHash: txId,
      timestamp: new Date().toISOString()
    });

    // Update totals
    await redis.incrByFloat('presale:total_xrp', xrpAmount);
    await redis.incrByFloat('presale:total_sold', calculation.totalWaldo);
    await redis.incr('presale:total_purchases');

    console.log(`📊 Recorded presale purchase: ${wallet} - ${xrpAmount} XRP = ${calculation.totalWaldo} WALDO`);

  } catch (error) {
    console.error('❌ Error recording purchase:', error);
  }
}

// ✅ GET /api/presale/failed-deliveries - Get failed WALDO deliveries (Admin only)
router.get("/failed-deliveries", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get all failed delivery keys
    const failedKeys = await redis.keys("presale:failed_delivery:*");
    const failedDeliveries = [];

    for (const key of failedKeys) {
      try {
        const deliveryData = await redis.hGetAll(key);
        if (deliveryData.buyerWallet) {
          failedDeliveries.push({
            txId: key.replace('presale:failed_delivery:', ''),
            ...deliveryData
          });
        }
      } catch (error) {
        console.error(`Error processing failed delivery ${key}:`, error);
      }
    }

    res.json({
      success: true,
      failedDeliveries: failedDeliveries,
      count: failedDeliveries.length
    });

  } catch (error) {
    console.error('❌ Error getting failed deliveries:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get failed deliveries"
    });
  }
});

// ✅ POST /api/presale/retry-delivery - Retry failed WALDO delivery (Admin only)
router.post("/retry-delivery", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { txId } = req.body;

    if (!txId) {
      return res.status(400).json({ success: false, error: "Missing transaction ID" });
    }

    // Get failed delivery data
    const failedData = await redis.hGetAll(`presale:failed_delivery:${txId}`);

    if (!failedData.buyerWallet) {
      return res.status(404).json({ success: false, error: "Failed delivery not found" });
    }

    // Retry the delivery
    const calculation = {
      baseWaldo: parseInt(failedData.waldoAmount) - (parseInt(failedData.bonus) || 0),
      bonus: parseInt(failedData.bonus) || 0,
      totalWaldo: parseInt(failedData.waldoAmount),
      bonusPercentage: parseInt(failedData.bonusPercentage) || 0
    };

    try {
      const deliveryUuid = await sendWaldoTokens(failedData.buyerWallet, failedData.waldoAmount, calculation, txId);

      // Remove from failed deliveries
      await redis.del(`presale:failed_delivery:${txId}`);

      // Log admin action
      await redis.lPush('admin_logs', JSON.stringify({
        action: 'presale_delivery_retry',
        timestamp: new Date().toISOString(),
        ip: req.ip || 'unknown',
        details: `Retried delivery for ${failedData.buyerWallet}: ${failedData.waldoAmount} WALDO`
      }));

      res.json({
        success: true,
        message: "Delivery retry initiated successfully",
        deliveryUuid: deliveryUuid
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: `Failed to retry delivery: ${error.message}`
      });
    }

  } catch (error) {
    console.error('❌ Error retrying delivery:', error);
    res.status(500).json({
      success: false,
      error: "Failed to retry delivery"
    });
  }
});

export default router;

