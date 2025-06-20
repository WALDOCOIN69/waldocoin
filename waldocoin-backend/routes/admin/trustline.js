// routes/admin/trustline.js
import express from "express";
import { Xumm } from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

console.log("🧩 Loaded: routes/admin/trustline.js");

// POST /api/admin/trustline
router.post("/", async (req, res) => {
  const { wallet } = req.body;

  if (!wallet) {
    return res.status(400).json({ success: false, error: "Missing wallet address" });
  }

  try {
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "TrustSet",
        LimitAmount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: "1000000000"
        }
      },
      user_token: true
    });

    res.json({ success: true, uuid: payload.uuid, next: payload.next });
  } catch (err) {
    console.error("❌ Trustline setup failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
