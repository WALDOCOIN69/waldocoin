// 📁 waldocoin-backend/routes/login.js
import express from 'express'
import { logViolation, isAutoBlocked } from '../utils/security.js'

const router = express.Router()

router.post('/wallet', async (req, res) => {
  const { wallet } = req.body

  if (!wallet || !wallet.startsWith('r') || wallet.length < 25) {
    await logViolation(wallet || 'unknown', "invalid_wallet", { reason: "format" })
    return res.status(400).json({ error: "Invalid or missing wallet address." })
  }

  if (await isAutoBlocked(wallet)) {
    await logViolation(wallet, "login_attempt_blocked", { reason: "auto_blocked_status" })
    return res.status(403).json({ error: "🚫 This wallet is blocked due to prior violations." })
  }

  // Optional: Track login attempt
  await logViolation(wallet, "login_attempt", { ip: req.ip })

  // ✅ Success response
  res.json({ success: true, message: "Wallet verified and accepted." })
})

export default router

