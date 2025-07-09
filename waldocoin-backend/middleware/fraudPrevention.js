// middleware/fraudPrevention.js - Comprehensive fraud prevention middleware
import { 
  isAutoBlocked, 
  checkRateLimit, 
  detectSuspiciousActivity, 
  detectBotBehavior,
  logViolation 
} from '../utils/security.js';
import { redis } from '../redisClient.js';

// Fraud prevention middleware factory
export function createFraudPrevention(options = {}) {
  const {
    action = 'general',
    requireWallet = true,
    checkDuplicates = false,
    duplicateKey = null,
    economicBarrier = null,
    customValidation = null
  } = options;

  return async (req, res, next) => {
    try {
      const wallet = req.body.wallet || req.query.wallet || req.params.wallet;
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip || req.connection.remoteAddress;

      // 1. Wallet requirement check
      if (requireWallet && !wallet) {
        return res.status(400).json({
          success: false,
          error: 'Wallet address required',
          code: 'WALLET_REQUIRED'
        });
      }

      if (wallet) {
        // 2. Wallet format validation
        if (!isValidWalletFormat(wallet)) {
          await logViolation(wallet, 'INVALID_WALLET_FORMAT', { wallet });
          return res.status(400).json({
            success: false,
            error: 'Invalid wallet address format',
            code: 'INVALID_WALLET'
          });
        }

        // 3. Auto-block check
        if (await isAutoBlocked(wallet)) {
          return res.status(403).json({
            success: false,
            error: 'Wallet is temporarily blocked due to suspicious activity',
            code: 'WALLET_BLOCKED'
          });
        }

        // 4. Rate limiting
        if (!await checkRateLimit(wallet, action)) {
          return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded. Please try again later.',
            code: 'RATE_LIMITED'
          });
        }

        // 5. Bot detection
        if (await detectBotBehavior(wallet, userAgent, ipAddress)) {
          return res.status(403).json({
            success: false,
            error: 'Automated requests are not allowed',
            code: 'BOT_DETECTED'
          });
        }

        // 6. Suspicious activity detection
        if (await detectSuspiciousActivity(wallet, action, req.body)) {
          return res.status(429).json({
            success: false,
            error: 'Unusual activity detected. Please slow down.',
            code: 'SUSPICIOUS_ACTIVITY'
          });
        }

        // 7. Duplicate prevention
        if (checkDuplicates && duplicateKey) {
          const key = typeof duplicateKey === 'function' 
            ? duplicateKey(req) 
            : duplicateKey.replace('{wallet}', wallet);
          
          if (await redis.exists(key)) {
            return res.status(409).json({
              success: false,
              error: 'Action already performed',
              code: 'DUPLICATE_ACTION'
            });
          }
        }

        // 8. Economic barrier check
        if (economicBarrier) {
          const hasBalance = await checkEconomicBarrier(wallet, economicBarrier);
          if (!hasBalance.success) {
            return res.status(403).json({
              success: false,
              error: hasBalance.error,
              code: 'INSUFFICIENT_BALANCE'
            });
          }
        }

        // 9. Custom validation
        if (customValidation) {
          const customResult = await customValidation(req, wallet);
          if (!customResult.success) {
            await logViolation(wallet, 'CUSTOM_VALIDATION_FAILED', customResult);
            return res.status(400).json({
              success: false,
              error: customResult.error,
              code: 'VALIDATION_FAILED'
            });
          }
        }
      }

      // All checks passed
      next();

    } catch (error) {
      console.error('❌ Fraud prevention middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'Security check failed',
        code: 'SECURITY_ERROR'
      });
    }
  };
}

// Wallet format validation
function isValidWalletFormat(wallet) {
  return typeof wallet === 'string' && 
         wallet.startsWith('r') && 
         wallet.length >= 25 && 
         wallet.length <= 34 &&
         /^r[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(wallet);
}

// Economic barrier validation
async function checkEconomicBarrier(wallet, barrier) {
  try {
    if (barrier.type === 'waldo_balance') {
      // Check WALDO balance via XRPL
      const response = await fetch("https://s1.ripple.com:51234", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "account_lines",
          params: [{ account: wallet }]
        })
      });

      const data = await response.json();
      const lines = data?.result?.lines || [];
      
      const waldoLine = lines.find(
        l => l.currency === 'WLO' && l.account === 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'
      );

      const balance = parseFloat(waldoLine?.balance || '0');
      
      if (balance < barrier.amount) {
        return {
          success: false,
          error: `Minimum ${barrier.amount} WALDO required. Current balance: ${balance}`
        };
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'Unable to verify balance'
    };
  }
}

// Pre-configured middleware for common use cases
export const airdropFraudPrevention = createFraudPrevention({
  action: 'airdrop',
  requireWallet: true,
  checkDuplicates: true,
  duplicateKey: (req) => `airdrop:claimed:${req.body.wallet}`
});

export const battleFraudPrevention = createFraudPrevention({
  action: 'battle',
  requireWallet: true,
  economicBarrier: { type: 'waldo_balance', amount: 100 }
});

export const claimFraudPrevention = createFraudPrevention({
  action: 'claim',
  requireWallet: true,
  checkDuplicates: true,
  duplicateKey: (req) => `claim:${req.body.wallet}:${req.body.memeId}`
});

export const voteFraudPrevention = createFraudPrevention({
  action: 'vote',
  requireWallet: true,
  economicBarrier: { type: 'waldo_balance', amount: 10000 },
  checkDuplicates: true,
  duplicateKey: (req) => `vote:${req.body.proposalId}:${req.body.wallet}`
});

export const mintFraudPrevention = createFraudPrevention({
  action: 'mint',
  requireWallet: true,
  economicBarrier: { type: 'waldo_balance', amount: 50 },
  customValidation: async (req, wallet) => {
    // Check if meme has 60+ XP
    const xp = parseInt(await redis.get(`meme:xp:${req.body.tweetId}`)) || 0;
    if (xp < 60) {
      return {
        success: false,
        error: 'Meme requires 60+ XP for NFT minting'
      };
    }
    return { success: true };
  }
});

export default createFraudPrevention;
