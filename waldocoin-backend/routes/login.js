// 📁 waldocoin-backend/routes/login.js
import express from 'express'
const router = express.Router()

router.get('/', (req, res) => {
  res.json({ status: '👋 Login route placeholder active.' })
})

export default router
