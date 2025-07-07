// routes/airdrop.js
import express from "express";
import { xummClient } from "../utils/xummClient.js";
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
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: wallet,
        Amount: {
          currency: WALDOCOIN_TOKEN,
          issuer: WALDO_ISSUER,
          value: "50000"
        }
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("User rejected");
    });

    return res.json({ success: true, uuid, next });
  } catch (err) {
    console.error("❌ Airdrop error:", err.message);
    return res.status(500).json({ success: false, error: "Airdrop failed", detail: err.message });
  }
});

export default router;

