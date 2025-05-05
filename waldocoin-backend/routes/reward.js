// 📁 waldocoin-backend/routes/reward.js
import express from 'express'
const router = express.Router()

router.get('/', (req, res) => {
  res.json({ status: '🎁 Reward route placeholder active.' })
})

export default router
