// routes/airdrop.js
import express from "express";
import xrpl from "xrpl";
import { redis } from "../redisClient.js";
import {
  WALDOCOIN_TOKEN,
  WALDO_ISSUER,
  WALDO_DISTRIBUTOR_SECRET
} from "../constants.js";

const router = express.Router();

// Airdrop configuration
const AIRDROP_LIMIT = 1000; // Maximum number of airdrops
const AIRDROP_AMOUNT = "50000.000000"; // Amount per airdrop
const AIRDROP_REDIS_KEY = "airdrop:wallets"; // Redis set to track claimed wallets
const AIRDROP_COUNT_KEY = "airdrop:count"; // Redis counter for total airdrops

router.post("/", async (req, res) => {
  const { wallet, password, amount, adminOverride, reason } = req.body;

  // Input validation
  if (!wallet || typeof wallet !== 'string' || !wallet.startsWith("r") || wallet.length < 25 || wallet.length > 34) {
    return res.status(400).json({ success: false, error: "Invalid wallet address format" });
  }

  // Admin override handling
  const isAdminOverride = adminOverride === true;
  let airdropAmount = AIRDROP_AMOUNT;

  if (isAdminOverride) {
    // Admin override - validate admin wallet and custom amount
    const adminWallet = req.headers['x-admin-wallet'];
    if (adminWallet !== "rMJMw3i7W4dxTBkLKSnkNETCGPeons2MVt") {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }

    if (!amount || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ success: false, error: "Admin amount must be between 1 and 1,000,000 WALDO" });
    }

    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ success: false, error: "Reason required for admin override" });
    }

    airdropAmount = amount.toString() + ".000000";
    console.log(`🚨 Admin override: ${amount} WALDO to ${wallet} - Reason: ${reason}`);

  } else {
    // Regular airdrop - validate password
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: "Password is required" });
    }

    // Get daily password from Redis override, otherwise use current default
    const redisPassword = await redis.get("airdrop:daily_password");
    const dailyPassword = redisPassword || "WALDOCREW";

    if (password !== dailyPassword) {
      return res.status(401).json({ success: false, error: "Invalid password" });
    }
  }

  try {
    // For regular airdrops, check limits and duplicates
    if (!isAdminOverride) {
      // Check if airdrop limit has been reached
      const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;
      if (parseInt(currentCount) >= AIRDROP_LIMIT) {
        return res.status(410).json({
          success: false,
          error: `Airdrop ended. Maximum ${AIRDROP_LIMIT} wallets have already claimed.`,
          totalClaimed: parseInt(currentCount)
        });
      }

      // Check if wallet has already claimed airdrop
      const hasAlreadyClaimed = await redis.sIsMember(AIRDROP_REDIS_KEY, wallet);
      if (hasAlreadyClaimed) {
        return res.status(409).json({
          success: false,
          error: "This wallet has already claimed the airdrop.",
          totalClaimed: parseInt(currentCount)
        });
      }
    }
    console.log("🐛 Airdrop POST called");
    console.log("🐛 wallet from body:", wallet);
    console.log("🐛 WALDOCOIN_TOKEN:", WALDOCOIN_TOKEN);
    console.log("🐛 WALDO_ISSUER:", WALDO_ISSUER);

    const sender = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
    console.log("🚨 Sender wallet:", sender.classicAddress);

    const client = new xrpl.Client("wss://xrplcluster.com");
    await client.connect();

    // 🔍 Check if the wallet is active
    try {
      await client.request({
        command: 'account_info',
        account: wallet
      });
    } catch (err) {
      if (err.data?.error === 'actNotFound') {
        await client.disconnect();
        return res.status(400).json({
          success: false,
          error: "Destination wallet is not activated. Must hold XRP first."
        });
      }
      throw err;
    }

    // 🔍 Check trustline
    const trustlines = await client.request({
      command: "account_lines",
      account: wallet
    });

    const hasTrustline = trustlines.result.lines.some(
      (line) =>
        String(line.currency).trim().toUpperCase() === String(WALDOCOIN_TOKEN).trim().toUpperCase() &&
        line.account === WALDO_ISSUER
    );

    if (!hasTrustline) {
      await client.disconnect();
      return res.status(400).json({ success: false, error: "❌ No WALDO trustline found" });
    }

    // ✅ Build and send TX
    const tx = {
      TransactionType: "Payment",
      Account: sender.classicAddress,
      Destination: wallet,
      Amount: {
        currency: WALDOCOIN_TOKEN.toUpperCase(),
        issuer: WALDO_ISSUER,
        value: airdropAmount
      }
    };

    const prepared = await client.autofill(tx);
    const signed = sender.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    await client.disconnect();

    if (result.result.meta.TransactionResult !== "tesSUCCESS") {
      console.error("❌ TX failed:", result.result.meta);
      return res.status(500).json({
        success: false,
        error: "Transaction failed",
        detail: result.result.meta.TransactionResult
      });
    }

    // ✅ Transaction successful - Track in Redis (only for regular airdrops)
    let newCount, remaining;

    if (!isAdminOverride) {
      await redis.sAdd(AIRDROP_REDIS_KEY, wallet); // Add wallet to claimed set
      newCount = await redis.incr(AIRDROP_COUNT_KEY); // Increment counter
      remaining = AIRDROP_LIMIT - newCount;
      console.log(`✅ Regular airdrop successful! Wallet ${wallet} claimed. Total: ${newCount}/${AIRDROP_LIMIT}`);
    } else {
      const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;
      newCount = parseInt(currentCount);
      remaining = AIRDROP_LIMIT - newCount;
      console.log(`✅ Admin override successful! Sent ${airdropAmount} WALDO to ${wallet}. Reason: ${reason}`);
    }

    return res.json({
      success: true,
      txHash: result.result.hash,
      amount: airdropAmount,
      totalClaimed: newCount,
      remaining: remaining,
      isAdminOverride: isAdminOverride
    });

  } catch (err) {
    console.error("❌ Airdrop error:", err);
    return res.status(500).json({ success: false, error: "Airdrop failed", detail: err.message });
  }
});

// GET /api/airdrop/status - Check airdrop status
router.get("/status", async (_, res) => {
  try {
    const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;
    const totalClaimed = parseInt(currentCount);
    const remaining = AIRDROP_LIMIT - totalClaimed;
    const isActive = remaining > 0;

    return res.json({
      success: true,
      airdrop: {
        isActive,
        totalLimit: AIRDROP_LIMIT,
        totalClaimed,
        remaining,
        amountPerClaim: AIRDROP_AMOUNT,
        status: isActive ? "ACTIVE" : "ENDED"
      }
    });
  } catch (err) {
    console.error("❌ Airdrop status error:", err);
    return res.status(500).json({ success: false, error: "Failed to get airdrop status" });
  }
});

// GET /api/airdrop/check/:wallet - Check if specific wallet has claimed
router.get("/check/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || !wallet.startsWith("r")) {
      return res.status(400).json({ success: false, error: "Invalid wallet address" });
    }

    const hasAlreadyClaimed = await redis.sIsMember(AIRDROP_REDIS_KEY, wallet);
    const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;

    return res.json({
      success: true,
      wallet,
      hasClaimed: hasAlreadyClaimed,
      totalClaimed: parseInt(currentCount),
      remaining: AIRDROP_LIMIT - parseInt(currentCount)
    });
  } catch (err) {
    console.error("❌ Airdrop check error:", err);
    return res.status(500).json({ success: false, error: "Failed to check wallet status" });
  }
});

// POST /api/airdrop/set-password - Admin endpoint to update daily password
router.post("/set-password", async (req, res) => {
  try {
    const { newPassword } = req.body;
    const adminKey = req.headers['x-admin-key'];

    // Validate admin access using X_ADMIN_KEY
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Handle clearing override (empty password)
    if (!newPassword || newPassword.trim() === '') {
      await redis.del("airdrop:daily_password");
      console.log(`🗑️ Daily airdrop password override cleared - now using X_ADMIN_KEY environment variable`);

      return res.json({
        success: true,
        message: "Password override cleared - now using default password",
        newPassword: "WALDOCREW"
      });
    }

    // Validate password
    if (typeof newPassword !== 'string' || newPassword.length < 3) {
      return res.status(400).json({ success: false, error: "Password must be at least 3 characters" });
    }

    // Store new password in Redis
    await redis.set("airdrop:daily_password", newPassword);

    console.log(`🔐 Daily airdrop password updated to: ${newPassword}`);

    return res.json({
      success: true,
      message: "Daily password updated successfully",
      newPassword: newPassword
    });

  } catch (err) {
    console.error("❌ Set password error:", err);
    return res.status(500).json({ success: false, error: "Failed to update password" });
  }
});

// GET /api/airdrop/current-password - Admin endpoint to check current password
router.get("/current-password", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Validate admin access using X_ADMIN_KEY
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get current password (same logic as main endpoint)
    const redisPassword = await redis.get("airdrop:daily_password");
    const currentPassword = redisPassword || "WALDOCREW";

    return res.json({
      success: true,
      currentPassword: currentPassword,
      source: redisPassword ? "redis (admin override)" : "default (WALDOCREW)"
    });

  } catch (err) {
    console.error("❌ Get password error:", err);
    return res.status(500).json({ success: false, error: "Failed to get current password" });
  }
});

// Admin login verification endpoint
router.get('/verify-admin', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.X_ADMIN_KEY || 'waldogod2025';

    if (!adminKey) {
      return res.status(401).json({ success: false, error: "Admin key required" });
    }

    if (adminKey === expectedKey) {
      return res.json({
        success: true,
        message: "Admin access verified",
        adminKey: adminKey
      });
    } else {
      return res.status(401).json({ success: false, error: "Invalid admin key" });
    }
  } catch (error) {
    console.error('Admin verification error:', error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// Debug endpoint to check environment variables
router.get('/debug-env', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Only allow if admin key matches
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    return res.json({
      success: true,
      environment: {
        X_ADMIN_KEY_SET: !!process.env.X_ADMIN_KEY,
        X_ADMIN_KEY_VALUE: process.env.X_ADMIN_KEY || 'NOT_SET',
        ADMIN_KEY_SET: !!process.env.ADMIN_KEY,
        NODE_ENV: process.env.NODE_ENV || 'NOT_SET'
      }
    });
  } catch (error) {
    console.error('Debug env error:', error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/airdrop/reset - Admin endpoint to reset airdrop system
router.post("/reset", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Validate admin access using X_ADMIN_KEY
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Reset airdrop data in Redis
    await redis.del("airdrop:count");        // Reset counter to 0
    await redis.del("airdrop:wallets");      // Clear claimed wallets set
    await redis.del("airdrop:daily_password"); // Clear password override (back to default)

    console.log("🔄 Airdrop system reset by admin");

    return res.json({
      success: true,
      message: "Airdrop system reset successfully",
      details: {
        counter: "Reset to 0",
        claimedWallets: "Cleared",
        passwordOverride: "Cleared (back to WALDOCREW default)",
        totalLimit: 1000
      }
    });

  } catch (error) {
    console.error("Error resetting airdrop:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to reset airdrop system"
    });
  }
});

// GET /api/airdrop/trustline-count - Get real-time WALDO trustline count from XRPL
router.get("/trustline-count", async (req, res) => {
  // Set a global timeout for the entire request
  const globalTimeout = setTimeout(() => {
    console.log('⏰ Global timeout reached, returning fallback data');
    if (!res.headersSent) {
      res.json({
        success: true,
        trustlineCount: 25,
        walletsWithBalance: 18,
        totalWaldoHeld: 1250000,
        source: "Fallback - XRPL timeout",
        timestamp: new Date().toISOString()
      });
    }
  }, 5000); // 5 second global timeout (more aggressive)

  try {
    console.log('🔍 Querying XRPL for real-time WLO trustline count...');

    // Try multiple XRPL servers for reliability
    const servers = [
      'https://xrplcluster.com',
      'https://s1.ripple.com:51234',
      'https://s2.ripple.com:51234'
    ];

    let response = null;
    let lastError = null;

    for (const server of servers) {
      try {
        console.log(`🔗 Trying XRPL server: ${server}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout (very aggressive)

        response = await fetch(server, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_lines',
            params: [{
              account: 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY', // WALDO issuer
              ledger_index: 'validated'
            }]
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`✅ Successfully connected to ${server}`);
          break; // Success, exit loop
        }
      } catch (serverError) {
        console.log(`❌ Failed to connect to ${server}:`, serverError.message);
        lastError = serverError;
        continue; // Try next server
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('All XRPL servers failed');
    }

    const data = await response.json();

    if (data.result && data.result.lines) {
      // Filter for WALDO trustlines - check both WLO and hex-encoded WALDO
      const wloTrustlines = data.result.lines.filter(line =>
        line.currency === 'WLO' ||
        line.currency === '57414C444F000000000000000000000000000000' || // WALDO in hex
        line.currency.toLowerCase().includes('waldo') ||
        line.currency.toLowerCase().includes('wlo')
      );

      console.log(`🔍 Found ${data.result.lines.length} total trustlines`);
      console.log(`🎯 WALDO/WLO trustlines: ${wloTrustlines.length}`);
      console.log(`📋 Sample currencies found:`, data.result.lines.slice(0, 5).map(line => line.currency));

      const trustlineCount = wloTrustlines.length;
      const walletsWithBalance = wloTrustlines.filter(line => parseFloat(line.balance || 0) > 0).length;
      const totalWaldoHeld = wloTrustlines.reduce((sum, line) => sum + parseFloat(line.balance || 0), 0);

      console.log(`✅ Real-time XRPL trustline data: ${trustlineCount} trustlines, ${walletsWithBalance} with balance, ${totalWaldoHeld.toFixed(2)} total WLO`);

      clearTimeout(globalTimeout);
      res.json({
        success: true,
        trustlineCount: trustlineCount,
        walletsWithBalance: walletsWithBalance,
        totalWaldoHeld: Math.round(totalWaldoHeld),
        source: "Real-time XRPL query",
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('⚠️ XRPL query failed, using fallback count');
      clearTimeout(globalTimeout);
      res.json({
        success: true,
        trustlineCount: 22,
        walletsWithBalance: 16,
        totalWaldoHeld: 1100000,
        source: "Fallback - XRPL query failed",
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ XRPL trustline query error:', error.message);
    clearTimeout(globalTimeout);
    res.json({
      success: true,
      trustlineCount: 23,
      walletsWithBalance: 17,
      totalWaldoHeld: 1150000,
      source: "Fallback - Error occurred",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ⚙️ Airdrop Configuration Management

// GET /api/airdrop/config - Get current airdrop configuration
router.get("/config", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get current configuration from Redis
    const maxWallets = await redis.get("airdrop:max_wallets") || 1000;
    const endDate = await redis.get("airdrop:end_date") || new Date(Date.now() + (5 * 24 * 60 * 60 * 1000)).toISOString();
    const claimed = await redis.get("airdrop:count") || 0;

    const startDate = await redis.get("airdrop:start_date") || new Date().toISOString();
    const durationDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));

    return res.json({
      success: true,
      config: {
        maxWallets: parseInt(maxWallets),
        claimed: parseInt(claimed),
        remaining: parseInt(maxWallets) - parseInt(claimed),
        startDate: startDate,
        endDate: endDate,
        durationDays: durationDays,
        isActive: parseInt(claimed) < parseInt(maxWallets) && new Date() < new Date(endDate)
      }
    });

  } catch (error) {
    console.error('❌ Error getting airdrop config:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get airdrop configuration"
    });
  }
});

// POST /api/airdrop/update-config - Update airdrop configuration
router.post("/update-config", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { maxWallets, durationDays, reason } = req.body;
    const changes = [];

    // Update max wallets if provided
    if (maxWallets && maxWallets !== undefined) {
      await redis.set("airdrop:max_wallets", maxWallets);
      changes.push(`Wallet limit: ${maxWallets}`);
    }

    // Update duration if provided
    if (durationDays && durationDays !== undefined) {
      const startDate = await redis.get("airdrop:start_date") || new Date().toISOString();
      const newEndDate = new Date(new Date(startDate).getTime() + (durationDays * 24 * 60 * 60 * 1000)).toISOString();
      await redis.set("airdrop:end_date", newEndDate);
      changes.push(`Duration: ${durationDays} days`);
    }

    // Log the configuration change
    const configChange = {
      timestamp: new Date().toISOString(),
      reason: reason || 'Configuration update',
      changes: changes,
      adminKey: adminKey.slice(-4) // Only store last 4 chars for security
    };

    await redis.lPush("airdrop:config_history", JSON.stringify(configChange));
    await redis.lTrim("airdrop:config_history", 0, 49); // Keep last 50 changes

    console.log(`⚙️ Airdrop config updated: ${changes.join(', ')} - Reason: ${reason}`);

    return res.json({
      success: true,
      changes: changes,
      message: `Configuration updated: ${changes.join(', ')}`
    });

  } catch (error) {
    console.error('❌ Error updating airdrop config:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to update airdrop configuration"
    });
  }
});

// POST /api/airdrop/reset-config - Reset to default configuration
router.post("/reset-config", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { reason } = req.body;

    // Reset to defaults
    await redis.set("airdrop:max_wallets", 1000);
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + (5 * 24 * 60 * 60 * 1000)).toISOString();
    await redis.set("airdrop:start_date", startDate);
    await redis.set("airdrop:end_date", endDate);

    // Log the reset
    const configChange = {
      timestamp: new Date().toISOString(),
      reason: reason || 'Reset to default configuration',
      changes: ['Wallet limit: 1000', 'Duration: 5 days'],
      adminKey: adminKey.slice(-4)
    };

    await redis.lPush("airdrop:config_history", JSON.stringify(configChange));

    console.log(`🔄 Airdrop config reset to defaults - Reason: ${reason}`);

    return res.json({
      success: true,
      message: "Configuration reset to defaults (1000 wallets, 5 days)"
    });

  } catch (error) {
    console.error('❌ Error resetting airdrop config:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to reset airdrop configuration"
    });
  }
});

// GET /api/airdrop/config-history - Get configuration change history
router.get("/config-history", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get configuration history
    const historyData = await redis.lRange("airdrop:config_history", 0, 19); // Last 20 changes
    const history = historyData.map(item => JSON.parse(item));

    return res.json({
      success: true,
      history: history,
      count: history.length
    });

  } catch (error) {
    console.error('❌ Error getting config history:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get configuration history"
    });
  }
});

export default router;



