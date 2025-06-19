import express from "express";
import { Xumm } from "xumm-sdk";

const router = express.Router();

// ✅ Initialize XUMM
const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

// ✅ Health check
router.get("/ping", (_, res) => {
  res.json({ status: "✅ Login route is alive" });
});

// ✅ XUMM login QR + UUID
router.get("/", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
      txjson: { TransactionType: "SignIn" },
    });

    res.json({
      qr: payload.refs.qr_png,
      uuid: payload.uuid,
    });
  } catch (err) {
    console.error("❌ Error in /api/login:", err.message);
    res.status(500).json({ error: "Failed to create login payload" });
  }
});

export default router;

