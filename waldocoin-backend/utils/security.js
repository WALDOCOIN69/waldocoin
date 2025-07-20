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

// Enhanced AI-powered bot detection
export async function detectBotBehavior(wallet, userAgent, ipAddress) {
  const botPatterns = [
    { pattern: /bot|crawler|spider|scraper/i, source: 'userAgent', weight: 100 },
    { pattern: /curl|wget|python|node|axios|fetch/i, source: 'userAgent', weight: 80 },
    { pattern: /headless|phantom|selenium|puppeteer/i, source: 'userAgent', weight: 90 },
    { pattern: /^Mozilla\/5\.0$/, source: 'userAgent', weight: 60 }, // Suspicious minimal UA
  ]

  let botScore = 0;
  const detectedPatterns = [];

  // Check user agent patterns
  for (const { pattern, source, weight } of botPatterns) {
    if (source === 'userAgent' && pattern.test(userAgent || '')) {
      botScore += weight;
      detectedPatterns.push(`UA:${pattern.source}`);
    }
  }

  // Behavioral analysis
  const behaviorScore = await analyzeBehaviorPatterns(wallet);
  botScore += behaviorScore;

  // Timing analysis
  const timingScore = await analyzeRequestTiming(wallet);
  botScore += timingScore;

  // IP reputation check
  const ipScore = await checkIPReputation(ipAddress);
  botScore += ipScore;

  if (botScore >= 100) {
    await logViolation(wallet, 'BOT_DETECTED', {
      userAgent,
      ipAddress,
      botScore,
      detectedPatterns,
      behaviorScore,
      timingScore,
      ipScore
    });
    return true;
  }

  // Log suspicious but not blocked
  if (botScore >= 60) {
    await logViolation(wallet, 'SUSPICIOUS_BOT_ACTIVITY', {
      userAgent,
      ipAddress,
      botScore,
      detectedPatterns
    });
  }

  return false;
}

// Analyze behavioral patterns for bot detection
async function analyzeBehaviorPatterns(wallet) {
  try {
    const activityKey = `behavior:${wallet}`;
    const recentActions = await redis.lRange(activityKey, 0, 99); // Last 100 actions

    if (recentActions.length < 5) return 0; // Not enough data

    let score = 0;
    const timestamps = recentActions.map(action => {
      try {
        return new Date(JSON.parse(action).timestamp).getTime();
      } catch {
        return Date.now();
      }
    });

    // Check for perfectly regular intervals (bot-like)
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i-1]);
    }

    // Calculate variance in intervals
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // Low variance = bot-like behavior
    if (stdDev < avgInterval * 0.1 && intervals.length > 10) {
      score += 40; // Very regular timing
    }

    // Check for rapid-fire actions
    const rapidActions = intervals.filter(interval => interval < 1000).length; // < 1 second
    if (rapidActions > intervals.length * 0.3) {
      score += 30; // Too many rapid actions
    }

    return Math.min(score, 50); // Cap at 50 points
  } catch (error) {
    return 0;
  }
}

// Analyze request timing patterns
async function analyzeRequestTiming(wallet) {
  try {
    const timingKey = `timing:${wallet}`;
    const now = Date.now();

    // Record this request
    await redis.lPush(timingKey, now.toString());
    await redis.lTrim(timingKey, 0, 49); // Keep last 50 requests
    await redis.expire(timingKey, 3600); // 1 hour expiry

    const recentRequests = await redis.lRange(timingKey, 0, 49);
    if (recentRequests.length < 10) return 0;

    const timestamps = recentRequests.map(ts => parseInt(ts));
    let score = 0;

    // Check for burst patterns (many requests in short time)
    const last10Seconds = timestamps.filter(ts => now - ts < 10000).length;
    const last60Seconds = timestamps.filter(ts => now - ts < 60000).length;

    if (last10Seconds > 5) score += 30; // Too many in 10 seconds
    if (last60Seconds > 20) score += 20; // Too many in 1 minute

    return Math.min(score, 40); // Cap at 40 points
  } catch (error) {
    return 0;
  }
}

// Check IP reputation (simplified version)
async function checkIPReputation(ipAddress) {
  if (!ipAddress) return 0;

  try {
    // Check if IP is in known bot/proxy ranges
    const suspiciousRanges = [
      /^10\./, // Private networks (often VPS/bots)
      /^172\.16\./, // Private networks
      /^192\.168\./, // Private networks (less suspicious for home users)
      /^127\./, // Localhost
    ];

    let score = 0;

    // Check against suspicious patterns
    for (const range of suspiciousRanges) {
      if (range.test(ipAddress)) {
        score += 10; // Slightly suspicious
        break;
      }
    }

    // Check if IP has been flagged before
    const flagKey = `ip:flagged:${ipAddress}`;
    const flagged = await redis.get(flagKey);
    if (flagged) {
      score += 30;
    }

    // Check request frequency from this IP
    const ipActivityKey = `ip:activity:${ipAddress}`;
    const ipRequests = await redis.incr(ipActivityKey);
    await redis.expire(ipActivityKey, 3600); // 1 hour window

    if (ipRequests > 1000) score += 40; // Very high activity from single IP
    else if (ipRequests > 500) score += 20; // High activity

    return Math.min(score, 30); // Cap at 30 points
  } catch (error) {
    return 0;
  }
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

