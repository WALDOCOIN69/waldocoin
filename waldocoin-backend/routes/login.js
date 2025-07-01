// routes/login.js
import express from "express";
import { xummClient } from "../utils/xummClient.js";
const router = express.Router();

router.get("/ping", (_, res) => {
  res.json({ status: "✅ Login route is alive" });
});

// MAIN LOGIN ROUTE (QR + UUID for sign-in)
router.get("/", async (req, res) => {
  try {
    // 🚫 No return_url - fixes unwanted mobile redirect!
    const payload = {
      txjson: { TransactionType: "SignIn" }
    };
    const created = await xummClient.payload.create(payload);
    res.json({ qr: created.refs.qr_png, uuid: created.uuid });
  } catch (err) {
    console.error("❌ Error in /api/login:", err.message);
    res.status(500).json({ error: "Failed to create XUMM login payload" });
  }
});

// LOGIN STATUS CHECK
router.get("/status", async (req, res) => {
  const { uuid } = req.query;
  try {
    const payloadStatus = await xummClient.payload.get(uuid);
    res.json({
      signed: payloadStatus.meta.signed,
      expired: payloadStatus.meta.expired,
      account: payloadStatus.response.account
    });
  } catch (err) {
    res.status(500).json({ error: "Error checking login status" });
  }
});

export default router;




