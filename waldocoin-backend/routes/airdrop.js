import express from "express";
import { xrpSendWaldo } from "../utils/sendWaldo.js";
import { WALDO_ISSUER, WALDOCOIN_TOKEN } from "../constants.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { wallet, password } = req.body;

  if (!wallet || !password) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  if (password !== "WALDOCREW") {
    return res.status(401).json({ success: false, error: "Invalid password" });
  }

  try {
    await xrpSendWaldo(wallet, 50000); // 50,000 WALDO
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Airdrop send error:", err.message);
    return res.status(500).json({ success: false, error: "Airdrop failed", detail: err.message });
  }
});

export default router;


