import { redis } from '../redisClient.js'

// Security configuration
const MAX_VIOLATIONS = 3
const BLOCK_DURATION_SECONDS = 60 * 60 * 24 * 7 // 7 days
const RATE_LIMIT_WINDOW = 60 * 60 // 1 hour
const MAX_REQUESTS_PER_HOUR = 100
const SUSPICIOUS_ACTIVITY_THRESHOLD = 50

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

// Rate limiting per wallet
export async function checkRateLimit(wallet, action = 'general') {
  const rateLimitKey = `rateLimit:${wallet}:${action}`
  const current = await redis.get(rateLimitKey) || 0

  if (parseInt(current) >= MAX_REQUESTS_PER_HOUR) {
    await logViolation(wallet, 'RATE_LIMIT_EXCEEDED', { action, requests: current })
    return false
  }

  await redis.incr(rateLimitKey)
  await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW)
  return true
}

// Detect suspicious patterns
export async function detectSuspiciousActivity(wallet, action, metadata = {}) {
  const activityKey = `activity:${wallet}:${action}`
  const hourlyKey = `activity:${wallet}:hourly`

  // Track specific action frequency
  await redis.incr(activityKey)
  await redis.expire(activityKey, RATE_LIMIT_WINDOW)

  // Track overall activity
  await redis.incr(hourlyKey)
  await redis.expire(hourlyKey, RATE_LIMIT_WINDOW)

  const actionCount = parseInt(await redis.get(activityKey)) || 0
  const totalActivity = parseInt(await redis.get(hourlyKey)) || 0

  // Flag suspicious patterns
  if (actionCount > 20 || totalActivity > SUSPICIOUS_ACTIVITY_THRESHOLD) {
    await logViolation(wallet, 'SUSPICIOUS_ACTIVITY', {
      action,
      actionCount,
      totalActivity,
      metadata
    })
    return true
  }

  return false
}

// Validate wallet ownership via signature
export async function validateWalletOwnership(wallet, signature, message) {
  try {
    // This would integrate with XRPL signature verification
    // For now, return true - implement actual signature verification
    return true
  } catch (error) {
    await logViolation(wallet, 'INVALID_SIGNATURE', { signature, message })
    return false
  }
}

// Check for bot-like behavior
export async function detectBotBehavior(wallet, userAgent, ipAddress) {
  const patterns = [
    { pattern: /bot|crawler|spider/i, source: 'userAgent' },
    { pattern: /curl|wget|python|node/i, source: 'userAgent' }
  ]

  for (const { pattern, source } of patterns) {
    if (source === 'userAgent' && pattern.test(userAgent || '')) {
      await logViolation(wallet, 'BOT_DETECTED', { userAgent, ipAddress })
      return true
    }
  }

  return false
}

// Validate transaction authenticity
export async function validateTransaction(wallet, txHash, expectedAmount) {
  try {
    // This would verify the transaction on XRPL
    // Check if transaction exists, amount matches, and wallet is sender
    return true
  } catch (error) {
    await logViolation(wallet, 'INVALID_TRANSACTION', { txHash, expectedAmount })
    return false
  }
}

