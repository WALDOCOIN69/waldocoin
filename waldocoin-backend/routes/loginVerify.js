// 📁 routes/loginVerify.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const router = express.Router();

// ✅ Wallet Format Validator
router.post("/", (req, res) => {
  const { wallet } = req.body;

  if (!wallet || typeof wallet !== "string" || !wallet.startsWith("r") || wallet.length < 25) {
    return res.status(400).json({ valid: false, error: "Invalid wallet address format." });
  }

  return res.json({ valid: true, message: "Wallet format is valid." });
});

export default router;
