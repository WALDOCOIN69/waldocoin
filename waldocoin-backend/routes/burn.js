// routes/burn.js - Token burning functionality
import express from 'express';
import { redis } from '../redisClient.js';
import { Client, Wallet } from 'xrpl';
import { DISTRIBUTOR_WALLET, WALDO_ISSUER, DISTRIBUTOR_WALLET_SECRET, BURN_ADDRESS } from '../constants.js';

const router = express.Router();

// XRPL Configuration
const XRPL_SERVER = process.env.XRPL_NODE || 'wss://xrplcluster.com';
const DISTRIBUTOR_SECRET = DISTRIBUTOR_WALLET_SECRET;

// Total supply (1 billion)
const TOTAL_SUPPLY = 1000000000;

console.log("🔥 Loaded: routes/burn.js");

// Blackhole burn address (tokens sent here are burned forever)
const BLACKHOLE_ADDRESS = BURN_ADDRESS || 'rrrrrrrrrrrrrrrrrrrrrhoLvTp';

// Helper function to get WLO balance sent to blackhole address
async function getBlackholeBurnedFromXRPL(client) {
  try {
    // Check if blackhole has any WLO trustline and balance
    const response = await client.request({
      command: 'account_lines',
      account: BLACKHOLE_ADDRESS,
      ledger_index: 'validated'
    });

    const wloLine = response.result.lines?.find(
      line => line.currency === 'WLO' && line.account === WALDO_ISSUER
    );

    const blackholeBurned = parseFloat(wloLine?.balance || 0);
    console.log(`🕳️ Blackhole burns: ${blackholeBurned.toLocaleString()} WLO`);
    return blackholeBurned;
  } catch (error) {
    // Blackhole might not have any trustlines, which is fine
    console.log(`ℹ️ No WLO in blackhole address (normal if no burns sent there)`);
    return 0;
  }
}

// Helper function to get total burned from XRPL (combines all burn methods)
async function getTotalBurnedFromXRPL() {
  let client;
  try {
    console.log('🔗 Connecting to XRPL for burn data...');
    client = new Client(XRPL_SERVER, {
      timeout: 20000, // 20 second timeout
      connectionTimeout: 15000
    });

    // Add connection timeout
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('XRPL connection timeout')), 15000)
    );

    await Promise.race([connectPromise, timeoutPromise]);
    console.log('✅ Connected to XRPL');

    // Method 1: Get issuer's gateway_balances (tokens returned to issuer)
    console.log('📡 Fetching gateway_balances for issuer:', WALDO_ISSUER);
    const response = await client.request({
      command: 'gateway_balances',
      account: WALDO_ISSUER,
      ledger_index: 'validated'
    });

    const obligations = response.result.obligations || {};
    const wloInCirculation = parseFloat(obligations.WLO || 0);
    const burnedToIssuer = TOTAL_SUPPLY - wloInCirculation;

    console.log(`📊 Gateway balances: WLO obligations = ${wloInCirculation}, burned to issuer = ${burnedToIssuer}`);

    // Method 2: Get burns sent to blackhole address
    const blackholeBurned = await getBlackholeBurnedFromXRPL(client);

    // Method 3: Get any manual tracking from Redis (for off-chain burns or corrections)
    const manualBurns = parseFloat(await redis.get('manual_burns') || 0);

    await client.disconnect();

    // Total burned = tokens returned to issuer + tokens in blackhole + manual burns
    // Note: If tokens are in blackhole, they're still in "circulation" per gateway_balances
    // So we ADD blackhole burns to get the true picture
    const totalBurned = burnedToIssuer + blackholeBurned + manualBurns;

    console.log(`📊 XRPL Burn Breakdown:
      - Returned to issuer: ${burnedToIssuer.toLocaleString()} WLO
      - Sent to blackhole: ${blackholeBurned.toLocaleString()} WLO
      - Manual tracking: ${manualBurns.toLocaleString()} WLO
      - TOTAL BURNED: ${totalBurned.toLocaleString()} WLO
      - In circulation: ${(wloInCirculation - blackholeBurned).toLocaleString()} WLO`);

    return {
      total: totalBurned,
      breakdown: {
        returnedToIssuer: burnedToIssuer,
        blackholeBurned: blackholeBurned,
        manualBurns: manualBurns
      },
      inCirculation: wloInCirculation - blackholeBurned
    };

  } catch (error) {
    console.error('❌ Error fetching burn data from XRPL:', error.message);
    console.error('❌ Full error:', error);
    if (client) {
      try {
        if (client.isConnected()) {
          await client.disconnect();
        }
      } catch (disconnectError) {
        console.error('Error disconnecting:', disconnectError);
      }
    }
    // Fallback to Redis if XRPL fails
    console.log('⚠️ Falling back to Redis for burn data');
    const redisBurned = await redis.get('total_tokens_burned') || 0;
    return {
      total: parseFloat(redisBurned),
      breakdown: { returnedToIssuer: 0, blackholeBurned: 0, manualBurns: parseFloat(redisBurned) },
      inCirculation: TOTAL_SUPPLY - parseFloat(redisBurned)
    };
  }
}

// ✅ POST /api/burn/tokens - Burn WALDO tokens on-chain
router.post('/tokens', async (req, res) => {
  try {
    const { amount, adminKey, reason } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Invalid admin key'
      });
    }

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be a positive number.'
      });
    }

    if (!DISTRIBUTOR_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'Distributor secret not configured'
      });
    }

    const burnAmount = parseFloat(amount);
    const burnReason = reason || 'Manual token burn';

    console.log(`🔥 Initiating burn of ${burnAmount} WLO tokens`);

    // Connect to XRPL
    const client = new Client(XRPL_SERVER);
    await client.connect();

    // Create wallet from secret
    const wallet = Wallet.fromSeed(DISTRIBUTOR_SECRET);
    console.log(`🔑 Burning from wallet: ${wallet.classicAddress}`);

    // Create burn transaction (send to issuer to burn)
    const burnTransaction = {
      TransactionType: 'Payment',
      Account: wallet.classicAddress,
      Destination: WALDO_ISSUER,
      Amount: {
        currency: 'WLO',
        issuer: WALDO_ISSUER,
        value: burnAmount.toString()
      },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('TOKEN_BURN').toString('hex').toUpperCase(),
          MemoData: Buffer.from(burnReason).toString('hex').toUpperCase()
        }
      }]
    };

    // Submit and wait for validation
    console.log('📡 Submitting burn transaction...');
    const response = await client.submitAndWait(burnTransaction, { wallet });

    if (response.result.meta.TransactionResult === 'tesSUCCESS') {
      const txHash = response.result.hash;
      console.log(`✅ Burn successful! TX Hash: ${txHash}`);

      // Record burn event
      const burnEvent = {
        amount: burnAmount,
        reason: burnReason,
        txHash: txHash,
        timestamp: new Date().toISOString(),
        wallet: wallet.classicAddress,
        issuer: WALDO_ISSUER
      };

      // Store in Redis for tracking
      await redis.lPush('token_burns', JSON.stringify(burnEvent));
      await redis.incrByFloat('total_tokens_burned', burnAmount);

      // Store daily burn tracking
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `burns:${today}`;
      await redis.rPush(dailyKey, JSON.stringify(burnEvent));
      await redis.expire(dailyKey, 86400 * 365); // Keep for 1 year

      await client.disconnect();

      res.json({
        success: true,
        message: `Successfully burned ${burnAmount} WLO tokens`,
        burnEvent: {
          amount: burnAmount,
          txHash: txHash,
          timestamp: burnEvent.timestamp,
          reason: burnReason
        }
      });

    } else {
      console.error('❌ Burn transaction failed:', response.result.meta.TransactionResult);
      await client.disconnect();

      res.status(500).json({
        success: false,
        error: `Transaction failed: ${response.result.meta.TransactionResult}`
      });
    }

  } catch (error) {
    console.error('❌ Error burning tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to burn tokens: ' + error.message
    });
  }
});

// ✅ GET /api/burn/history - Get burn history
router.get('/history', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Invalid admin key'
      });
    }

    // Get burn history from Redis
    const burnHistory = await redis.lRange('token_burns', 0, 49); // Last 50 burns
    const totalBurned = await redis.get('total_tokens_burned') || 0;

    const parsedHistory = burnHistory.map(burn => {
      try {
        return JSON.parse(burn);
      } catch (error) {
        return null;
      }
    }).filter(burn => burn !== null);

    res.json({
      success: true,
      totalBurned: parseFloat(totalBurned),
      burnHistory: parsedHistory,
      count: parsedHistory.length
    });

  } catch (error) {
    console.error('❌ Error fetching burn history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch burn history'
    });
  }
});

// ✅ POST /api/burn/set-total - Manually set total burned (ADMIN ONLY)
router.post('/set-total', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.body.adminKey;

    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Invalid admin key'
      });
    }

    const { totalBurned, reason } = req.body;

    if (!totalBurned || isNaN(totalBurned) || parseFloat(totalBurned) < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid totalBurned. Must be a positive number.'
      });
    }

    const newTotal = parseFloat(totalBurned);
    await redis.set('total_tokens_burned', String(newTotal));

    // Add adjustment event to history
    const adjustmentEvent = {
      amount: newTotal,
      reason: reason || 'Manual total adjustment',
      timestamp: new Date().toISOString(),
      type: 'adjustment'
    };
    await redis.lPush('token_burns', JSON.stringify(adjustmentEvent));

    console.log(`✅ Total burned manually set to ${newTotal} WALDO`);

    res.json({
      success: true,
      message: `Total burned set to ${newTotal} WALDO`,
      totalBurned: newTotal
    });

  } catch (error) {
    console.error('❌ Error setting total burned:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set total burned'
    });
  }
});

// ✅ GET /api/burn/total - Get total burned from XRPL (PUBLIC)
router.get('/total', async (req, res) => {
  try {
    // Get actual burned amount from XRPL (now includes all burn methods)
    const burnData = await getTotalBurnedFromXRPL();

    // Get recent burn events from Redis (for history display)
    const burnHistory = await redis.lRange('token_burns', 0, 9); // Last 10 burns

    const recentBurns = burnHistory.map(burn => {
      try {
        const parsed = JSON.parse(burn);
        return {
          amount: parsed.amount,
          timestamp: parsed.timestamp,
          reason: parsed.reason
        };
      } catch (error) {
        return null;
      }
    }).filter(burn => burn !== null);

    res.json({
      success: true,
      totalBurned: burnData.total,
      totalSupply: TOTAL_SUPPLY,
      inCirculation: burnData.inCirculation,
      breakdown: burnData.breakdown,
      recentBurns: recentBurns,
      count: recentBurns.length,
      source: 'xrpl'
    });

  } catch (error) {
    console.error('❌ Error fetching burn total:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch burn total'
    });
  }
});

// ✅ GET /api/burn/stats - Get burn statistics (ADMIN ONLY)
router.get('/stats', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Invalid admin key'
      });
    }

    const totalBurned = await redis.get('total_tokens_burned') || 0;
    const burnHistory = await redis.lRange('token_burns', 0, -1);

    // Calculate daily burns for last 30 days
    const dailyBurns = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (let i = 0; i < 30; i++) {
      const date = new Date(thirtyDaysAgo);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      const dailyKey = `burns:${dateStr}`;
      const dailyData = await redis.lRange(dailyKey, 0, -1);

      let dailyTotal = 0;
      dailyData.forEach(burn => {
        try {
          const burnEvent = JSON.parse(burn);
          dailyTotal += parseFloat(burnEvent.amount);
        } catch (error) {
          // Skip invalid entries
        }
      });

      dailyBurns[dateStr] = dailyTotal;
    }

    res.json({
      success: true,
      stats: {
        totalBurned: parseFloat(totalBurned),
        totalBurnEvents: burnHistory.length,
        dailyBurns: dailyBurns,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error fetching burn stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch burn statistics'
    });
  }
});

// ✅ POST /api/burn/massive - Burn large amount with confirmation
router.post('/massive', async (req, res) => {
  try {
    const { amount, adminKey, reason, confirmation } = req.body;

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Invalid admin key'
      });
    }

    const burnAmount = parseFloat(amount);

    if (!amount || isNaN(burnAmount) || burnAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be a positive number.'
      });
    }

    // Require confirmation for burns over 1M tokens
    if (burnAmount >= 1000000) {
      if (confirmation !== `BURN_${Math.floor(burnAmount)}_WLO_TOKENS`) {
        return res.status(400).json({
          success: false,
          error: `Large burn requires confirmation. Send confirmation: "BURN_${Math.floor(burnAmount)}_WLO_TOKENS"`
        });
      }
    }

    // Use the regular burn endpoint logic
    const burnResult = await burnTokens(burnAmount, reason || 'Massive token burn');

    if (burnResult.success) {
      res.json(burnResult);
    } else {
      res.status(500).json(burnResult);
    }

  } catch (error) {
    console.error('❌ Error in massive burn:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute massive burn: ' + error.message
    });
  }
});

// Helper function for burning tokens
async function burnTokens(amount, reason) {
  try {
    if (!DISTRIBUTOR_SECRET) {
      throw new Error('Distributor secret not configured');
    }

    console.log(`🔥 Burning ${amount} WLO tokens: ${reason}`);

    // Connect to XRPL
    const client = new Client(XRPL_SERVER);
    await client.connect();

    // Create wallet from secret
    const wallet = Wallet.fromSeed(DISTRIBUTOR_SECRET);

    // Create burn transaction
    const burnTransaction = {
      TransactionType: 'Payment',
      Account: wallet.classicAddress,
      Destination: WALDO_ISSUER,
      Amount: {
        currency: 'WLO',
        issuer: WALDO_ISSUER,
        value: amount.toString()
      },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('TOKEN_BURN').toString('hex').toUpperCase(),
          MemoData: Buffer.from(reason).toString('hex').toUpperCase()
        }
      }]
    };

    // Submit and wait for validation
    const response = await client.submitAndWait(burnTransaction, { wallet });

    if (response.result.meta.TransactionResult === 'tesSUCCESS') {
      const txHash = response.result.hash;

      // Record burn event
      const burnEvent = {
        amount: amount,
        reason: reason,
        txHash: txHash,
        timestamp: new Date().toISOString(),
        wallet: wallet.classicAddress,
        issuer: WALDO_ISSUER
      };

      // Store in Redis
      await redis.lPush('token_burns', JSON.stringify(burnEvent));
      await redis.incrByFloat('total_tokens_burned', amount);

      // Store daily tracking
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `burns:${today}`;
      await redis.rPush(dailyKey, JSON.stringify(burnEvent));
      await redis.expire(dailyKey, 86400 * 365);

      await client.disconnect();

      return {
        success: true,
        message: `Successfully burned ${amount} WLO tokens`,
        burnEvent: {
          amount: amount,
          txHash: txHash,
          timestamp: burnEvent.timestamp,
          reason: reason
        }
      };

    } else {
      await client.disconnect();
      throw new Error(`Transaction failed: ${response.result.meta.TransactionResult}`);
    }

  } catch (error) {
    throw error;
  }
}

// ✅ GET /api/burn/debug - Debug burn system status
router.get('/debug', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Invalid admin key'
      });
    }

    // Check system configuration
    const systemStatus = {
      xrplServer: XRPL_SERVER,
      waldoIssuer: WALDO_ISSUER,
      distributorSecretConfigured: !!DISTRIBUTOR_SECRET,
      adminKeyConfigured: !!process.env.X_ADMIN_KEY,
      redisConnected: true // Assume connected if we got here
    };

    // Get recent burn attempts (including failed ones)
    const totalBurned = await redis.get('total_tokens_burned') || 0;
    const burnHistory = await redis.lRange('token_burns', 0, 9); // Last 10

    const parsedHistory = burnHistory.map(burn => {
      try {
        return JSON.parse(burn);
      } catch (error) {
        return null;
      }
    }).filter(burn => burn !== null);

    res.json({
      success: true,
      debug: {
        systemStatus,
        burnStats: {
          totalBurned: parseFloat(totalBurned),
          recentBurns: parsedHistory.length,
          lastBurn: parsedHistory.length > 0 ? parsedHistory[0].timestamp : null
        },
        recentBurns: parsedHistory,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error in burn debug:', error);
    res.status(500).json({
      success: false,
      error: 'Debug check failed: ' + error.message
    });
  }
});

export default router;
