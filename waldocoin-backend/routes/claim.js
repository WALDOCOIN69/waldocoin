// 📁 routes/claim.js
import express from 'express'
import { XummSdk } from 'xumm-sdk'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()

const DB_PATH = "./db.json"
const router = express.Router()
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET)

const ISSUER = "rf97bQQbqztUnL1BYB5ti4rC691e7u5C8F"
const CURRENCY = "WLD"
const WALDO_TO_XRP = 0.0042

const INSTANT_FEE_PERCENT = 0.10
const STAKE_FEE_PERCENT = 0.05
const BURN_RATE = 0.02

// Monthly tier caps
const tierCaps = {
  1: 36,
  2: 72,
  3: 180,
  4: 900,
  5: 1800
}

// Reward base lookup
function getBaseRewardByTier(tier) {
  const map = { 1: 1, 2: 2, 3: 5, 4: 25, 5: 50 }
  return map[tier] || null
}

// 📤 POST /api/claim
router.post('/', async (req, res) => {
  const { wallet, stake, tier } = req.body
  if (!wallet || typeof stake !== 'boolean' || !tier) {
    return res.status(400).json({ error: "Missing required fields" })
  }

  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH))
    db.rewards = db.rewards || {}
    db.rewards[wallet] = db.rewards[wallet] || {}

    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    db.rewards[wallet][monthKey] = db.rewards[wallet][monthKey] || {}

    const log = db.rewards[wallet][monthKey]._log || []
    if (log.length >= 10) {
      return res.status(400).json({
        success: false,
        error: "❌ You’ve already claimed rewards for 10 memes this month."
      })
    }

    const baseReward = getBaseRewardByTier(tier)
    if (!baseReward) return res.status(400).json({ error: "Invalid tier" })

    // Calculate reward based on claim type
    let reward = stake 
      ? baseReward * 1.15 * (1 - STAKE_FEE_PERCENT)
      : baseReward * (1 - INSTANT_FEE_PERCENT)

    const claimedThisMonth = db.rewards[wallet][monthKey][tier] || 0
    const maxAllowed = tierCaps[tier]

    if ((claimedThisMonth + reward) > maxAllowed) {
      return res.json({
        success: false,
        error: `Monthly cap reached for Tier ${tier}. You’ve already claimed ${claimedThisMonth.toFixed(2)} WALDO this month.`
      })
    }

    // Fee logic
    const feePercent = stake ? STAKE_FEE_PERCENT : INSTANT_FEE_PERCENT
    const burnAmount = (baseReward * feePercent * BURN_RATE).toFixed(4)
    const xrpConvertAmount = (baseReward * feePercent - burnAmount).toFixed(4)

    // Create XUMM payout
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: wallet,
        Amount: {
          currency: CURRENCY,
          value: reward.toFixed(2),
          issuer: ISSUER
        }
      },
      options: {
        submit: true,
        expire: 300
      }
    })

    // Save claim to db
    db.rewards[wallet][monthKey][tier] = claimedThisMonth + reward
    db.rewards[wallet][monthKey]._log = log.concat({
      timestamp: new Date().toISOString(),
      tier,
      stake,
      reward: reward.toFixed(2)
    })

    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))

    return res.json({
      success: true,
      uuid: payload.uuid,
      qr: payload.refs.qr_png,
      sign_url: payload.next.always,
      reward: reward.toFixed(2),
      burned: burnAmount,
      xrp_converted: xrpConvertAmount
    })

  } catch (e) {
    console.error("❌ Error processing claim:", e.message)
    return res.status(500).json({ error: e.message })
  }
})

export default router
