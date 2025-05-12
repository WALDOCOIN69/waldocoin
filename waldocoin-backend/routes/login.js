// ✅ routes/login.js — XUMM QR login route
import express from "express";
import { Xumm } from "xumm-sdk";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

router.get("/", async (req, res) => {
  try {
    const payload = {
      txjson: { TransactionType: "SignIn" }
    };

    const created = await xumm.payload.create(payload);
    res.json({
      success: true,
      qr: created.refs.qr_png,
      uuid: created.uuid
    });
  } catch (err) {
    console.error("❌ XUMM QR error:", err.message);
    res.status(500).json({ success: false, error: "XUMM login failed." });
  }
});

export default router; 

