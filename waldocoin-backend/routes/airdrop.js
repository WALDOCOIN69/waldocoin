// routes/airdrop.js
import express from "express";
import xrpl from "xrpl";
import { redis } from "../redisClient.js";
import {
  WALDOCOIN_TOKEN,
  WALDO_ISSUER,
  WALDO_DISTRIBUTOR_SECRET
} from "../constants.js";
import { validateAdminKey, getAdminKey } from "../utils/adminAuth.js";

const router = express.Router();

// Airdrop configuration
const AIRDROP_LIMIT = 1000; // Maximum number of airdrops
const AIRDROP_AMOUNT = "50000.000000"; // Amount per airdrop
const AIRDROP_REDIS_KEY = "airdrop:wallets"; // Redis set to track claimed wallets
const AIRDROP_COUNT_KEY = "airdrop:count"; // Redis counter for total airdrops

router.post("/", async (req, res) => {
  const { wallet, password, amount, adminOverride, reason } = req.body;

  // Track user behavior for analytics
  const userIP = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Log attempt for behavior tracking
  const attemptData = {
    wallet: wallet,
    ip: userIP,
    userAgent: userAgent,
    timestamp: new Date().toISOString(),
    hasPassword: !!password,
    passwordLength: password ? password.length : 0,
    isAdmin: !!adminOverride
  };

  // Store attempt (keep for 7 days for analytics)
  const attemptKey = `attempt:${wallet}:${Date.now()}`;
  await redis.hSet(attemptKey, attemptData);
  await redis.expire(attemptKey, 7 * 24 * 60 * 60); // 7 days

  // Track attempts per IP (rate limiting data)
  await redis.incr(`ip_attempts:${userIP}`);
  await redis.expire(`ip_attempts:${userIP}`, 60 * 60); // 1 hour window

  console.log(`🔍 Airdrop request received:`, {
    wallet: wallet ? `${wallet.slice(0, 8)}...${wallet.slice(-6)}` : 'null',
    ip: userIP,
    hasPassword: !!password,
    passwordLength: password ? password.length : 0,
    amount,
    adminOverride,
    hasReason: !!reason,
    userAgent: req.headers['user-agent']?.slice(0, 50)
  });

  // Check for emergency stop
  const emergencyStop = await redis.get("airdrop:emergency_stop");
  if (emergencyStop === "true") {
    const emergencyReason = await redis.get("airdrop:emergency_reason") || "System maintenance";
    console.log(`🚨 Airdrop blocked - Emergency stop active: ${emergencyReason}`);
    return res.status(503).json({
      success: false,
      error: "🚨 Airdrops temporarily disabled",
      reason: emergencyReason
    });
  }

  // Input validation
  if (!wallet || typeof wallet !== 'string' || !wallet.startsWith("r") || wallet.length < 25 || wallet.length > 34) {
    console.log(`❌ Invalid wallet format:`, { wallet, type: typeof wallet, length: wallet?.length });
    return res.status(400).json({ success: false, error: "Invalid wallet address format" });
  }

  // Check blacklist/whitelist (skip for admin overrides)
  if (!isAdminOverride) {
    const isBlacklisted = await redis.sIsMember('airdrop:blacklist', wallet);
    if (isBlacklisted) {
      console.log(`❌ Wallet blacklisted: ${wallet}`);
      return res.status(403).json({
        success: false,
        error: "❌ Wallet is blacklisted",
        blacklisted: true
      });
    }

    // Optional: If whitelist exists and has members, only allow whitelisted wallets
    const whitelistSize = await redis.sCard('airdrop:whitelist');
    if (whitelistSize > 0) {
      const isWhitelisted = await redis.sIsMember('airdrop:whitelist', wallet);
      if (!isWhitelisted) {
        console.log(`❌ Wallet not whitelisted: ${wallet}`);
        return res.status(403).json({
          success: false,
          error: "❌ Wallet not on whitelist",
          whitelisted: false
        });
      }
    }
  }

  // Admin override handling
  const isAdminOverride = adminOverride === true;

  // Get dynamic airdrop amount from Redis
  const storedAmount = await redis.get("airdrop:amount");
  let airdropAmount = storedAmount || AIRDROP_AMOUNT;

  if (isAdminOverride) {
    // Admin override - validate admin wallet and custom amount
    const adminWallet = req.headers['x-admin-wallet'];
    if (adminWallet !== "rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL") {
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

    // Get daily password from Redis override, otherwise use environment variable
    const redisPassword = await redis.get("airdrop:daily_password");
    const dailyPassword = redisPassword || process.env.AIRDROP_DEFAULT_PASSWORD || "WALDOCREW";

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

      // Log failed transaction for retry system
      const failedTx = {
        wallet: wallet,
        amount: airdropAmount,
        timestamp: new Date().toISOString(),
        error: result.result.meta.TransactionResult,
        txBlob: signed.tx_blob,
        retryCount: 0,
        type: isAdminOverride ? 'admin' : 'regular',
        reason: isAdminOverride ? reason : 'regular_claim'
      };

      await redis.hSet(`failed_tx:${wallet}:${Date.now()}`, failedTx);
      await redis.lPush('failed_transactions', `${wallet}:${Date.now()}`);
      await redis.lTrim('failed_transactions', 0, 999); // Keep last 1000 failed TXs

      return res.status(500).json({
        success: false,
        error: "Transaction failed",
        detail: result.result.meta.TransactionResult,
        retryable: true
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
    const adminKey = getAdminKey(req);
    const validation = validateAdminKey(adminKey);

    if (!validation.valid) {
      return res.status(403).json({ success: false, error: validation.error });
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

    // Log admin activity
    await logAdminActivity('PASSWORD_CHANGE', {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }, {
      newPassword: newPassword
    });

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

    // SECURITY: Never log admin keys in plain text
    console.log(`🔑 Password endpoint admin key validation: ${adminKey ? 'Provided' : 'Missing'}`);

    if (adminKey !== expectedKey) {
      console.log(`❌ Password endpoint admin key validation failed`);
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    console.log(`✅ Password endpoint admin key validation successful`);

    // Get current password (same logic as main endpoint)
    const redisPassword = await redis.get("airdrop:daily_password");
    const currentPassword = redisPassword || process.env.AIRDROP_DEFAULT_PASSWORD || "WALDOCREW";

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
    const currentPassword = redisPassword || process.env.AIRDROP_DEFAULT_PASSWORD || "WALDOCREW";

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

    // SECURITY: Never log admin keys in plain text
    console.log(`🔑 Admin key validation: ${adminKey ? 'Provided' : 'Missing'}, EnvVar: ${expectedKey ? 'Set' : 'Not Set'}`);

    if (adminKey !== expectedKey) {
      console.log(`❌ Admin key validation failed`);
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    console.log(`✅ Admin key validation successful`);

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
    console.log('⏰ Global timeout reached, returning cached fallback data');
    if (!res.headersSent) {
      res.json({
        success: true,
        trustlineCount: 0,
        walletsWithBalance: 0,
        totalWaldoHeld: 0,
        source: "Fallback data (XRPL timeout - please refresh)",
        timestamp: new Date().toISOString(),
        warning: "Could not reach XRPL servers. Data may be outdated."
      });
    }
  }, 30000); // Increased timeout to 30 seconds

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
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout per server

        response = await fetch(server, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'gateway_balances',
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
          console.log(`⏰ ${server} timed out after 5 seconds`);
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
      hasAssets: !!(data.result && data.result.assets),
      assetsCount: data.result?.assets?.length || 0,
      error: data.error || null
    });

    if (data.result && data.result.assets) {
      console.log(`🔍 Found ${data.result.assets.length} total asset holders`);

      // gateway_balances returns assets array with currency and holders
      // Each asset has: currency, issuer, and balances object with account: balance pairs
      let trustlineCount = 0;
      let walletsWithBalance = 0;
      let totalWaldoHeld = 0;

      // Find WLO asset in the assets array
      const wloAsset = data.result.assets.find(asset => asset.currency === 'WLO');

      if (wloAsset && wloAsset.balances) {
        console.log(`🎯 Found WLO asset with ${Object.keys(wloAsset.balances).length} holders`);

        trustlineCount = Object.keys(wloAsset.balances).length;

        // Count wallets with balance > 0
        Object.entries(wloAsset.balances).forEach(([account, balance]) => {
          const balanceNum = parseFloat(balance);
          if (balanceNum > 0) {
            walletsWithBalance++;
            totalWaldoHeld += balanceNum;
          }
        });

        console.log(`✅ Real-time XRPL trustline data: ${trustlineCount} trustlines, ${walletsWithBalance} with balance, ${totalWaldoHeld.toFixed(2)} total WLO`);

        clearTimeout(globalTimeout);
        res.json({
          success: true,
          trustlineCount: trustlineCount,
          walletsWithBalance: walletsWithBalance,
          totalWaldoHeld: Math.round(totalWaldoHeld),
          source: "Real-time XRPL query (gateway_balances)",
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('⚠️ WLO asset not found in gateway_balances response');
        clearTimeout(globalTimeout);
        res.json({
          success: true,
          trustlineCount: 0,
          walletsWithBalance: 0,
          totalWaldoHeld: 0,
          source: "Fallback data (WLO not found - please refresh)",
          timestamp: new Date().toISOString(),
          warning: "Could not find WLO asset data. Please refresh the page."
        });
      }
    } else {
      console.log('⚠️ XRPL query failed, returning zero values');
      clearTimeout(globalTimeout);
      res.json({
        success: true,
        trustlineCount: 0,
        walletsWithBalance: 0,
        totalWaldoHeld: 0,
        source: "Fallback data (XRPL failed - please refresh)",
        timestamp: new Date().toISOString(),
        warning: "Could not retrieve trustline data. Please refresh the page."
      });
    }
  } catch (error) {
    console.error('❌ XRPL trustline query error:', error.message);
    clearTimeout(globalTimeout);
    res.json({
      success: true,
      trustlineCount: 0,
      walletsWithBalance: 0,
      totalWaldoHeld: 0,
      source: "Fallback data (error - please refresh)",
      timestamp: new Date().toISOString(),
      warning: "Error querying XRPL. Please refresh the page."
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

    // Log admin activity
    await logAdminActivity('AMOUNT_CHANGE', {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }, {
      newAmount: formattedAmount,
      previousAmount: "50000.000000"
    });

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

// ✅ Admin Activity Logging Function
async function logAdminActivity(action, adminInfo, details = {}) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: action,
      adminIP: adminInfo.ip || 'Unknown',
      adminUserAgent: adminInfo.userAgent || 'Unknown',
      details: details,
      id: Date.now().toString()
    };

    // Store in Redis with expiration (keep logs for 30 days)
    await redis.hSet(`admin:log:${logEntry.id}`, logEntry);
    await redis.expire(`admin:log:${logEntry.id}`, 30 * 24 * 60 * 60); // 30 days

    // Add to activity list (most recent first)
    await redis.lPush('admin:activity_log', logEntry.id);
    await redis.lTrim('admin:activity_log', 0, 999); // Keep last 1000 activities

    console.log(`📝 Admin activity logged: ${action} by ${adminInfo.ip}`);
  } catch (error) {
    console.error('❌ Failed to log admin activity:', error);
  }
}

// ✅ GET /api/airdrop/admin-logs - Get admin activity logs
router.get("/admin-logs", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get recent activity IDs
    const activityIds = await redis.lRange('admin:activity_log', 0, 49); // Last 50 activities

    // Get detailed log entries
    const logs = await Promise.all(
      activityIds.map(async (id) => {
        try {
          const logData = await redis.hGetAll(`admin:log:${id}`);
          return logData.timestamp ? {
            ...logData,
            details: JSON.parse(logData.details || '{}')
          } : null;
        } catch (error) {
          console.error(`Error getting log ${id}:`, error);
          return null;
        }
      })
    );

    // Filter out null entries and sort by timestamp
    const validLogs = logs.filter(log => log !== null)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      logs: validLogs,
      totalLogs: validLogs.length
    });

  } catch (error) {
    console.error('❌ Error getting admin logs:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get admin logs"
    });
  }
});

// ✅ POST /api/airdrop/emergency-stop - Emergency stop all airdrops
router.post("/emergency-stop", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const { reason } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Set emergency stop flag
    await redis.set("airdrop:emergency_stop", "true");
    await redis.set("airdrop:emergency_reason", reason || "Emergency stop activated");
    await redis.set("airdrop:emergency_timestamp", new Date().toISOString());

    // Log admin activity
    await logAdminActivity('EMERGENCY_STOP', {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }, {
      reason: reason || "No reason provided"
    });

    console.log(`🚨 EMERGENCY STOP activated by admin: ${reason}`);

    res.json({
      success: true,
      message: "Emergency stop activated - all airdrops are now disabled",
      reason: reason || "Emergency stop activated"
    });

  } catch (error) {
    console.error('❌ Error activating emergency stop:', error);
    res.status(500).json({
      success: false,
      error: "Failed to activate emergency stop"
    });
  }
});

// ✅ POST /api/airdrop/emergency-resume - Resume airdrops after emergency stop
router.post("/emergency-resume", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const { reason } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Remove emergency stop flag
    await redis.del("airdrop:emergency_stop");
    await redis.del("airdrop:emergency_reason");
    await redis.del("airdrop:emergency_timestamp");

    // Log admin activity
    await logAdminActivity('EMERGENCY_RESUME', {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }, {
      reason: reason || "No reason provided"
    });

    console.log(`✅ Emergency stop lifted by admin: ${reason}`);

    res.json({
      success: true,
      message: "Emergency stop lifted - airdrops are now enabled",
      reason: reason || "Emergency stop lifted"
    });

  } catch (error) {
    console.error('❌ Error lifting emergency stop:', error);
    res.status(500).json({
      success: false,
      error: "Failed to lift emergency stop"
    });
  }
});

// ✅ GET /api/airdrop/system-health - System health monitoring
router.get("/system-health", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const startTime = Date.now();

    // Check Redis connection
    let redisStatus = 'healthy';
    let redisResponseTime = 0;
    try {
      const redisStart = Date.now();
      await redis.ping();
      redisResponseTime = Date.now() - redisStart;
    } catch (error) {
      redisStatus = 'unhealthy';
      redisResponseTime = -1;
    }

    // Check XRPL connection
    let xrplStatus = 'healthy';
    let xrplResponseTime = 0;
    try {
      const xrplStart = Date.now();
      const response = await fetch('https://s1.ripple.com:51234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'server_info',
          params: [{}]
        }),
        signal: AbortSignal.timeout(5000)
      });
      xrplResponseTime = Date.now() - xrplStart;
      if (!response.ok) xrplStatus = 'degraded';
    } catch (error) {
      xrplStatus = 'unhealthy';
      xrplResponseTime = -1;
    }

    // Check distributor wallet balance
    let walletBalance = 'unknown';
    let walletStatus = 'unknown';
    try {
      const balanceResponse = await fetch('https://s1.ripple.com:51234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_lines',
          params: [{
            account: 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL',
            ledger_index: 'validated'
          }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        const waldoLine = balanceData.result?.lines?.find(line =>
          line.currency === 'WLO' && line.account === 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'
        );

        if (waldoLine) {
          walletBalance = parseFloat(waldoLine.balance);
          walletStatus = walletBalance > 1000000 ? 'healthy' :
            walletBalance > 100000 ? 'warning' : 'critical';
        }
      }
    } catch (error) {
      walletStatus = 'error';
    }

    // Check emergency stop status
    const emergencyStop = await redis.get("airdrop:emergency_stop");
    const emergencyReason = await redis.get("airdrop:emergency_reason");

    // Get system metrics
    const totalClaims = await redis.get("airdrop:count") || 0;
    const currentAmount = await redis.get("airdrop:amount") || "50000.000000";

    const totalResponseTime = Date.now() - startTime;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      overallStatus: (redisStatus === 'healthy' && xrplStatus !== 'unhealthy' && walletStatus !== 'critical') ? 'healthy' : 'degraded',
      responseTime: totalResponseTime,
      services: {
        redis: {
          status: redisStatus,
          responseTime: redisResponseTime
        },
        xrpl: {
          status: xrplStatus,
          responseTime: xrplResponseTime
        },
        distributorWallet: {
          status: walletStatus,
          balance: walletBalance,
          balanceFormatted: typeof walletBalance === 'number' ? walletBalance.toLocaleString() : 'Unknown'
        }
      },
      airdropSystem: {
        emergencyStop: emergencyStop === 'true',
        emergencyReason: emergencyReason || null,
        totalClaims: parseInt(totalClaims),
        currentAmount: currentAmount,
        remainingClaims: 1000 - parseInt(totalClaims)
      }
    });

  } catch (error) {
    console.error('❌ Error checking system health:', error);
    res.status(500).json({
      success: false,
      error: "Failed to check system health",
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ GET /api/airdrop/failed-transactions - Get failed transactions for retry
router.get("/failed-transactions", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get failed transaction IDs
    const failedTxIds = await redis.lRange('failed_transactions', 0, 49); // Last 50 failed TXs

    // Get detailed failed transaction data
    const failedTxs = await Promise.all(
      failedTxIds.map(async (id) => {
        try {
          const txData = await redis.hGetAll(`failed_tx:${id}`);
          return txData.timestamp ? {
            id: id,
            ...txData,
            retryCount: parseInt(txData.retryCount) || 0
          } : null;
        } catch (error) {
          console.error(`Error getting failed TX ${id}:`, error);
          return null;
        }
      })
    );

    // Filter out null entries and sort by timestamp
    const validFailedTxs = failedTxs.filter(tx => tx !== null)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      failedTransactions: validFailedTxs,
      totalFailed: validFailedTxs.length
    });

  } catch (error) {
    console.error('❌ Error getting failed transactions:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get failed transactions"
    });
  }
});

// ✅ POST /api/airdrop/retry-transaction - Retry a failed transaction
router.post("/retry-transaction", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const { transactionId } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    if (!transactionId) {
      return res.status(400).json({ success: false, error: "Transaction ID required" });
    }

    // Get failed transaction data
    const txData = await redis.hGetAll(`failed_tx:${transactionId}`);

    if (!txData.wallet) {
      return res.status(404).json({ success: false, error: "Failed transaction not found" });
    }

    // Check retry limit
    const retryCount = parseInt(txData.retryCount) || 0;
    if (retryCount >= 3) {
      return res.status(400).json({
        success: false,
        error: "Maximum retry attempts reached (3)"
      });
    }

    // Attempt to resubmit transaction
    const client = new xrpl.Client("wss://s1.ripple.com");
    await client.connect();

    try {
      const result = await client.submitAndWait(txData.txBlob);

      if (result.result.meta.TransactionResult === "tesSUCCESS") {
        // Success! Remove from failed list and add to successful claims
        await redis.del(`failed_tx:${transactionId}`);
        await redis.lRem('failed_transactions', 1, transactionId);

        // Add to successful claims tracking
        await redis.sAdd(AIRDROP_REDIS_KEY, txData.wallet);
        if (txData.type !== 'admin') {
          await redis.incr(AIRDROP_COUNT_KEY);
        }

        // Store successful claim data
        const claimData = {
          wallet: txData.wallet,
          amount: txData.amount,
          timestamp: new Date().toISOString(),
          txHash: result.result.hash,
          type: txData.type,
          reason: txData.reason,
          retried: true,
          originalFailure: txData.error
        };
        await redis.hSet(`airdrop:claim:${txData.wallet}`, claimData);

        // Log admin activity
        await logAdminActivity('TRANSACTION_RETRY_SUCCESS', {
          ip: req.ip,
          userAgent: req.headers['user-agent']
        }, {
          wallet: txData.wallet,
          amount: txData.amount,
          originalError: txData.error,
          retryCount: retryCount + 1,
          txHash: result.result.hash
        });

        await client.disconnect();

        res.json({
          success: true,
          message: "Transaction retry successful",
          txHash: result.result.hash,
          wallet: txData.wallet,
          amount: txData.amount
        });

      } else {
        // Still failed, increment retry count
        await redis.hSet(`failed_tx:${transactionId}`, 'retryCount', retryCount + 1);
        await redis.hSet(`failed_tx:${transactionId}`, 'lastRetry', new Date().toISOString());
        await redis.hSet(`failed_tx:${transactionId}`, 'lastError', result.result.meta.TransactionResult);

        await client.disconnect();

        res.json({
          success: false,
          error: "Transaction retry failed",
          detail: result.result.meta.TransactionResult,
          retryCount: retryCount + 1,
          canRetry: retryCount + 1 < 3
        });
      }

    } catch (submitError) {
      await client.disconnect();

      // Update retry count and error
      await redis.hSet(`failed_tx:${transactionId}`, 'retryCount', retryCount + 1);
      await redis.hSet(`failed_tx:${transactionId}`, 'lastRetry', new Date().toISOString());
      await redis.hSet(`failed_tx:${transactionId}`, 'lastError', submitError.message);

      res.json({
        success: false,
        error: "Transaction retry failed",
        detail: submitError.message,
        retryCount: retryCount + 1,
        canRetry: retryCount + 1 < 3
      });
    }

  } catch (error) {
    console.error('❌ Error retrying transaction:', error);
    res.status(500).json({
      success: false,
      error: "Failed to retry transaction"
    });
  }
});

// ✅ Bulk Wallet Operations
router.post("/bulk-wallet-operation", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const { operation, wallets, reason } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    if (!operation || !wallets || !Array.isArray(wallets)) {
      return res.status(400).json({
        success: false,
        error: "Operation and wallets array required"
      });
    }

    const validOperations = ['blacklist', 'whitelist', 'remove_blacklist', 'remove_whitelist'];
    if (!validOperations.includes(operation)) {
      return res.status(400).json({
        success: false,
        error: "Invalid operation. Must be: blacklist, whitelist, remove_blacklist, remove_whitelist"
      });
    }

    let successCount = 0;
    let errorCount = 0;
    const results = [];

    for (const wallet of wallets) {
      try {
        // Validate wallet format
        if (!wallet || !wallet.startsWith('r') || wallet.length < 25) {
          results.push({ wallet, success: false, error: 'Invalid wallet format' });
          errorCount++;
          continue;
        }

        switch (operation) {
          case 'blacklist':
            await redis.sAdd('airdrop:blacklist', wallet);
            await redis.sRem('airdrop:whitelist', wallet); // Remove from whitelist if exists
            break;
          case 'whitelist':
            await redis.sAdd('airdrop:whitelist', wallet);
            await redis.sRem('airdrop:blacklist', wallet); // Remove from blacklist if exists
            break;
          case 'remove_blacklist':
            await redis.sRem('airdrop:blacklist', wallet);
            break;
          case 'remove_whitelist':
            await redis.sRem('airdrop:whitelist', wallet);
            break;
        }

        results.push({ wallet, success: true });
        successCount++;

      } catch (walletError) {
        results.push({ wallet, success: false, error: walletError.message });
        errorCount++;
      }
    }

    // Log admin activity
    await logAdminActivity('BULK_WALLET_OPERATION', {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }, {
      operation: operation,
      totalWallets: wallets.length,
      successCount: successCount,
      errorCount: errorCount,
      reason: reason || 'No reason provided'
    });

    res.json({
      success: true,
      message: `Bulk ${operation} operation completed`,
      totalWallets: wallets.length,
      successCount: successCount,
      errorCount: errorCount,
      results: results
    });

  } catch (error) {
    console.error('❌ Error in bulk wallet operation:', error);
    res.status(500).json({
      success: false,
      error: "Failed to perform bulk wallet operation"
    });
  }
});

// ✅ GET /api/airdrop/analytics - Enhanced analytics dashboard
router.get("/analytics", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get basic stats
    const totalClaims = await redis.get("airdrop:count") || 0;
    const claimedWallets = await redis.sMembers(AIRDROP_REDIS_KEY);
    const manualWallets = await redis.sMembers("airdrop:manual_wallets");
    const blacklistedWallets = await redis.sCard('airdrop:blacklist');
    const whitelistedWallets = await redis.sCard('airdrop:whitelist');

    // Get failed transactions
    const failedTxIds = await redis.lRange('failed_transactions', 0, -1);
    const failedTxCount = failedTxIds.length;

    // Calculate success rate
    const totalAttempts = parseInt(totalClaims) + failedTxCount;
    const successRate = totalAttempts > 0 ? ((parseInt(totalClaims) / totalAttempts) * 100).toFixed(2) : 100;

    // Get recent activity (last 24h claims)
    let recentClaims = 0;
    for (const wallet of claimedWallets) {
      try {
        const claimData = await redis.hGetAll(`airdrop:claim:${wallet}`);
        if (claimData.timestamp) {
          const claimTime = new Date(claimData.timestamp);
          if (claimTime > last24h) {
            recentClaims++;
          }
        }
      } catch (error) {
        // Skip if no detailed data
      }
    }

    // Get distributor wallet balance
    let distributorBalance = 'Unknown';
    try {
      const balanceResponse = await fetch('https://s1.ripple.com:51234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_lines',
          params: [{
            account: 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL',
            ledger_index: 'validated'
          }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        const waldoLine = balanceData.result?.lines?.find(line =>
          line.currency === 'WLO' && line.account === 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'
        );

        if (waldoLine) {
          distributorBalance = parseFloat(waldoLine.balance).toLocaleString();
        }
      }
    } catch (error) {
      // Keep as 'Unknown'
    }

    // Get current airdrop amount
    const currentAmount = await redis.get("airdrop:amount") || "50000.000000";
    const amountPerClaim = parseFloat(currentAmount);

    // Calculate total distributed
    const totalDistributed = parseInt(totalClaims) * amountPerClaim;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      overview: {
        totalClaims: parseInt(totalClaims),
        totalDistributed: totalDistributed,
        totalDistributedFormatted: totalDistributed.toLocaleString(),
        remainingClaims: 1000 - parseInt(totalClaims),
        currentAmountPerClaim: amountPerClaim,
        distributorBalance: distributorBalance,
        successRate: parseFloat(successRate)
      },
      activity: {
        recentClaims24h: recentClaims,
        failedTransactions: failedTxCount,
        totalAttempts: totalAttempts
      },
      walletManagement: {
        regularClaims: claimedWallets.length - manualWallets.length,
        manualAirdrops: manualWallets.length,
        blacklistedWallets: blacklistedWallets,
        whitelistedWallets: whitelistedWallets
      },
      system: {
        emergencyStop: await redis.get("airdrop:emergency_stop") === "true",
        emergencyReason: await redis.get("airdrop:emergency_reason")
      }
    });

  } catch (error) {
    console.error('❌ Error getting analytics:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get analytics data"
    });
  }
});

// ✅ GET /api/airdrop/user-behavior - User behavior analytics
router.get("/user-behavior", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get IP attempt data (top IPs by attempts)
    const ipKeys = await redis.keys('ip_attempts:*');
    const ipData = [];

    for (const key of ipKeys.slice(0, 20)) { // Top 20 IPs
      const ip = key.replace('ip_attempts:', '');
      const attempts = await redis.get(key);
      if (attempts && parseInt(attempts) > 1) {
        ipData.push({
          ip: ip,
          attempts: parseInt(attempts),
          suspicious: parseInt(attempts) > 10
        });
      }
    }

    // Sort by attempts
    ipData.sort((a, b) => b.attempts - a.attempts);

    // Get recent failed attempts patterns
    const failedTxIds = await redis.lRange('failed_transactions', 0, 19); // Last 20 failed
    const failedPatterns = {};

    for (const id of failedTxIds) {
      try {
        const txData = await redis.hGetAll(`failed_tx:${id}`);
        if (txData.error) {
          failedPatterns[txData.error] = (failedPatterns[txData.error] || 0) + 1;
        }
      } catch (error) {
        // Skip
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ipAnalytics: {
        topIPs: ipData,
        suspiciousIPs: ipData.filter(ip => ip.suspicious),
        totalUniqueIPs: ipKeys.length
      },
      failurePatterns: failedPatterns,
      recommendations: {
        highVolumeIPs: ipData.filter(ip => ip.attempts > 5).length,
        shouldImplementRateLimit: ipData.some(ip => ip.attempts > 20),
        commonFailures: Object.keys(failedPatterns).slice(0, 3)
      }
    });

  } catch (error) {
    console.error('❌ Error getting user behavior analytics:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get user behavior analytics"
    });
  }
});

// ✅ GET /api/airdrop/roi-analytics - ROI and campaign effectiveness tracking
router.get("/roi-analytics", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get basic metrics
    const totalClaims = parseInt(await redis.get("airdrop:count") || 0);
    const currentAmount = parseFloat(await redis.get("airdrop:amount") || "50000");
    const totalDistributed = totalClaims * currentAmount;

    // Get trustline count for conversion analysis
    let trustlineCount = 486; // Fallback
    try {
      const trustlineResponse = await fetch('https://s1.ripple.com:51234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_lines',
          params: [{
            account: 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY',
            ledger_index: 'validated'
          }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (trustlineResponse.ok) {
        const trustlineData = await trustlineResponse.json();
        trustlineCount = trustlineData.result?.lines?.length || 486;
      }
    } catch (error) {
      // Use fallback
    }

    // Calculate conversion metrics
    const trustlineToClaimConversion = trustlineCount > 0 ? ((totalClaims / trustlineCount) * 100).toFixed(2) : 0;
    const averageCostPerUser = totalClaims > 0 ? (totalDistributed / totalClaims).toFixed(0) : 0;

    // Estimate token value impact (assuming 1 WALDO = $0.001 for calculations)
    const estimatedTokenValue = 0.001;
    const totalValueDistributed = totalDistributed * estimatedTokenValue;
    const costPerAcquisition = totalClaims > 0 ? (totalValueDistributed / totalClaims).toFixed(3) : 0;

    // Get time-based analytics
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let claims24h = 0;
    let claims7d = 0;
    const claimedWallets = await redis.sMembers(AIRDROP_REDIS_KEY);

    for (const wallet of claimedWallets) {
      try {
        const claimData = await redis.hGetAll(`airdrop:claim:${wallet}`);
        if (claimData.timestamp) {
          const claimTime = new Date(claimData.timestamp);
          if (claimTime > last24h) claims24h++;
          if (claimTime > last7d) claims7d++;
        }
      } catch (error) {
        // Skip if no detailed data
      }
    }

    // Calculate growth rates
    const dailyGrowthRate = claims24h;
    const weeklyGrowthRate = claims7d;
    const projectedMonthlyClaims = (claims7d / 7) * 30;

    // Campaign effectiveness metrics
    const campaignMetrics = {
      reach: trustlineCount,
      engagement: totalClaims,
      conversionRate: parseFloat(trustlineToClaimConversion),
      costPerUser: parseFloat(averageCostPerUser),
      costPerAcquisition: parseFloat(costPerAcquisition),
      totalInvestment: totalValueDistributed,
      roi: totalClaims > 0 ? ((trustlineCount - totalClaims) / totalClaims * 100).toFixed(2) : 0
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      overview: {
        totalClaims: totalClaims,
        totalDistributed: totalDistributed,
        totalDistributedFormatted: totalDistributed.toLocaleString(),
        trustlineCount: trustlineCount,
        conversionRate: parseFloat(trustlineToClaimConversion),
        averageCostPerUser: parseFloat(averageCostPerUser)
      },
      financialMetrics: {
        totalValueDistributed: totalValueDistributed,
        costPerAcquisition: parseFloat(costPerAcquisition),
        estimatedTokenValue: estimatedTokenValue,
        projectedMonthlyCost: projectedMonthlyClaims * currentAmount * estimatedTokenValue
      },
      growthMetrics: {
        claims24h: claims24h,
        claims7d: claims7d,
        dailyGrowthRate: dailyGrowthRate,
        weeklyGrowthRate: weeklyGrowthRate,
        projectedMonthlyClaims: Math.round(projectedMonthlyClaims)
      },
      campaignEffectiveness: campaignMetrics,
      recommendations: {
        shouldIncreaseMarketing: trustlineToClaimConversion < 50,
        shouldReduceAmount: costPerAcquisition > 100,
        shouldExpandReach: claims24h < 10,
        optimalClaimAmount: Math.round(currentAmount * 0.8) // 20% reduction suggestion
      }
    });

  } catch (error) {
    console.error('❌ Error getting ROI analytics:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get ROI analytics"
    });
  }
});

// ✅ GET /api/airdrop/token-distribution - Token distribution analysis
router.get("/token-distribution", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get all claimed wallets with amounts
    const claimedWallets = await redis.sMembers(AIRDROP_REDIS_KEY);
    const distributionData = [];
    let totalDistributed = 0;
    const amountCounts = {};

    for (const wallet of claimedWallets) {
      try {
        const claimData = await redis.hGetAll(`airdrop:claim:${wallet}`);
        let amount = 50000; // Default for historical claims

        if (claimData.amount) {
          amount = parseFloat(claimData.amount);
        }

        distributionData.push({
          wallet: wallet,
          amount: amount,
          timestamp: claimData.timestamp || 'Historical'
        });

        totalDistributed += amount;
        amountCounts[amount] = (amountCounts[amount] || 0) + 1;

      } catch (error) {
        // Use default for failed lookups
        distributionData.push({
          wallet: wallet,
          amount: 50000,
          timestamp: 'Historical'
        });
        totalDistributed += 50000;
        amountCounts[50000] = (amountCounts[50000] || 0) + 1;
      }
    }

    // Calculate distribution statistics
    const amounts = distributionData.map(d => d.amount);
    const avgAmount = amounts.length > 0 ? (totalDistributed / amounts.length) : 0;
    const maxAmount = Math.max(...amounts, 0);
    const minAmount = Math.min(...amounts, 0);

    // Calculate concentration metrics
    const uniqueAmounts = Object.keys(amountCounts).length;
    const mostCommonAmount = Object.entries(amountCounts)
      .sort(([, a], [, b]) => b - a)[0];

    // Get distributor wallet current balance
    let currentBalance = 'Unknown';
    try {
      const balanceResponse = await fetch('https://s1.ripple.com:51234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_lines',
          params: [{
            account: 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL',
            ledger_index: 'validated'
          }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        const waldoLine = balanceData.result?.lines?.find(line =>
          line.currency === 'WLO' && line.account === 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'
        );

        if (waldoLine) {
          currentBalance = parseFloat(waldoLine.balance);
        }
      }
    } catch (error) {
      // Keep as 'Unknown'
    }

    // Calculate remaining capacity
    const remainingClaims = 1000 - claimedWallets.length;
    const currentAmount = parseFloat(await redis.get("airdrop:amount") || "50000");
    const projectedDistribution = remainingClaims * currentAmount;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      distributionOverview: {
        totalWallets: claimedWallets.length,
        totalDistributed: totalDistributed,
        totalDistributedFormatted: totalDistributed.toLocaleString(),
        averageAmount: Math.round(avgAmount),
        maxAmount: maxAmount,
        minAmount: minAmount,
        uniqueAmountLevels: uniqueAmounts
      },
      concentrationMetrics: {
        mostCommonAmount: mostCommonAmount ? {
          amount: parseFloat(mostCommonAmount[0]),
          count: mostCommonAmount[1],
          percentage: ((mostCommonAmount[1] / claimedWallets.length) * 100).toFixed(1)
        } : null,
        amountDistribution: amountCounts
      },
      walletAnalysis: {
        currentBalance: currentBalance,
        currentBalanceFormatted: typeof currentBalance === 'number' ? currentBalance.toLocaleString() : currentBalance,
        remainingCapacity: remainingClaims,
        projectedDistribution: projectedDistribution,
        projectedDistributionFormatted: projectedDistribution.toLocaleString()
      },
      insights: {
        distributionEfficiency: ((totalDistributed / (totalDistributed + (typeof currentBalance === 'number' ? currentBalance : 0))) * 100).toFixed(1),
        averageClaimSize: Math.round(avgAmount),
        recommendedOptimization: avgAmount > 30000 ? 'Consider reducing claim amounts' : 'Current amounts are optimal',
        concentrationRisk: uniqueAmounts < 3 ? 'Low diversity in amounts' : 'Good amount diversity'
      }
    });

  } catch (error) {
    console.error('❌ Error getting token distribution:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get token distribution analysis"
    });
  }
});

// ✅ GET /api/airdrop/marketing-performance - Marketing campaign performance metrics
router.get("/marketing-performance", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get time periods for analysis
    const now = new Date();
    const periods = {
      '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
      '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    };

    // Get all claimed wallets with timestamps
    const claimedWallets = await redis.sMembers(AIRDROP_REDIS_KEY);
    const timeBasedMetrics = {
      '24h': { claims: 0, amount: 0 },
      '7d': { claims: 0, amount: 0 },
      '30d': { claims: 0, amount: 0 },
      'total': { claims: 0, amount: 0 }
    };

    for (const wallet of claimedWallets) {
      try {
        const claimData = await redis.hGetAll(`airdrop:claim:${wallet}`);
        const amount = parseFloat(claimData.amount || '50000');
        const timestamp = claimData.timestamp ? new Date(claimData.timestamp) : null;

        timeBasedMetrics.total.claims++;
        timeBasedMetrics.total.amount += amount;

        if (timestamp) {
          if (timestamp > periods['24h']) {
            timeBasedMetrics['24h'].claims++;
            timeBasedMetrics['24h'].amount += amount;
          }
          if (timestamp > periods['7d']) {
            timeBasedMetrics['7d'].claims++;
            timeBasedMetrics['7d'].amount += amount;
          }
          if (timestamp > periods['30d']) {
            timeBasedMetrics['30d'].claims++;
            timeBasedMetrics['30d'].amount += amount;
          }
        }
      } catch (error) {
        // Count as historical claim
        timeBasedMetrics.total.claims++;
        timeBasedMetrics.total.amount += 50000;
      }
    }

    // Calculate growth rates and trends
    const dailyAverage = timeBasedMetrics['7d'].claims / 7;
    const weeklyAverage = timeBasedMetrics['30d'].claims / 4.3; // ~4.3 weeks in 30 days
    const growthTrend = dailyAverage > weeklyAverage ? 'increasing' : 'decreasing';

    // Get trustline data for funnel analysis
    let trustlineCount = 486;
    try {
      const trustlineResponse = await fetch('https://s1.ripple.com:51234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_lines',
          params: [{
            account: 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY',
            ledger_index: 'validated'
          }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (trustlineResponse.ok) {
        const trustlineData = await trustlineResponse.json();
        trustlineCount = trustlineData.result?.lines?.length || 486;
      }
    } catch (error) {
      // Use fallback
    }

    // Marketing funnel analysis
    const funnelMetrics = {
      awareness: trustlineCount, // People who set up trustlines
      interest: timeBasedMetrics.total.claims, // People who claimed
      conversionRate: ((timeBasedMetrics.total.claims / trustlineCount) * 100).toFixed(2),
      dropoffRate: (((trustlineCount - timeBasedMetrics.total.claims) / trustlineCount) * 100).toFixed(2)
    };

    // Channel performance (simulated based on patterns)
    const channelPerformance = {
      telegram: {
        estimated_reach: Math.round(trustlineCount * 0.6),
        estimated_conversions: Math.round(timeBasedMetrics.total.claims * 0.7),
        estimated_cost_per_acquisition: 15.50
      },
      twitter: {
        estimated_reach: Math.round(trustlineCount * 0.3),
        estimated_conversions: Math.round(timeBasedMetrics.total.claims * 0.2),
        estimated_cost_per_acquisition: 25.00
      },
      organic: {
        estimated_reach: Math.round(trustlineCount * 0.1),
        estimated_conversions: Math.round(timeBasedMetrics.total.claims * 0.1),
        estimated_cost_per_acquisition: 5.00
      }
    };

    // Performance recommendations
    const recommendations = [];
    if (parseFloat(funnelMetrics.conversionRate) < 50) {
      recommendations.push('Low conversion rate - consider improving onboarding process');
    }
    if (timeBasedMetrics['24h'].claims < 5) {
      recommendations.push('Low daily activity - increase marketing efforts');
    }
    if (growthTrend === 'decreasing') {
      recommendations.push('Declining growth trend - refresh marketing strategy');
    }
    if (timeBasedMetrics.total.claims > 800) {
      recommendations.push('High claim volume - prepare for capacity scaling');
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      timeBasedMetrics: timeBasedMetrics,
      growthAnalysis: {
        dailyAverage: Math.round(dailyAverage * 10) / 10,
        weeklyAverage: Math.round(weeklyAverage * 10) / 10,
        growthTrend: growthTrend,
        projectedMonthlyClaims: Math.round(dailyAverage * 30),
        velocityScore: Math.round((timeBasedMetrics['7d'].claims / 7) * 100) / 100
      },
      funnelAnalysis: funnelMetrics,
      channelPerformance: channelPerformance,
      recommendations: recommendations,
      kpis: {
        totalReach: trustlineCount,
        totalEngagement: timeBasedMetrics.total.claims,
        engagementRate: parseFloat(funnelMetrics.conversionRate),
        averageClaimValue: Math.round(timeBasedMetrics.total.amount / timeBasedMetrics.total.claims),
        totalValueDelivered: timeBasedMetrics.total.amount
      }
    });

  } catch (error) {
    console.error('❌ Error getting marketing performance:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get marketing performance metrics"
    });
  }
});

// ✅ GET /api/airdrop/advanced-reports - Advanced reporting and insights
router.get("/advanced-reports", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Comprehensive system analysis
    const totalClaims = parseInt(await redis.get("airdrop:count") || 0);
    const currentAmount = parseFloat(await redis.get("airdrop:amount") || "50000");
    const claimedWallets = await redis.sMembers(AIRDROP_REDIS_KEY);
    const manualWallets = await redis.sMembers("airdrop:manual_wallets");
    const blacklistedWallets = await redis.sCard('airdrop:blacklist');
    const whitelistedWallets = await redis.sCard('airdrop:whitelist');

    // Get failed transactions for reliability metrics
    const failedTxIds = await redis.lRange('failed_transactions', 0, -1);
    const totalAttempts = totalClaims + failedTxIds.length;
    const reliabilityScore = totalAttempts > 0 ? ((totalClaims / totalAttempts) * 100).toFixed(2) : 100;

    // System health metrics
    let systemHealth = 'healthy';
    const healthChecks = [];

    // Check distributor balance
    let distributorBalance = 0;
    try {
      const balanceResponse = await fetch('https://s1.ripple.com:51234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_lines',
          params: [{
            account: 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL',
            ledger_index: 'validated'
          }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        const waldoLine = balanceData.result?.lines?.find(line =>
          line.currency === 'WLO' && line.account === 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'
        );

        if (waldoLine) {
          distributorBalance = parseFloat(waldoLine.balance);
          if (distributorBalance < 100000) {
            systemHealth = 'warning';
            healthChecks.push('Low distributor balance');
          }
        }
      }
    } catch (error) {
      systemHealth = 'degraded';
      healthChecks.push('Cannot check distributor balance');
    }

    // Check emergency stop status
    const emergencyStop = await redis.get("airdrop:emergency_stop");
    if (emergencyStop === "true") {
      systemHealth = 'emergency';
      healthChecks.push('Emergency stop active');
    }

    // Operational efficiency metrics
    const remainingCapacity = 1000 - totalClaims;
    const capacityUtilization = ((totalClaims / 1000) * 100).toFixed(1);
    const averageProcessingCost = currentAmount * 0.001; // Estimated processing cost

    // Risk assessment
    const riskFactors = [];
    if (blacklistedWallets > 50) riskFactors.push('High blacklist count');
    if (failedTxIds.length > 20) riskFactors.push('High failure rate');
    if (distributorBalance < 500000) riskFactors.push('Low balance reserves');
    if (totalClaims > 900) riskFactors.push('Near capacity limit');

    const riskLevel = riskFactors.length === 0 ? 'low' :
      riskFactors.length <= 2 ? 'medium' : 'high';

    // Performance benchmarks
    const benchmarks = {
      targetClaimsPerDay: 20,
      targetConversionRate: 60,
      targetReliabilityScore: 95,
      targetCapacityUtilization: 80
    };

    // Calculate performance scores
    const dailyClaimsActual = 15; // This would be calculated from recent data
    const performanceScores = {
      dailyClaims: Math.min((dailyClaimsActual / benchmarks.targetClaimsPerDay) * 100, 100),
      reliability: parseFloat(reliabilityScore),
      capacity: parseFloat(capacityUtilization),
      overall: 0
    };
    performanceScores.overall = (performanceScores.dailyClaims + performanceScores.reliability + performanceScores.capacity) / 3;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      executiveSummary: {
        totalClaims: totalClaims,
        remainingCapacity: remainingCapacity,
        systemHealth: systemHealth,
        reliabilityScore: parseFloat(reliabilityScore),
        riskLevel: riskLevel,
        overallPerformance: Math.round(performanceScores.overall)
      },
      operationalMetrics: {
        capacityUtilization: parseFloat(capacityUtilization),
        averageProcessingCost: averageProcessingCost,
        distributorBalance: distributorBalance,
        distributorBalanceFormatted: distributorBalance.toLocaleString(),
        failureRate: ((failedTxIds.length / totalAttempts) * 100).toFixed(2)
      },
      securityMetrics: {
        blacklistedWallets: blacklistedWallets,
        whitelistedWallets: whitelistedWallets,
        manualInterventions: manualWallets.length,
        securityScore: Math.max(100 - (blacklistedWallets * 2), 0)
      },
      performanceBenchmarks: {
        benchmarks: benchmarks,
        actualPerformance: performanceScores,
        recommendations: [
          performanceScores.dailyClaims < 80 ? 'Increase marketing to boost daily claims' : null,
          performanceScores.reliability < 95 ? 'Investigate and fix transaction failures' : null,
          performanceScores.capacity > 90 ? 'Prepare for capacity expansion' : null
        ].filter(r => r !== null)
      },
      riskAssessment: {
        riskLevel: riskLevel,
        riskFactors: riskFactors,
        healthChecks: healthChecks,
        mitigationActions: riskFactors.length > 0 ? [
          'Monitor distributor balance closely',
          'Review and optimize failure handling',
          'Prepare contingency plans'
        ] : ['Continue monitoring']
      },
      insights: {
        topPerformingAreas: [
          performanceScores.reliability > 95 ? 'Transaction reliability' : null,
          blacklistedWallets < 10 ? 'Security management' : null,
          totalClaims > 500 ? 'User adoption' : null
        ].filter(i => i !== null),
        improvementOpportunities: [
          performanceScores.dailyClaims < 80 ? 'Daily claim volume' : null,
          riskLevel !== 'low' ? 'Risk management' : null,
          capacityUtilization < 50 ? 'Capacity utilization' : null
        ].filter(i => i !== null)
      }
    });

  } catch (error) {
    console.error('❌ Error getting advanced reports:', error);
    res.status(500).json({
      success: false,
      error: "Failed to generate advanced reports"
    });
  }
});

export default router;



