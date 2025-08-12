// 🛡️ WALDOCOIN DUAL-CHAIN VALIDATION UTILITIES

import { VALIDATION_PATTERNS, SUPPORTED_CHAINS, ERROR_CODES } from '../types/index.js';

/**
 * Validate wallet address for specific chain
 */
export function validateWalletAddress(address, chain) {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Address is required' };
  }

  switch (chain) {
    case SUPPORTED_CHAINS.XRPL:
      if (!VALIDATION_PATTERNS.XRPL_ADDRESS.test(address)) {
        return { valid: false, error: 'Invalid XRPL address format' };
      }
      break;
    
    case SUPPORTED_CHAINS.SOLANA:
      if (!VALIDATION_PATTERNS.SOLANA_ADDRESS.test(address)) {
        return { valid: false, error: 'Invalid Solana address format' };
      }
      break;
    
    default:
      return { valid: false, error: 'Unsupported chain' };
  }

  return { valid: true };
}

/**
 * Validate Twitter handle
 */
export function validateTwitterHandle(handle) {
  if (!handle || typeof handle !== 'string') {
    return { valid: false, error: 'Twitter handle is required' };
  }

  const cleanHandle = handle.replace(/^@/, '');
  
  if (!VALIDATION_PATTERNS.TWITTER_HANDLE.test(cleanHandle)) {
    return { valid: false, error: 'Invalid Twitter handle format' };
  }

  return { valid: true, cleanHandle };
}

/**
 * Validate email address
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  if (!VALIDATION_PATTERNS.EMAIL.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
}

/**
 * Validate transaction amount
 */
export function validateTransactionAmount(amount, chain, minAmount = null) {
  if (!amount || isNaN(amount) || amount <= 0) {
    return { valid: false, error: 'Invalid amount' };
  }

  const chainConfig = {
    [SUPPORTED_CHAINS.XRPL]: { min: minAmount || 5, symbol: 'XRP' },
    [SUPPORTED_CHAINS.SOLANA]: { min: minAmount || 0.1, symbol: 'SOL' }
  };

  const config = chainConfig[chain];
  if (!config) {
    return { valid: false, error: 'Unsupported chain' };
  }

  if (amount < config.min) {
    return { 
      valid: false, 
      error: `Minimum amount is ${config.min} ${config.symbol}` 
    };
  }

  return { valid: true };
}

/**
 * Validate XP amount
 */
export function validateXP(xp) {
  if (xp === undefined || xp === null || isNaN(xp) || xp < 0) {
    return { valid: false, error: 'Invalid XP amount' };
  }

  if (xp > 10000) {
    return { valid: false, error: 'XP amount too high' };
  }

  return { valid: true };
}

/**
 * Validate meme engagement metrics
 */
export function validateMemeMetrics(likes, retweets) {
  if (likes === undefined || likes === null || isNaN(likes) || likes < 0) {
    return { valid: false, error: 'Invalid likes count' };
  }

  if (retweets === undefined || retweets === null || isNaN(retweets) || retweets < 0) {
    return { valid: false, error: 'Invalid retweets count' };
  }

  if (likes > 1000000 || retweets > 100000) {
    return { valid: false, error: 'Engagement metrics too high' };
  }

  return { valid: true };
}

/**
 * Validate staking period
 */
export function validateStakingPeriod(days) {
  const validPeriods = [30, 90, 180, 365];
  
  if (!validPeriods.includes(days)) {
    return { 
      valid: false, 
      error: `Invalid staking period. Must be one of: ${validPeriods.join(', ')}` 
    };
  }

  return { valid: true };
}

/**
 * Validate pagination parameters
 */
export function validatePagination(page, limit) {
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;

  if (pageNum < 1) {
    return { valid: false, error: 'Page must be >= 1' };
  }

  if (limitNum < 1 || limitNum > 100) {
    return { valid: false, error: 'Limit must be between 1 and 100' };
  }

  return { valid: true, page: pageNum, limit: limitNum };
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input, maxLength = 1000) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocols
    .replace(/on\w+=/gi, ''); // Remove event handlers
}

/**
 * Validate admin key
 */
export function validateAdminKey(providedKey, expectedKey) {
  if (!providedKey || !expectedKey) {
    return { valid: false, error: 'Admin key required' };
  }

  if (providedKey !== expectedKey) {
    return { valid: false, error: 'Invalid admin key' };
  }

  return { valid: true };
}

/**
 * Validate chain selection
 */
export function validateChain(chain) {
  if (!chain) {
    return { valid: false, error: 'Chain selection required' };
  }

  if (!Object.values(SUPPORTED_CHAINS).includes(chain)) {
    return { 
      valid: false, 
      error: `Unsupported chain. Must be one of: ${Object.values(SUPPORTED_CHAINS).join(', ')}` 
    };
  }

  return { valid: true };
}

/**
 * Create validation error response
 */
export function createValidationError(message, field = null) {
  return {
    success: false,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      field,
      timestamp: new Date().toISOString()
    }
  };
}
