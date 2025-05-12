import express from "express";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

let xumm; // Will be set inside the route

router.get("/", async (req, res) => {
  try {
    // ✅ Dynamically import the CommonJS module
    const { default: XummSdk } = await import("xumm-sdk");
    xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

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
