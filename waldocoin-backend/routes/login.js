import express from "express";
import dotenv from "dotenv";
import pkg from "xumm-sdk"; // ✅ Fix for CommonJS

dotenv.config();
const { Xumm } = pkg; // ✅ Extract from default import

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
