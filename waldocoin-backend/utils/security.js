import { redis } from '../redisClient.js'

// 📌 Config
const MAX_VIOLATIONS = 3
const BLOCK_DURATION_SECONDS = 60 * 60 * 24 * 7 // 7 days = 604800 seconds

/**
 * Logs a violation for a wallet
 * @param {string} wallet - XRPL wallet address
 * @param {string} reason - Violation type or reason string
 * @param {object} meta - Optional metadata (e.g., tweetId, action type)
 */
export async function logViolation(wallet, reason, meta = {}) {
  const logKey = `security:wallet:${wallet}:log`
  const blockKey = `security:wallet:${wallet}:blocked`

  const entry = {
    reason,
    meta,
    timestamp: new Date().toISOString()
  }

  await redis.rPush(logKey, JSON.stringify(entry))

  const total = await redis.lLen(logKey)
  console.warn(`🚨 Violation logged for ${wallet} [${reason}] (Total: ${total})`)

  if (total >= MAX_VIOLATIONS) {
    await redis.set(blockKey, '1', {
      EX: BLOCK_DURATION_SECONDS
    })
    console.warn(`⛔ Auto-blocked wallet: ${wallet} for ${BLOCK_DURATION_SECONDS / 86400} days`)
  }
}

/**
 * Checks if a wallet is blocked
 * @param {string} wallet - XRPL wallet address
 * @returns {Promise<boolean>}
 */
export async function isAutoBlocked(wallet) {
  const blockKey = `security:wallet:${wallet}:blocked`
  const blocked = await redis.get(blockKey)
  return Boolean(blocked)
}
