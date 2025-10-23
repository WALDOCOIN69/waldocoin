// utils/logRedactor.js
// Patches console.* to redact sensitive values before logging

import util from 'util'

// Build a list of sensitive env values to redact
const SENSITIVE_ENV_KEYS = [
  'WALDO_DISTRIBUTOR_SECRET',
  'TRADING_WALLET_SECRET',
  'X_ADMIN_KEY',
  'ADMIN_KEY',
  'TELEGRAM_BOT_TOKEN',
  'XUMM_API_KEY',
  'XUMM_API_SECRET',
  'OPENAI_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'TINEYE_API_KEY',
  'TWITTER_BEARER_TOKEN',
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET',
  'JWT_SECRET',
  'DISTRIBUTOR_SECRET',
  'WALDO_SENDER_SECRET',
  'ISSUER_SECRET'
]

const SECRET_VALUES = SENSITIVE_ENV_KEYS
  .map((k) => process.env[k])
  .filter((v) => typeof v === 'string' && v.length > 0)

// Regexes for patterns that look like XRPL family seeds (start with 's')
// Example: sEd..., sXXXX...; keep conservative to avoid false positives
const XRPL_SEED_REGEX = /\bs[0-9A-Za-z]{12,}\b/g

function maskValue(value) {
  if (typeof value !== 'string') return value
  let masked = value

  // Replace explicit env secret values
  for (const secret of SECRET_VALUES) {
    if (!secret) continue
    const esc = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    masked = masked.replace(new RegExp(esc, 'g'), '[REDACTED]')
  }

  // Mask XRPL-like seeds
  masked = masked.replace(XRPL_SEED_REGEX, (m) => `${m.slice(0, 3)}…[REDACTED]…${m.slice(-3)}`)

  return masked
}

function redactArgs(args) {
  return args.map((arg) => {
    if (typeof arg === 'string') return maskValue(arg)
    try {
      // Try a safe stringification and mask inside
      const str = typeof arg === 'object' ? util.inspect(arg, { depth: 2, breakLength: 120 }) : String(arg)
      return maskValue(str)
    } catch {
      return '[Object]'
    }
  })
}

function patchConsoleMethod(method) {
  const original = console[method]
  console[method] = (...args) => {
    try {
      original.apply(console, redactArgs(args))
    } catch {
      // Fallback to original if anything goes wrong
      original.apply(console, args)
    }
  }
}

;['log', 'info', 'warn', 'error'].forEach(patchConsoleMethod)

// Export a no-op to allow import without side effects beyond patching
export default {}

