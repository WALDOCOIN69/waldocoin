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

  console.log(`🔍 Airdrop request received:`, {
    wallet: wallet ? `${wallet.slice(0,8)}...${wallet.slice(-6)}` : 'null',
    hasPassword: !!password,
    passwordLength: password ? password.length : 0,
    amount,
    adminOverride,
    hasReason: !!reason,
    userAgent: req.headers['user-agent']?.slice(0, 50)
  });

  // Input validation
  if (!wallet || typeof wallet !== 'string' || !wallet.startsWith("r") || wallet.length < 25 || wallet.length > 34) {
    console.log(`❌ Invalid wallet format:`, { wallet, type: typeof wallet, length: wallet?.length });
    return res.status(400).json({ success: false, error: "Invalid wallet address format" });
  }

  // Admin override handling
  const isAdminOverride = adminOverride === true;

  // Get dynamic airdrop amount from Redis
  const storedAmount = await redis.get("airdrop:amount");
  let airdropAmount = storedAmount || AIRDROP_AMOUNT;

  if (isAdminOverride) {
    // Admin override - validate admin wallet and custom amount
    const adminWallet = req.headers['x-admin-wallet'];
    if (adminWallet !== "rJGYLktGg1FgAa4t2yfA8tnyMUGsyxofUC") {
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
      console.log(`❌ Password validation failed:`, { password, type: typeof password });
      return res.status(400).json({ success: false, error: "Password is required" });
    }

    // Get daily password from Redis override, otherwise use current default
    const redisPassword = await redis.get("airdrop:daily_password");
    const dailyPassword = redisPassword || "WALDOCREW";

    console.log(`🔐 Password check: User entered "${password}", Expected "${dailyPassword}", Redis value: "${redisPassword}"`);

    if (password !== dailyPassword) {
      console.log(`❌ Password mismatch: "${password}" !== "${dailyPassword}"`);
      return res.status(401).json({ success: false, error: "Invalid password" });
    }

    console.log(`✅ Password accepted: "${password}"`);
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

    // 🔍 Check trustline (skip for admin overrides)
    if (!isAdminOverride) {
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
    } else {
      console.log("🚨 Admin override: Skipping trustline check");
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

    // ✅ Transaction successful - Track in Redis with amount details
    let newCount, remaining;

    // Store claim details with amount and timestamp
    const claimData = {
      wallet: wallet,
      amount: airdropAmount,
      timestamp: new Date().toISOString(),
      txHash: result.result.hash,
      type: isAdminOverride ? 'admin' : 'regular',
      reason: isAdminOverride ? reason : 'regular_claim'
    };

    // Store detailed claim data
    await redis.hSet(`airdrop:claim:${wallet}`, claimData);

    if (!isAdminOverride) {
      await redis.sAdd(AIRDROP_REDIS_KEY, wallet); // Add wallet to claimed set
      newCount = await redis.incr(AIRDROP_COUNT_KEY); // Increment counter
      remaining = AIRDROP_LIMIT - newCount;
      console.log(`✅ Regular airdrop successful! Wallet ${wallet} claimed ${airdropAmount} WALDO. Total: ${newCount}/${AIRDROP_LIMIT}`);
    } else {
      // Track manual airdrops too, but in a separate set for distinction
      await redis.sAdd("airdrop:manual_wallets", wallet); // Track manual airdrops separately
      await redis.sAdd(AIRDROP_REDIS_KEY, wallet); // Also add to main claimed set for export

      const currentCount = await redis.get(AIRDROP_COUNT_KEY) || 0;
      newCount = parseInt(currentCount);
      remaining = AIRDROP_LIMIT - newCount;
      console.log(`✅ Admin override successful! Sent ${airdropAmount} WALDO to ${wallet}. Reason: ${reason}. Added to tracking.`);
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

// POST /api/airdrop/update-password - Admin endpoint to update daily password (alias for set-password)
router.post("/update-password", async (req, res) => {
  try {
    const { password } = req.body;
    const adminKey = req.headers['x-admin-key'];

    // Validate admin access using X_ADMIN_KEY
    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Handle clearing override (empty password)
    if (!password || password.trim() === '') {
      await redis.del("airdrop:daily_password");
      console.log(`🗑️ Daily airdrop password override cleared - now using default`);

      return res.json({
        success: true,
        message: "Password override cleared - now using default password",
        newPassword: "WALDOCREW"
      });
    }

    // Validate password
    if (typeof password !== 'string' || password.length < 3) {
      return res.status(400).json({ success: false, error: "Password must be at least 3 characters" });
    }

    // Store new password in Redis
    await redis.set("airdrop:daily_password", password);

    console.log(`🔐 Daily airdrop password updated to: ${password}`);

    return res.json({
      success: true,
      message: "Daily password updated successfully",
      newPassword: password
    });

  } catch (err) {
    console.error("❌ Update password error:", err);
    return res.status(500).json({ success: false, error: "Failed to update password" });
  }
});

// GET /api/airdrop/current-password - Admin endpoint to check current password
router.get("/current-password", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Validate admin access using X_ADMIN_KEY (environment variable only)
    const expectedKey = process.env.X_ADMIN_KEY;

    console.log(`🔑 Password endpoint admin key debug: Received="${adminKey}", Expected="${expectedKey}"`);

    if (adminKey !== expectedKey) {
      console.log(`❌ Password endpoint admin key mismatch: "${adminKey}" !== "${expectedKey}"`);
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    console.log(`✅ Password endpoint admin key accepted: "${adminKey}"`);

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

// GET /api/airdrop/password-check - Public endpoint to check current password (no auth required)
router.get("/password-check", async (req, res) => {
  try {
    // Get current password (same logic as main endpoint)
    const redisPassword = await redis.get("airdrop:daily_password");
    const currentPassword = redisPassword || "WALDOCREW";

    console.log(`🔍 Public password check: Current password is "${currentPassword}"`);

    return res.json({
      success: true,
      currentPassword: currentPassword,
      source: redisPassword ? 'Redis override' : 'Default fallback',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Public password check error:", error);
    return res.status(500).json({ success: false, error: "Failed to get current password" });
  }
});

// Admin login verification endpoint
router.get('/verify-admin', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.X_ADMIN_KEY;

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

    // Only allow if admin key matches (environment variable only)
    const expectedKey = process.env.X_ADMIN_KEY;

    console.log(`🔑 Admin key debug: Received="${adminKey}", Expected="${expectedKey}", EnvVar="${process.env.X_ADMIN_KEY}"`);

    if (adminKey !== expectedKey) {
      console.log(`❌ Admin key mismatch: "${adminKey}" !== "${expectedKey}"`);
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    console.log(`✅ Admin key accepted: "${adminKey}"`);

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
    console.log('⏰ Global timeout reached, returning updated fallback data');
    if (!res.headersSent) {
      res.json({
        success: true,
        trustlineCount: 486, // Updated to current XRPL Services count
        walletsWithBalance: 420,
        totalWaldoHeld: 6500000,
        dexOffers: 30,
        source: "Updated fallback data (XRPL timeout)",
        timestamp: new Date().toISOString()
      });
    }
  }, 8000); // Reduced timeout to 8 seconds

  try {
    console.log('🔍 Querying XRPL for real-time WLO trustline count...');

    // Try multiple XRPL servers for reliability - Updated list
    const servers = [
      'https://xrplcluster.com',
      'https://xrpl.ws',
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
        } else {
          console.log(`❌ ${server} returned status:`, response.status, response.statusText);
        }
      } catch (serverError) {
        console.log(`❌ Failed to connect to ${server}:`, serverError.name, serverError.message);
        if (serverError.name === 'AbortError') {
          console.log(`⏰ ${server} timed out after 2 seconds`);
        }
        lastError = serverError;
        continue; // Try next server
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('All XRPL servers failed');
    }

    const data = await response.json();
    console.log(`📡 XRPL Response structure:`, {
      hasResult: !!data.result,
      hasLines: !!(data.result && data.result.lines),
      linesCount: data.result?.lines?.length || 0,
      error: data.error || null
    });

    if (data.result && data.result.lines) {
      console.log(`🔍 Found ${data.result.lines.length} total trustlines from issuer`);

      // Show first few currencies for debugging
      const sampleCurrencies = data.result.lines.slice(0, 10).map(line => ({
        currency: line.currency,
        balance: line.balance,
        account: line.account?.slice(0, 10) + '...'
      }));
      console.log(`📋 Sample trustlines:`, sampleCurrencies);

      // Filter for WLO trustlines only
      const wloTrustlines = data.result.lines.filter(line =>
        line.currency === 'WLO'
      );

      console.log(`🎯 WALDO/WLO trustlines found: ${wloTrustlines.length}`);

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
      console.log('⚠️ XRPL query failed, using updated fallback count');
      clearTimeout(globalTimeout);
      res.json({
        success: true,
        trustlineCount: 394,
        walletsWithBalance: 350,
        totalWaldoHeld: 5000000,
        dexOffers: 25,
        source: "Fallback data (XRPL failed)",
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ XRPL trustline query error:', error.message);
    clearTimeout(globalTimeout);
    res.json({
      success: true,
      trustlineCount: 394,
      walletsWithBalance: 350,
      totalWaldoHeld: 5000000,
      dexOffers: 25,
      source: "Fallback data (error)",
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

// ✅ GET /api/airdrop/export-claimed - Export claimed wallets to CSV
router.get("/export-claimed", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get all claimed wallets from Redis set
    const claimedWallets = await redis.sMembers(AIRDROP_REDIS_KEY);
    const manualWallets = await redis.sMembers("airdrop:manual_wallets");
    const totalClaimed = await redis.get(AIRDROP_COUNT_KEY) || 0;

    console.log(`📊 Exporting ${claimedWallets.length} claimed wallets (${manualWallets.length} manual)`);

    // Create CSV content with detailed claim data
    let csvContent = "Wallet Address,Claim Type,Amount (WALDO),Status,Timestamp,TX Hash\n";

    // Add each wallet to CSV with detailed information
    for (let i = 0; i < claimedWallets.length; i++) {
      const wallet = claimedWallets[i];
      const claimOrder = i + 1;

      try {
        // Try to get detailed claim data
        const claimData = await redis.hGetAll(`airdrop:claim:${wallet}`);

        if (claimData && claimData.amount) {
          // We have detailed data - use actual amount
          const amount = parseFloat(claimData.amount).toFixed(0);
          const claimType = claimData.type === 'admin' ? `Manual Airdrop #${claimOrder}` : `Regular Claim #${claimOrder}`;
          const timestamp = claimData.timestamp || 'Unknown';
          const txHash = claimData.txHash || 'Unknown';

          csvContent += `${wallet},${claimType},${amount},Claimed,${timestamp},${txHash}\n`;
        } else {
          // No detailed data - historical claim, assume 50k
          const isManual = manualWallets.includes(wallet);
          const claimType = isManual ? `Manual Airdrop #${claimOrder}` : `Regular Claim #${claimOrder}`;

          csvContent += `${wallet},${claimType},50000,Claimed,Historical,Unknown\n`;
        }
      } catch (error) {
        console.error(`Error getting claim data for ${wallet}:`, error);
        // Fallback to historical format
        const isManual = manualWallets.includes(wallet);
        const claimType = isManual ? `Manual Airdrop #${claimOrder}` : `Regular Claim #${claimOrder}`;

        csvContent += `${wallet},${claimType},50000,Claimed,Historical,Unknown\n`;
      }
    }

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="waldo-airdrop-claimed-${new Date().toISOString().split('T')[0]}.csv"`);

    // Send CSV content
    res.send(csvContent);

    console.log(`✅ CSV export completed: ${claimedWallets.length} wallets exported`);

  } catch (error) {
    console.error('❌ Error exporting claimed wallets:', error);
    res.status(500).json({
      success: false,
      error: "Failed to export claimed wallets"
    });
  }
});

// ✅ GET /api/airdrop/claimed-list - Get claimed wallets as JSON
router.get("/claimed-list", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get all claimed wallets from Redis set
    const claimedWallets = await redis.sMembers(AIRDROP_REDIS_KEY);
    const manualWallets = await redis.sMembers("airdrop:manual_wallets");
    const totalClaimed = await redis.get(AIRDROP_COUNT_KEY) || 0;

    console.log(`📊 Returning ${claimedWallets.length} claimed wallets (${manualWallets.length} manual)`);

    // Get detailed claim data for each wallet
    const walletsWithDetails = await Promise.all(
      claimedWallets.map(async (wallet, index) => {
        try {
          // Try to get detailed claim data
          const claimData = await redis.hGetAll(`airdrop:claim:${wallet}`);

          if (claimData && claimData.amount) {
            // We have detailed data - use actual amount
            return {
              wallet: wallet,
              claimOrder: index + 1,
              amount: parseFloat(claimData.amount).toFixed(0),
              claimType: claimData.type === 'admin' ? "Manual Airdrop" : "Regular Claim",
              status: "Claimed",
              timestamp: claimData.timestamp || 'Unknown',
              txHash: claimData.txHash || 'Unknown'
            };
          } else {
            // No detailed data - historical claim, assume 50k
            return {
              wallet: wallet,
              claimOrder: index + 1,
              amount: "50000", // Historical claim - assume 50k
              claimType: manualWallets.includes(wallet) ? "Manual Airdrop" : "Regular Claim",
              status: "Claimed",
              timestamp: 'Historical',
              txHash: 'Unknown'
            };
          }
        } catch (error) {
          console.error(`Error getting claim data for ${wallet}:`, error);
          // Fallback to historical format
          return {
            wallet: wallet,
            claimOrder: index + 1,
            amount: "50000",
            claimType: manualWallets.includes(wallet) ? "Manual Airdrop" : "Regular Claim",
            status: "Claimed",
            timestamp: 'Historical',
            txHash: 'Unknown'
          };
        }
      })
    );

    res.json({
      success: true,
      totalClaimed: parseInt(totalClaimed),
      totalWallets: claimedWallets.length,
      manualWallets: manualWallets.length,
      regularWallets: claimedWallets.length - manualWallets.length,
      wallets: walletsWithDetails,
      exportedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting claimed wallets list:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get claimed wallets list"
    });
  }
});

// ✅ GET /api/airdrop/trustline-qr - Generate XUMM trustline QR code (simplified)
router.get("/trustline-qr", async (req, res) => {
  try {
    console.log('🔗 Creating XUMM trustline QR for WALDO');

    // Create XUMM payload for trustline setup
    const xummResponse = await fetch('https://xumm.app/api/v1/platform/payload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.XUMM_API_KEY,
        'X-API-Secret': process.env.XUMM_API_SECRET
      },
      body: JSON.stringify({
        txjson: {
          TransactionType: 'TrustSet',
          LimitAmount: {
            currency: 'WLO',
            issuer: 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY',
            value: '1000000000'
          }
        },
        options: {
          submit: false,
          multisign: false,
          expire: 1440
        }
      })
    });

    const xummData = await xummResponse.json();

    if (xummData.uuid && xummData.refs && xummData.refs.qr_png) {
      console.log('✅ XUMM trustline QR created successfully');
      res.json({
        success: true,
        qr: xummData.refs.qr_png,
        uuid: xummData.uuid,
        deeplink: xummData.next.always
      });
    } else {
      console.error('❌ XUMM API error:', xummData);
      res.status(500).json({
        success: false,
        error: "XUMM API failed",
        detail: xummData
      });
    }

  } catch (error) {
    console.error('❌ Trustline QR error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to create trustline QR code"
    });
  }
});

// ✅ POST /api/airdrop/add-missing-wallet - Add wallet to tracking (admin only)
router.post("/add-missing-wallet", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const { wallet, reason } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    if (!wallet || !wallet.startsWith('r') || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet address" });
    }

    // Check if wallet is already tracked
    const alreadyTracked = await redis.sIsMember(AIRDROP_REDIS_KEY, wallet);
    if (alreadyTracked) {
      return res.json({ success: false, error: "Wallet already in tracking system" });
    }

    // Add wallet to tracking set
    await redis.sAdd(AIRDROP_REDIS_KEY, wallet);

    // Get updated counts
    const totalWallets = await redis.sCard(AIRDROP_REDIS_KEY);

    console.log(`✅ Admin added missing wallet to tracking: ${wallet}. Reason: ${reason || 'No reason provided'}`);

    res.json({
      success: true,
      message: "Wallet added to tracking system",
      wallet: wallet,
      totalTracked: totalWallets,
      reason: reason || 'Missing from tracking'
    });

  } catch (error) {
    console.error('❌ Error adding missing wallet:', error);
    res.status(500).json({
      success: false,
      error: "Failed to add wallet to tracking"
    });
  }
});

// ✅ POST /api/airdrop/set-amount - Change airdrop amount (admin only)
router.post("/set-amount", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const { amount } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Validate amount
    if (!amount || amount <= 0 || amount > 1000000) {
      return res.status(400).json({
        success: false,
        error: "Amount must be between 1 and 1,000,000 WALDO"
      });
    }

    // Convert to proper format (6 decimal places)
    const formattedAmount = parseFloat(amount).toFixed(6);

    // Store in Redis
    await redis.set("airdrop:amount", formattedAmount);

    console.log(`✅ Admin changed airdrop amount to: ${formattedAmount} WALDO`);

    res.json({
      success: true,
      message: "Airdrop amount updated successfully",
      newAmount: formattedAmount,
      previousAmount: "50000.000000"
    });

  } catch (error) {
    console.error('❌ Error setting airdrop amount:', error);
    res.status(500).json({
      success: false,
      error: "Failed to update airdrop amount"
    });
  }
});

// ✅ GET /api/airdrop/get-amount - Get current airdrop amount
router.get("/get-amount", async (req, res) => {
  try {
    // Get amount from Redis, fallback to default
    const storedAmount = await redis.get("airdrop:amount");
    const currentAmount = storedAmount || "50000.000000";

    res.json({
      success: true,
      amount: currentAmount,
      source: storedAmount ? "Redis override" : "Default fallback"
    });

  } catch (error) {
    console.error('❌ Error getting airdrop amount:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get airdrop amount",
      amount: "50000.000000"
    });
  }
});

export default router;



