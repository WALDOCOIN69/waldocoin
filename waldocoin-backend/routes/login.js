import express from "express";
import XummSdk from 'xumm-sdk'; 
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
router.get("/", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "SignIn",
      },
    });

    res.json({
      qr: payload.refs.qr_png,
      uuid: payload.uuid,
    });
  } catch (err) {
    console.error("❌ Error creating XUMM payload:", err);
    res.status(500).json({ error: "Failed to create XUMM sign-in." });
  }
});

export default router;

