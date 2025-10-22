import { redis } from "../redisClient.js";
import { logError } from "./errorHandler.js";

console.log("🧩 Loaded: utils/rateLimiter.js");

/**
 * Rate Limiting System for Battle Actions
 * 
 * Prevents abuse and spam by limiting the frequency of actions
 * per wallet address with configurable limits and windows.
 */

// Rate limit configurations
const RATE_LIMITS = {
  // Battle actions
  BATTLE_START: { requests: 5, window: 60 * 60 * 1000 }, // 5 battles per hour
  BATTLE_ACCEPT: { requests: 10, window: 60 * 60 * 1000 }, // 10 accepts per hour
  BATTLE_VOTE: { requests: 50, window: 60 * 60 * 1000 }, // 50 votes per hour
  
  // Tweet validation
  TWEET_VALIDATION: { requests: 20, window: 60 * 1000 }, // 20 validations per minute
  
  // Payment actions
  PAYMENT_CREATE: { requests: 15, window: 60 * 60 * 1000 }, // 15 payments per hour
  
  // General API
  API_GENERAL: { requests: 100, window: 60 * 1000 }, // 100 requests per minute
  
  // Admin actions
  ADMIN_ACTION: { requests: 50, window: 60 * 1000 } // 50 admin actions per minute
};

/**
 * Check if action is rate limited
 * @param {string} action - Action type (e.g., 'BATTLE_START')
 * @param {string} identifier - Unique identifier (wallet address, IP, etc.)
 * @param {Object} customLimit - Optional custom limit override
 * @returns {Object} - { allowed: boolean, remaining: number, resetTime: number, error?: string }
 */
export async function checkRateLimit(action, identifier, customLimit = null) {
  try {
    const limit = customLimit || RATE_LIMITS[action];
    
    if (!limit) {
      // No rate limit configured for this action
      return { allowed: true, remaining: Infinity, resetTime: null };
    }
    
    const key = `ratelimit:${action}:${identifier}`;
    const now = Date.now();
    const windowStart = now - limit.window;
    
    // Get current request count in the time window
    const requests = await redis.zcount(key, windowStart, now);
    
    if (requests >= limit.requests) {
      // Rate limit exceeded
      const oldestRequest = await redis.zrange(key, 0, 0, { WITHSCORES: true });
      const resetTime = oldestRequest.length > 0 
        ? parseInt(oldestRequest[1]) + limit.window 
        : now + limit.window;
      
      await logError('RATE_LIMIT_EXCEEDED', `Rate limit exceeded for ${action}`, {
        action,
        identifier,
        requests,
        limit: limit.requests,
        window: limit.window
      });
      
      return {
        allowed: false,
        remaining: 0,
        resetTime,
        error: `Rate limit exceeded. Try again in ${Math.ceil((resetTime - now) / 1000)} seconds.`
      };
    }
    
    // Record this request
    await redis.zadd(key, now, `${now}_${Math.random()}`);
    
    // Clean up old entries
    await redis.zremrangebyscore(key, 0, windowStart);
    
    // Set expiry for the key
    await redis.expire(key, Math.ceil(limit.window / 1000));
    
    const remaining = limit.requests - requests - 1;
    
    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      resetTime: now + limit.window
    };
    
  } catch (error) {
    await logError('RATE_LIMIT_CHECK_FAILED', error, { action, identifier });
    
    // Fail open - allow the request if rate limiting fails
    return {
      allowed: true,
      remaining: 0,
      resetTime: null,
      error: 'Rate limit check failed'
    };
  }
}

/**
 * Express middleware for rate limiting
 * @param {string} action - Action type
 * @param {Function} getIdentifier - Function to extract identifier from request
 * @returns {Function} - Express middleware
 */
export function rateLimitMiddleware(action, getIdentifier = (req) => req.body?.wallet || req.ip) {
  return async (req, res, next) => {
    try {
      const identifier = getIdentifier(req);
      
      if (!identifier) {
        return res.status(400).json({
          success: false,
          error: "Unable to identify request for rate limiting"
        });
      }
      
      const result = await checkRateLimit(action, identifier);
      
      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': RATE_LIMITS[action]?.requests || 'unlimited',
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': result.resetTime ? new Date(result.resetTime).toISOString() : null
      });
      
      if (!result.allowed) {
        return res.status(429).json({
          success: false,
          error: result.error,
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }
      
      next();
    } catch (error) {
      await logError('RATE_LIMIT_MIDDLEWARE_ERROR', error, { action });
      // Continue on error to avoid blocking legitimate requests
      next();
    }
  };
}

/**
 * Get rate limit status for an identifier
 * @param {string} action - Action type
 * @param {string} identifier - Identifier to check
 * @returns {Object} - Rate limit status
 */
export async function getRateLimitStatus(action, identifier) {
  try {
    const limit = RATE_LIMITS[action];
    
    if (!limit) {
      return {
        action,
        identifier,
        limit: 'unlimited',
        current: 0,
        remaining: Infinity,
        resetTime: null
      };
    }
    
    const key = `ratelimit:${action}:${identifier}`;
    const now = Date.now();
    const windowStart = now - limit.window;
    
    const current = await redis.zcount(key, windowStart, now);
    const remaining = Math.max(0, limit.requests - current);
    
    const oldestRequest = await redis.zrange(key, 0, 0, { WITHSCORES: true });
    const resetTime = oldestRequest.length > 0 
      ? parseInt(oldestRequest[1]) + limit.window 
      : now + limit.window;
    
    return {
      action,
      identifier,
      limit: limit.requests,
      window: limit.window,
      current,
      remaining,
      resetTime,
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(now).toISOString()
    };
    
  } catch (error) {
    await logError('RATE_LIMIT_STATUS_ERROR', error, { action, identifier });
    return {
      action,
      identifier,
      error: error.message
    };
  }
}

/**
 * Clear rate limit for an identifier (admin function)
 * @param {string} action - Action type
 * @param {string} identifier - Identifier to clear
 * @returns {boolean} - Success status
 */
export async function clearRateLimit(action, identifier) {
  try {
    const key = `ratelimit:${action}:${identifier}`;
    await redis.del(key);
    
    console.log(`🧹 Rate limit cleared: ${action} for ${identifier}`);
    return true;
  } catch (error) {
    await logError('RATE_LIMIT_CLEAR_ERROR', error, { action, identifier });
    return false;
  }
}

/**
 * Get rate limit statistics
 * @param {number} hours - Hours to look back (default: 1)
 * @returns {Object} - Rate limit statistics
 */
export async function getRateLimitStats(hours = 1) {
  try {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const keys = await redis.keys('ratelimit:*');
    
    const stats = {
      totalKeys: keys.length,
      actionStats: {},
      topIdentifiers: {},
      timeRange: `${hours} hours`
    };
    
    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length >= 3) {
        const action = parts[1];
        const identifier = parts.slice(2).join(':');
        
        // Count requests in time window
        const requests = await redis.zcount(key, cutoff, Date.now());
        
        if (requests > 0) {
          // Action stats
          if (!stats.actionStats[action]) {
            stats.actionStats[action] = { requests: 0, identifiers: 0 };
          }
          stats.actionStats[action].requests += requests;
          stats.actionStats[action].identifiers += 1;
          
          // Top identifiers
          if (!stats.topIdentifiers[identifier]) {
            stats.topIdentifiers[identifier] = 0;
          }
          stats.topIdentifiers[identifier] += requests;
        }
      }
    }
    
    // Sort top identifiers
    stats.topIdentifiers = Object.entries(stats.topIdentifiers)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .reduce((obj, [key, value]) => {
        obj[key] = value;
        return obj;
      }, {});
    
    return stats;
  } catch (error) {
    await logError('RATE_LIMIT_STATS_ERROR', error, { hours });
    return {
      error: error.message,
      timeRange: `${hours} hours`
    };
  }
}
