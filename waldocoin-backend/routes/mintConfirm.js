// 📁 routes/mintConfirm.js
import express from 'express'
import { XummSdk } from 'xumm-sdk'
import dotenv from 'dotenv'
dotenv.config()

const router = express.Router()
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET)

router.post('/', async (req, res) => {
  const { wallet, tweet_id, image_url, likes, retweets } = req.body
  if (!wallet || !tweet_id || !image_url || likes === undefined || retweets === undefined) {
    return res.status(400).json({ error: "Missing required fields." })
  }

  try {
    const xp = Math.floor(likes / 10) + Math.floor(retweets / 15)
    const metadata = {
      name: `WALDO Meme #${tweet_id}`,
      description: `${likes} Likes / ${retweets} Retweets\nXP: ${xp}`,
      image: image_url,
      likes,
      retweets,
      xp
    }

    const uri = Buffer.from(JSON.stringify(metadata)).toString("hex")

    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "NFTokenMint",
        URI: uri,
        Flags: 8, // Transferable
        NFTokenTaxon: 0
      },
      options: {
        submit: true,
        expire: 300
      }
    })

    return res.json({
      success: true,
      uuid: payload.uuid,
      qr: payload.refs.qr_png,
      sign_url: payload.next.always
    })
  } catch (e) {
    console.error("❌ Error creating NFT mint payload:", e.message)
    res.status(500).json({ error: "Failed to mint NFT." })
  }
})

export default router
