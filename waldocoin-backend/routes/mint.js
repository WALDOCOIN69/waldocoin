// 📁 routes/mint.js
import express from 'express'
import { XummSdk } from 'xumm-sdk'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config()

console.log("🔍 ENV KEY:", process.env.XUMM_API_KEY);
console.log("🔍 ENV SECRET:", process.env.XUMM_API_SECRET);
const router = express.Router()
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET)
const DB_PATH = "./db.json"

const ISSUER = "rf97bQQbqztUnL1BYB5ti4rC691e7u5C8F"
const CURRENCY = "WLD"
const MINT_FEE = 50

// Step 1: Charge mint fee
router.post('/', async (req, res) => {
  const { wallet } = req.body
  if (!wallet) return res.status(400).json({ success: false, error: "Missing wallet" })

  try {
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "Payment",
        Destination: ISSUER,
        Amount: {
          currency: CURRENCY,
          value: MINT_FEE.toFixed(2),
          issuer: ISSUER
        }
      },
      options: {
        submit: true,
        expire: 300
      }
    })

    res.json({
      success: true,
      uuid: payload.uuid,
      sign_url: payload.next.always,
      qr: payload.refs.qr_png
    })

  } catch (e) {
    console.error("❌ Mint fee error:", e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// Step 2: Mint NFT
router.post('/confirm', async (req, res) => {
  const { wallet, tweet_id, image_url, likes, retweets } = req.body
  if (!wallet || !tweet_id || !image_url) {
    return res.status(400).json({ success: false, error: "Missing data" })
  }

  try {
    const metadata = {
      tweet_id,
      likes,
      retweets,
      url: `https://twitter.com/i/web/status/${tweet_id}`,
      image: image_url
    }

    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "NFTokenMint",
        URI: Buffer.from(JSON.stringify(metadata)).toString('hex').toUpperCase(),
        Flags: 1,
        NFTokenTaxon: 0
      },
      options: {
        submit: true,
        expire: 300
      }
    })

    res.json({
      success: true,
      uuid: payload.uuid,
      sign_url: payload.next.always,
      qr: payload.refs.qr_png
    })

  } catch (e) {
    console.error("❌ NFT mint error:", e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

export default router
