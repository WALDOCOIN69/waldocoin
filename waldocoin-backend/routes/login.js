// routes/login.js
import express from "express";
import pkg from "xumm-sdk";
const { Xumm } = pkg;

const router = express.Router();
const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

router.get("/ping", (_, res) => {
  res.json({ status: "✅ Login route is alive" });
});

router.get("/", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
      txjson: { TransactionType: "SignIn" }
    });

    res.json({
      qr: payload.refs.qr_png,
      uuid: payload.uuid
    });
  } catch (err) {
    console.error("❌ Error in /api/login:", err.message);
    res.status(500).json({ error: "Failed to create XUMM login payload" });
  }
});

export default router;
