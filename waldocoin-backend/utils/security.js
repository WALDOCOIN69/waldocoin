import { redis } from "../redisClient.js";

// 📌 Config
const MAX_VIOLATIONS = 3;
const BLOCK_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Logs a violation event for a wallet
 * @param {string} wallet - XRPL wallet address
 * @param {string} reason - Reason code for violation
 * @param {object} meta - Optional metadata
 */
export async function logViolation(wallet, reason, meta = {}) {
  const key = `security:wallet:${wallet}:log`;
  const entry = {
    reason,
    meta,
    timestamp: new Date().toISOString(),
  };

  await redis.rPush(key, JSON.stringify(entry));

  const count = await redis.lLen(key);
  if (count >= MAX_VIOLATIONS) {
    await redis.set(`security:wallet:${wallet}:blocked`, "1", {
      EX: BLOCK_DURATION_SECONDS,
    });
  }
}

/**
 * Checks if a wallet is blocked (manually or auto-blocked)
 * @param {string} wallet - XRPL wallet address
 * @returns {Promise<boolean>}
 */
export async function isAutoBlocked(wallet) {
  const key = `security:wallet:${wallet}:blocked`;
  const blocked = await redis.get(key);
  return !!blocked;
}
