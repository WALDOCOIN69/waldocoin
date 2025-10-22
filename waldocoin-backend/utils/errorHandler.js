import { redis } from "../redisClient.js";

console.log("🧩 Loaded: utils/errorHandler.js");

/**
 * Comprehensive Error Handling and Logging System
 * 
 * Provides detailed error tracking, user-friendly messages,
 * and monitoring capabilities for debugging.
 */

// Error tracking keys
const ERROR_KEYS = {
  log: (timestamp) => `error:log:${timestamp}`,
  count: (type) => `error:count:${type}`,
  user: (wallet) => `error:user:${wallet}`,
  endpoint: (endpoint) => `error:endpoint:${endpoint}`
};

// Error types and their user-friendly messages
const ERROR_MESSAGES = {
  // Battle errors
  BATTLE_NOT_FOUND: "Battle not found. It may have expired or been completed.",
  BATTLE_ALREADY_ACCEPTED: "This battle has already been accepted by another user.",
  BATTLE_SELF_ACCEPT: "You cannot accept your own battle challenge.",
  BATTLE_NOT_PENDING: "This battle is no longer available for acceptance.",
  BATTLE_ALREADY_VOTED: "You have already voted in this battle.",
  BATTLE_EXPIRED: "This battle has expired and is no longer active.",
  BATTLE_CREATION_FAILED: "Failed to create battle. Please try again.",
  
  // Tweet validation errors
  TWEET_NOT_FOUND: "Tweet not found in your meme collection. Make sure it has #WaldoMeme hashtag and has been processed.",
  TWEET_INVALID_FORMAT: "Invalid tweet URL format. Please paste a valid Twitter/X link.",
  TWEET_NOT_OWNED: "This tweet doesn't belong to your connected wallet.",
  TWEET_NO_MEDIA: "Tweet must contain an image or video to be used in battles.",
  TWEET_NO_HASHTAG: "Tweet must contain #WaldoMeme hashtag to be eligible for battles.",
  TWEET_IN_USE: "This meme is already being used in another active battle.",
  TWEET_DELETED: "Tweet appears to be deleted or made private.",
  
  // Payment errors
  PAYMENT_REJECTED: "Payment was rejected. No funds were charged.",
  PAYMENT_TIMEOUT: "Payment timed out. Please try again.",
  PAYMENT_FAILED: "Payment processing failed. Please check your wallet and try again.",
  PAYMENT_INSUFFICIENT_FUNDS: "Insufficient WALDO balance for this transaction.",
  PAYMENT_NETWORK_ERROR: "Network error during payment. Please try again.",
  
  // Wallet errors
  WALLET_NOT_CONNECTED: "Please connect your Xaman wallet to continue.",
  WALLET_INVALID: "Invalid wallet address format.",
  WALLET_NOT_FOUND: "Wallet not found or not registered.",
  WALLET_INSUFFICIENT_BALANCE: "Insufficient WALDO balance in your wallet.",
  
  // System errors
  SYSTEM_BUSY: "System is busy processing requests. Please try again in a moment.",
  SYSTEM_MAINTENANCE: "System is under maintenance. Please try again later.",
  RATE_LIMITED: "Too many requests. Please wait before trying again.",
  VALIDATION_FAILED: "Input validation failed. Please check your data and try again.",
  
  // Generic errors
  UNKNOWN_ERROR: "An unexpected error occurred. Please try again or contact support.",
  NETWORK_ERROR: "Network connection error. Please check your internet and try again.",
  SERVER_ERROR: "Internal server error. Our team has been notified."
};

/**
 * Log an error with comprehensive details
 * @param {string} type - Error type/category
 * @param {Error|string} error - Error object or message
 * @param {Object} context - Additional context information
 * @param {string} wallet - User wallet (optional)
 * @param {string} endpoint - API endpoint (optional)
 */
export async function logError(type, error, context = {}, wallet = null, endpoint = null) {
  try {
    const timestamp = Date.now();
    const errorId = `${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    
    const errorData = {
      id: errorId,
      type,
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : null,
      context: JSON.stringify(context),
      wallet,
      endpoint,
      timestamp,
      userAgent: context.userAgent || null,
      ip: context.ip || null
    };

    // Store detailed error log
    await redis.hset(ERROR_KEYS.log(timestamp), errorData);
    
    // Increment error counters
    await redis.incr(ERROR_KEYS.count(type));
    
    if (wallet) {
      await redis.incr(ERROR_KEYS.user(wallet));
    }
    
    if (endpoint) {
      await redis.incr(ERROR_KEYS.endpoint(endpoint));
    }

    // Set expiry for error logs (7 days)
    await redis.expire(ERROR_KEYS.log(timestamp), 60 * 60 * 24 * 7);

    console.error(`❌ [${type}] ${errorData.message}`, {
      errorId,
      wallet,
      endpoint,
      context
    });

    return errorId;
  } catch (logError) {
    console.error('❌ Failed to log error:', logError);
    return null;
  }
}

/**
 * Get user-friendly error message
 * @param {string} errorType - Error type
 * @param {Object} context - Additional context for dynamic messages
 * @returns {string} - User-friendly error message
 */
export function getUserFriendlyMessage(errorType, context = {}) {
  const baseMessage = ERROR_MESSAGES[errorType] || ERROR_MESSAGES.UNKNOWN_ERROR;
  
  // Add dynamic context to certain messages
  switch (errorType) {
    case 'TWEET_NOT_OWNED':
      return `${baseMessage} Connected wallet: ${context.wallet?.slice(0, 8)}...`;
    case 'PAYMENT_TIMEOUT':
      return `${baseMessage} Transaction ID: ${context.uuid || 'N/A'}`;
    case 'BATTLE_EXPIRED':
      return `${baseMessage} Battle was created ${context.hoursAgo || 'some time'} ago.`;
    default:
      return baseMessage;
  }
}

/**
 * Create standardized error response
 * @param {string} errorType - Error type
 * @param {Object} context - Error context
 * @param {string} wallet - User wallet
 * @param {string} endpoint - API endpoint
 * @returns {Object} - Standardized error response
 */
export async function createErrorResponse(errorType, context = {}, wallet = null, endpoint = null) {
  const errorId = await logError(errorType, context.originalError || errorType, context, wallet, endpoint);
  
  return {
    success: false,
    error: getUserFriendlyMessage(errorType, context),
    errorType,
    errorId,
    timestamp: Date.now(),
    ...(process.env.NODE_ENV === 'development' && {
      debug: {
        context,
        stack: context.originalError?.stack
      }
    })
  };
}

/**
 * Express middleware for error handling
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
export function errorMiddleware(err, req, res, next) {
  const wallet = req.body?.wallet || req.query?.wallet || null;
  const endpoint = `${req.method} ${req.path}`;
  
  const context = {
    originalError: err,
    body: req.body,
    query: req.query,
    params: req.params,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  };

  // Determine error type based on error message/type
  let errorType = 'UNKNOWN_ERROR';
  
  if (err.message?.includes('not found')) {
    errorType = 'BATTLE_NOT_FOUND';
  } else if (err.message?.includes('already voted')) {
    errorType = 'BATTLE_ALREADY_VOTED';
  } else if (err.message?.includes('rejected')) {
    errorType = 'PAYMENT_REJECTED';
  } else if (err.message?.includes('timeout')) {
    errorType = 'PAYMENT_TIMEOUT';
  } else if (err.message?.includes('insufficient')) {
    errorType = 'PAYMENT_INSUFFICIENT_FUNDS';
  }

  createErrorResponse(errorType, context, wallet, endpoint).then(errorResponse => {
    const statusCode = getStatusCodeForError(errorType);
    res.status(statusCode).json(errorResponse);
  }).catch(responseError => {
    console.error('❌ Error creating error response:', responseError);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      errorId: null,
      timestamp: Date.now()
    });
  });
}

/**
 * Get appropriate HTTP status code for error type
 * @param {string} errorType - Error type
 * @returns {number} - HTTP status code
 */
function getStatusCodeForError(errorType) {
  switch (errorType) {
    case 'BATTLE_NOT_FOUND':
    case 'TWEET_NOT_FOUND':
    case 'WALLET_NOT_FOUND':
      return 404;
    
    case 'BATTLE_ALREADY_ACCEPTED':
    case 'BATTLE_ALREADY_VOTED':
    case 'BATTLE_SELF_ACCEPT':
    case 'TWEET_INVALID_FORMAT':
    case 'TWEET_NOT_OWNED':
    case 'WALLET_INVALID':
    case 'VALIDATION_FAILED':
      return 400;
    
    case 'WALLET_NOT_CONNECTED':
      return 401;
    
    case 'RATE_LIMITED':
      return 429;
    
    case 'SYSTEM_MAINTENANCE':
      return 503;
    
    default:
      return 500;
  }
}

/**
 * Get error statistics
 * @param {number} hours - Hours to look back (default: 24)
 * @returns {Object} - Error statistics
 */
export async function getErrorStats(hours = 24) {
  try {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const errorKeys = await redis.keys('error:log:*');
    
    const stats = {
      totalErrors: 0,
      errorsByType: {},
      errorsByEndpoint: {},
      recentErrors: [],
      timeRange: `${hours} hours`
    };

    for (const key of errorKeys) {
      const timestamp = parseInt(key.split(':')[2]);
      
      if (timestamp >= cutoff) {
        const errorData = await redis.hgetall(key);
        
        if (errorData && errorData.type) {
          stats.totalErrors++;
          stats.errorsByType[errorData.type] = (stats.errorsByType[errorData.type] || 0) + 1;
          
          if (errorData.endpoint) {
            stats.errorsByEndpoint[errorData.endpoint] = (stats.errorsByEndpoint[errorData.endpoint] || 0) + 1;
          }
          
          if (stats.recentErrors.length < 10) {
            stats.recentErrors.push({
              id: errorData.id,
              type: errorData.type,
              message: errorData.message,
              timestamp: parseInt(errorData.timestamp),
              wallet: errorData.wallet,
              endpoint: errorData.endpoint
            });
          }
        }
      }
    }

    // Sort recent errors by timestamp (newest first)
    stats.recentErrors.sort((a, b) => b.timestamp - a.timestamp);

    return stats;
  } catch (error) {
    console.error('❌ Error getting error stats:', error);
    return {
      totalErrors: 0,
      errorsByType: {},
      errorsByEndpoint: {},
      recentErrors: [],
      error: 'Failed to get error statistics'
    };
  }
}
