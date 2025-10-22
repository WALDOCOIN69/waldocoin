import { redis } from "../redisClient.js";
import { logError } from "./errorHandler.js";

console.log("🧩 Loaded: utils/escrowMonitor.js");

/**
 * Battle Escrow Wallet Monitoring System
 * 
 * Monitors escrow wallet balance, tracks stuck funds,
 * and provides alerts for financial security.
 */

const ESCROW_KEYS = {
  balance: () => `escrow:balance:current`,
  history: (timestamp) => `escrow:balance:${timestamp}`,
  transactions: () => `escrow:transactions`,
  alerts: () => `escrow:alerts`,
  stuck: () => `escrow:stuck_funds`
};

/**
 * Record escrow wallet balance
 * @param {number} balance - Current balance in WLO
 * @param {string} source - Source of balance check
 * @returns {boolean} - Success status
 */
export async function recordEscrowBalance(balance, source = 'manual') {
  try {
    const timestamp = Date.now();
    
    // Store current balance
    await redis.hset(ESCROW_KEYS.balance(), {
      balance,
      timestamp,
      source,
      lastUpdated: new Date().toISOString()
    });
    
    // Store historical balance
    await redis.hset(ESCROW_KEYS.history(timestamp), {
      balance,
      timestamp,
      source
    });
    
    // Set expiry for historical data (30 days)
    await redis.expire(ESCROW_KEYS.history(timestamp), 60 * 60 * 24 * 30);
    
    console.log(`💰 Escrow balance recorded: ${balance} WLO (${source})`);
    
    // Check for balance alerts
    await checkBalanceAlerts(balance);
    
    return true;
  } catch (error) {
    await logError('ESCROW_BALANCE_RECORD_FAILED', error, { balance, source });
    return false;
  }
}

/**
 * Get current escrow balance information
 * @returns {Object} - Balance information or null
 */
export async function getEscrowBalance() {
  try {
    const balanceData = await redis.hgetall(ESCROW_KEYS.balance());
    
    if (!balanceData || Object.keys(balanceData).length === 0) {
      return null;
    }
    
    return {
      balance: parseFloat(balanceData.balance),
      timestamp: parseInt(balanceData.timestamp),
      source: balanceData.source,
      lastUpdated: balanceData.lastUpdated,
      age: Date.now() - parseInt(balanceData.timestamp)
    };
  } catch (error) {
    await logError('ESCROW_BALANCE_GET_FAILED', error);
    return null;
  }
}

/**
 * Track escrow transaction
 * @param {string} type - Transaction type ('deposit', 'withdrawal', 'refund')
 * @param {number} amount - Amount in WLO
 * @param {string} battleId - Related battle ID
 * @param {string} wallet - Related wallet
 * @param {string} txId - Transaction ID
 * @returns {boolean} - Success status
 */
export async function trackEscrowTransaction(type, amount, battleId, wallet, txId = null) {
  try {
    const timestamp = Date.now();
    const transactionId = `${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    
    const transaction = {
      id: transactionId,
      type,
      amount,
      battleId,
      wallet,
      txId,
      timestamp,
      date: new Date().toISOString()
    };
    
    // Store transaction
    await redis.hset(`escrow:tx:${transactionId}`, transaction);
    
    // Add to transaction list
    await redis.lpush(ESCROW_KEYS.transactions(), transactionId);
    
    // Keep only last 1000 transactions
    await redis.ltrim(ESCROW_KEYS.transactions(), 0, 999);
    
    // Set expiry for transaction data (90 days)
    await redis.expire(`escrow:tx:${transactionId}`, 60 * 60 * 24 * 90);
    
    console.log(`📊 Escrow transaction tracked: ${type} ${amount} WLO (${battleId})`);
    
    return true;
  } catch (error) {
    await logError('ESCROW_TRANSACTION_TRACK_FAILED', error, { 
      type, amount, battleId, wallet, txId 
    });
    return false;
  }
}

/**
 * Check for balance alerts and warnings
 * @param {number} currentBalance - Current balance to check
 * @returns {Array} - Array of alerts
 */
async function checkBalanceAlerts(currentBalance) {
  const alerts = [];
  
  try {
    // Alert thresholds
    const LOW_BALANCE_THRESHOLD = 1000000; // 1M WLO
    const CRITICAL_BALANCE_THRESHOLD = 100000; // 100K WLO
    const HIGH_BALANCE_THRESHOLD = 50000000; // 50M WLO
    
    // Low balance alert
    if (currentBalance < CRITICAL_BALANCE_THRESHOLD) {
      alerts.push({
        type: 'CRITICAL_LOW_BALANCE',
        message: `Escrow balance critically low: ${currentBalance} WLO`,
        severity: 'critical',
        threshold: CRITICAL_BALANCE_THRESHOLD
      });
    } else if (currentBalance < LOW_BALANCE_THRESHOLD) {
      alerts.push({
        type: 'LOW_BALANCE',
        message: `Escrow balance low: ${currentBalance} WLO`,
        severity: 'warning',
        threshold: LOW_BALANCE_THRESHOLD
      });
    }
    
    // High balance alert (potential stuck funds)
    if (currentBalance > HIGH_BALANCE_THRESHOLD) {
      alerts.push({
        type: 'HIGH_BALANCE',
        message: `Escrow balance unusually high: ${currentBalance} WLO - check for stuck funds`,
        severity: 'warning',
        threshold: HIGH_BALANCE_THRESHOLD
      });
    }
    
    // Store alerts
    if (alerts.length > 0) {
      for (const alert of alerts) {
        await redis.lpush(ESCROW_KEYS.alerts(), JSON.stringify({
          ...alert,
          balance: currentBalance,
          timestamp: Date.now()
        }));
      }
      
      // Keep only last 100 alerts
      await redis.ltrim(ESCROW_KEYS.alerts(), 0, 99);
      
      console.warn(`⚠️ Escrow alerts generated:`, alerts.map(a => a.type));
    }
    
    return alerts;
  } catch (error) {
    await logError('ESCROW_ALERT_CHECK_FAILED', error, { currentBalance });
    return [];
  }
}

/**
 * Get escrow transaction history
 * @param {number} limit - Number of transactions to retrieve
 * @returns {Array} - Array of transactions
 */
export async function getEscrowTransactionHistory(limit = 50) {
  try {
    const transactionIds = await redis.lrange(ESCROW_KEYS.transactions(), 0, limit - 1);
    const transactions = [];
    
    for (const txId of transactionIds) {
      const txData = await redis.hgetall(`escrow:tx:${txId}`);
      if (txData && Object.keys(txData).length > 0) {
        transactions.push({
          ...txData,
          amount: parseFloat(txData.amount),
          timestamp: parseInt(txData.timestamp)
        });
      }
    }
    
    return transactions;
  } catch (error) {
    await logError('ESCROW_HISTORY_GET_FAILED', error, { limit });
    return [];
  }
}

/**
 * Get escrow alerts
 * @param {number} limit - Number of alerts to retrieve
 * @returns {Array} - Array of alerts
 */
export async function getEscrowAlerts(limit = 20) {
  try {
    const alertStrings = await redis.lrange(ESCROW_KEYS.alerts(), 0, limit - 1);
    const alerts = [];
    
    for (const alertStr of alertStrings) {
      try {
        const alert = JSON.parse(alertStr);
        alerts.push(alert);
      } catch (parseError) {
        console.warn('Failed to parse escrow alert:', alertStr);
      }
    }
    
    return alerts;
  } catch (error) {
    await logError('ESCROW_ALERTS_GET_FAILED', error, { limit });
    return [];
  }
}

/**
 * Calculate expected escrow balance based on active battles
 * @returns {Object} - Expected balance calculation
 */
export async function calculateExpectedEscrowBalance() {
  try {
    const battleKeys = await redis.keys('battle:*:data');
    let expectedBalance = 0;
    let activeBattles = 0;
    let pendingBattles = 0;
    
    const { startFeeWLO, acceptFeeWLO, voteFeeWLO } = await (await import("./config.js")).getBattleFees();
    
    for (const key of battleKeys) {
      const battle = await redis.hgetall(key);
      
      if (battle && battle.status) {
        if (battle.status === 'pending' || battle.status === 'open') {
          expectedBalance += startFeeWLO; // Challenger fee
          pendingBattles++;
        } else if (battle.status === 'accepted') {
          expectedBalance += startFeeWLO + acceptFeeWLO; // Both fees
          activeBattles++;
          
          // Add voting fees
          const votes = parseInt(battle.votes) || 0;
          expectedBalance += votes * voteFeeWLO;
        }
      }
    }
    
    return {
      expectedBalance,
      activeBattles,
      pendingBattles,
      totalBattles: activeBattles + pendingBattles,
      fees: {
        startFee: startFeeWLO,
        acceptFee: acceptFeeWLO,
        voteFee: voteFeeWLO
      }
    };
  } catch (error) {
    await logError('ESCROW_EXPECTED_BALANCE_CALC_FAILED', error);
    return {
      expectedBalance: 0,
      activeBattles: 0,
      pendingBattles: 0,
      totalBattles: 0,
      error: error.message
    };
  }
}

/**
 * Detect potentially stuck funds
 * @returns {Object} - Stuck funds analysis
 */
export async function detectStuckFunds() {
  try {
    const currentBalance = await getEscrowBalance();
    const expectedBalance = await calculateExpectedEscrowBalance();
    
    if (!currentBalance) {
      return {
        error: 'Current balance not available',
        recommendation: 'Update escrow balance first'
      };
    }
    
    const difference = currentBalance.balance - expectedBalance.expectedBalance;
    const percentageDiff = expectedBalance.expectedBalance > 0 
      ? (difference / expectedBalance.expectedBalance) * 100 
      : 0;
    
    let status = 'normal';
    let recommendation = 'No action needed';
    
    if (Math.abs(difference) > 500000) { // 500K WLO threshold
      if (difference > 0) {
        status = 'excess_funds';
        recommendation = 'Check for completed battles that need payouts or refunds';
      } else {
        status = 'insufficient_funds';
        recommendation = 'Check for missing deposits or unauthorized withdrawals';
      }
    }
    
    return {
      currentBalance: currentBalance.balance,
      expectedBalance: expectedBalance.expectedBalance,
      difference,
      percentageDiff,
      status,
      recommendation,
      lastUpdated: currentBalance.lastUpdated,
      battleStats: {
        active: expectedBalance.activeBattles,
        pending: expectedBalance.pendingBattles,
        total: expectedBalance.totalBattles
      }
    };
  } catch (error) {
    await logError('STUCK_FUNDS_DETECTION_FAILED', error);
    return {
      error: error.message,
      recommendation: 'Manual investigation required'
    };
  }
}
