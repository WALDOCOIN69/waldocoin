// 📁 routes/loginVerify.js
import express from "express";

const router = express.Router();

// ✅ Wallet Format Validator (basic)
router.post("/", (req, res) => {
  const { wallet } = req.body;

  if (!wallet || typeof wallet !== "string" || !wallet.startsWith("r") || wallet.length < 25) {
    return res.status(400).json({ valid: false, error: "Invalid wallet address format." });
  }

  return res.json({ valid: true, message: "Wallet format is valid." });
});

export default router;
