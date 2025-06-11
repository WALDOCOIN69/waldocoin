import { redis } from '../redisClient.js'

const MAX_VIOLATIONS = 3
const BLOCK_DURATION_SECONDS = 60 * 60 * 24 * 7 // 7 days

export async function logViolation(wallet, reason, meta = {}) {
  const logKey = `security:wallet:${wallet}:log`
  const blockKey = `security:wallet:${wallet}:blocked`

  const entry = {
    reason,
    meta,
    timestamp: new Date().toISOString()
  }

  await redis.rPush(logKey, JSON.stringify(entry))
  // Optional: Keep only last MAX_VIOLATIONS entries
  await redis.lTrim(logKey, -MAX_VIOLATIONS, -1)
  // Optional: Expire log after block period
  await redis.expire(logKey, BLOCK_DURATION_SECONDS)

  const total = await redis.lLen(logKey)
  console.warn(`🚨 Violation logged for ${wallet} [${reason}] (Total: ${total})`)

  if (total >= MAX_VIOLATIONS) {
    await redis.set(blockKey, '1', { EX: BLOCK_DURATION_SECONDS })
    console.warn(`⛔ Auto-blocked wallet: ${wallet} for ${BLOCK_DURATION_SECONDS / 86400} days`)
  }
}

export async function isAutoBlocked(wallet) {
  const blockKey = `security:wallet:${wallet}:blocked`
  const blocked = await redis.get(blockKey)
  return Boolean(blocked)
}

