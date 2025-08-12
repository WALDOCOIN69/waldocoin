// 🎯 WALDOCOIN DUAL-CHAIN TYPE DEFINITIONS

/**
 * Supported blockchain networks
 */
export const SUPPORTED_CHAINS = {
  XRPL: 'xrpl',
  SOLANA: 'solana'
};

/**
 * Wallet connection states
 */
export const WALLET_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
};

/**
 * Transaction states
 */
export const TRANSACTION_STATES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * User levels and XP thresholds
 */
export const USER_LEVELS = {
  1: { name: 'Waldo Watcher', minXP: 0, maxXP: 249 },
  2: { name: 'Shitposter', minXP: 250, maxXP: 849 },
  3: { name: 'Meme Dealer', minXP: 850, maxXP: 1749 },
  4: { name: 'OG Degen', minXP: 1750, maxXP: 2999 },
  5: { name: 'Waldo Legend', minXP: 3000, maxXP: Infinity }
};

/**
 * Reward tiers for memes
 */
export const REWARD_TIERS = [
  { tier: 5, likes: 1000, retweets: 100, base: 50 },
  { tier: 4, likes: 500, retweets: 50, base: 25 },
  { tier: 3, likes: 100, retweets: 10, base: 5 },
  { tier: 2, likes: 50, retweets: 5, base: 2 },
  { tier: 1, likes: 25, retweets: 0, base: 1 }
];

/**
 * Staking periods and APY rates
 */
export const STAKING_PERIODS = {
  30: { days: 30, apy: 12 },
  90: { days: 90, apy: 18 },
  180: { days: 180, apy: 25 },
  365: { days: 365, apy: 35 }
};

/**
 * Chain-specific configuration
 */
export const CHAIN_CONFIG = {
  [SUPPORTED_CHAINS.XRPL]: {
    name: 'XRPL',
    displayName: 'XRP Ledger',
    currency: 'XRP',
    tokenSymbol: 'WLO',
    decimals: 6,
    explorerUrl: 'https://xrpscan.com',
    walletTypes: ['xumm'],
    minTransactionAmount: 5,
    networkFee: 0.00001
  },
  [SUPPORTED_CHAINS.SOLANA]: {
    name: 'Solana',
    displayName: 'Solana',
    currency: 'SOL',
    tokenSymbol: 'WALDO',
    decimals: 9,
    explorerUrl: 'https://solscan.io',
    walletTypes: ['phantom', 'solflare', 'sollet'],
    minTransactionAmount: 0.1,
    networkFee: 0.000005
  }
};

/**
 * API response structure
 */
export const createApiResponse = (success, data = null, error = null, meta = {}) => ({
  success,
  data,
  error,
  timestamp: new Date().toISOString(),
  ...meta
});

/**
 * Validation schemas
 */
export const VALIDATION_PATTERNS = {
  XRPL_ADDRESS: /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/,
  SOLANA_ADDRESS: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  TWITTER_HANDLE: /^@?[A-Za-z0-9_]{1,15}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

/**
 * Error codes
 */
export const ERROR_CODES = {
  INVALID_CHAIN: 'INVALID_CHAIN',
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
};

/**
 * Event types for real-time updates
 */
export const EVENT_TYPES = {
  WALLET_CONNECTED: 'wallet_connected',
  WALLET_DISCONNECTED: 'wallet_disconnected',
  TRANSACTION_PENDING: 'transaction_pending',
  TRANSACTION_CONFIRMED: 'transaction_confirmed',
  REWARDS_EARNED: 'rewards_earned',
  LEVEL_UP: 'level_up',
  MEME_POSTED: 'meme_posted',
  BATTLE_STARTED: 'battle_started'
};

/**
 * Default configuration values
 */
export const DEFAULTS = {
  PAGINATION_LIMIT: 20,
  CACHE_TTL: 300, // 5 minutes
  RATE_LIMIT_WINDOW: 900000, // 15 minutes
  RATE_LIMIT_MAX: 100,
  SESSION_TIMEOUT: 3600000, // 1 hour
  MEME_SCAN_INTERVAL: 600000, // 10 minutes
  PRICE_UPDATE_INTERVAL: 60000 // 1 minute
};
