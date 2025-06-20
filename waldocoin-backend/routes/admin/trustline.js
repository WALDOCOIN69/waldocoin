// routes/admin/trustline.js
import express from "express";
import dotenv from "dotenv";
import { xummClient } from "../../utils/xummClient.js";
dotenv.config();

const router = express.Router();

router.post("/", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ success: false, error: "Missing wallet address" });

  try {
    const payload = await xummClient.payload.createAndSubscribe({
      txjson: {
        TransactionType: "TrustSet",
        LimitAmount: {
          currency: "WLO",
          issuer: process.env.WALDO_ISSUER,
          value: "1000000000"
        },
        Destination: wallet
      },
      options: {
        submit: true,
        expire: 300
      }
    }, (event) => {
      if (event.data.signed === false) throw new Error("Trustline rejected by user");
      if (event.data.signed === true) return true;
    });

    res.json({ success: true, uuid: payload.uuid, next: payload.next });
  } catch (err) {
    console.error("❌ Trustline setup failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

