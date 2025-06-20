// routes/admin/sendWaldo.js
import express from "express";
import dotenv from "dotenv";
import { xummClient } from "../../utils/xummClient.js"; // ✅ Correct named import

dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/admin/sendWaldo.js");

// POST /api/admin/send-waldo
router.post("/", async (req, res) => {
  const { wallet, amount } = req.body;

  if (!wallet || !amount) {
    return res.status(400).json({ success: false, error: "Missing wallet or amount" });
  }

  try {
    const payload = await xummClient.payload.createAndSubscribe({
      txjson: {
        TransactionType: "Payment",
        Destination: wallet,
        Amount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: parseFloat(amount).toFixed(6)
        },
        DestinationTag: 111
      },
      options: {
        submit: true,
        expire: 300
      }
    }, event => {
      if (event.data.signed) return true;
      if (event.data.signed === false) throw new Error("Transaction rejected");
    });

    res.json({ success: true, uuid: payload.uuid, next: payload.next });
  } catch (err) {
    console.error("❌ Manual WALDO send failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
