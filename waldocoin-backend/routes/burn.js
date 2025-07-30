// routes/burn.js - Token burning functionality
import express from 'express';
import { redis } from '../redisClient.js';
import { Client, Wallet } from 'xrpl';

const router = express.Router();

// XRPL Configuration
const XRPL_SERVER = process.env.XRPL_NODE || 'wss://xrplcluster.com';
const WALDO_ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
// Correct WALDO distributor wallet that has the tokens to burn
const DISTRIBUTOR_SECRET = process.env.WALDO_DISTRIBUTOR_SECRET || 'sEd7ZQstcsCgQ1fxqMYZxBgEpZz5KUK';
const DISTRIBUTOR_WALLET = 'rJGYLktGg1FgAa4t2yfA8tnyMUGsyxofUC';

console.log("🔥 Loaded: routes/burn.js");

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

// ✅ GET /api/burn/stats - Get burn statistics
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
