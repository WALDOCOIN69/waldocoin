// utils/stakingUtils.js - Shared staking utilities
import { redis } from '../redisClient.js';

/**
 * Calculate maturity with buffer
 * @param {string|Date} endDate - End date of stake
 * @param {number} bufferMs - Buffer in milliseconds (default 60 seconds)
 * @returns {Object} - Maturity information
 */
export function calculateMaturity(endDate, bufferMs = 60 * 1000) {
  const now = Date.now();
  const end = new Date(endDate).getTime();
  const timeRemaining = Math.max(0, end - now);
  
  return {
    isMatured: timeRemaining <= bufferMs,
    timeRemaining,
    daysRemaining: Math.ceil(timeRemaining / (24 * 60 * 60 * 1000)),
    endTimestamp: end,
    bufferMs
  };
}

/**
 * Create stake ID with consistent format
 * @param {string} type - Stake type ('longterm', 'permeme', 'test')
 * @param {string} wallet - Wallet address
 * @param {string} suffix - Optional suffix
 * @returns {string} - Formatted stake ID
 */
export function createStakeId(type, wallet, suffix = '') {
  const timestamp = Date.now();
  const base = `${type}_${wallet}_${timestamp}`;
  return suffix ? `${base}_${suffix}` : base;
}

/**
 * Calculate APY with level bonus (matches staking.js rates)
 * @param {number} duration - Duration in days
 * @param {number} level - User level (1-5)
 * @returns {number} - APY percentage
 */
export function calculateAPY(duration, level = 1) {
  // Use the same rates as in staking.js LONG_TERM_APY_RATES
  const baseRates = {
    30: 12,   // 12% bonus for 30 days
    90: 18,   // 18% bonus for 90 days
    180: 25,  // 25% bonus for 180 days
    365: 45   // 45% bonus for 365 days
  };

  const baseAPY = baseRates[duration] || 12;
  const legendBonus = level === 5 ? 2 : 0; // Level 5 gets +2% bonus (LEGEND_BONUS * 100)

  return baseAPY + legendBonus;
}

/**
 * Calculate expected reward as flat bonus (not annualized)
 * @param {number} amount - Stake amount
 * @param {number} apy - APY percentage
 * @returns {number} - Expected reward amount
 */
export function calculateExpectedReward(amount, apy) {
  const rewardCalculation = amount * (apy / 100);
  return Math.floor(rewardCalculation * 100) / 100; // Round to 2 decimals, then floor
}

/**
 * Create stake data object with consistent structure
 * @param {Object} params - Stake parameters
 * @returns {Object} - Formatted stake data
 */
export function createStakeData({
  stakeId,
  wallet,
  amount,
  duration,
  apy,
  expectedReward,
  type = 'long_term',
  status = 'pending'
}) {
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + (duration * 24 * 60 * 60 * 1000));
  
  return {
    stakeId,
    wallet,
    amount: amount.toString(),
    duration: duration.toString(),
    apy: apy.toString(),
    expectedReward: expectedReward.toString(),
    type,
    status,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    createdAt: startDate.toISOString(),
    claimed: 'false'
  };
}

/**
 * Clean up completed stakes from active sets
 * @param {string} wallet - Wallet address
 * @param {string} stakeId - Stake ID
 */
export async function cleanupCompletedStake(wallet, stakeId) {
  await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
  await redis.sRem(`staking:user:${wallet}`, stakeId);
  await redis.sRem('staking:active', stakeId);
  await redis.sAdd(`staking:user:${wallet}:redeemed`, stakeId);
}

/**
 * Add stake to active sets
 * @param {string} wallet - Wallet address
 * @param {string} stakeId - Stake ID
 */
export async function addToActiveSets(wallet, stakeId) {
  await redis.sAdd(`staking:user:${wallet}`, stakeId);
  await redis.sAdd('staking:active', stakeId);
}

/**
 * Calculate early unstaking penalty
 * @param {number} amount - Original stake amount
 * @param {number} penaltyRate - Penalty rate (default 0.15 for 15%)
 * @returns {Object} - Penalty calculation
 */
export function calculateEarlyUnstakePenalty(amount, penaltyRate = 0.15) {
  const penalty = amount * penaltyRate;
  const userReceives = amount - penalty;
  
  return {
    originalAmount: amount,
    penalty,
    userReceives,
    penaltyRate
  };
}
